import type { ISettingsStore } from "../platform/settings.js";
import { getPlatformServices } from "../platform/services.js";
import { isPrivateHost } from "./insecureUrl.js";

/**
 * No stored password goes to an address without TLS, or to one in a private
 * network, that THIS device never confirmed (maintainer, 2026-11-18, F57).
 *
 * A password that arrived through the settings sync names an address another
 * device chose. Over `http` it travels in the clear with every request, and a
 * private address — `192.168.1.5`, `nas.local` — names whatever machine has
 * it in the network this device happens to be in. So such an address is used
 * with a stored password only once it is confirmed on this device: by setting
 * the account up or repairing it here (the address was typed here), by the
 * one-time switch-over for what already worked here before this rule
 * (`settleEndpointConfirmations`), or by the person on the account page.
 * Until then nothing is sent; the account shows its sign-in as needed and its
 * card the row **Confirm address**.
 *
 * The list is per vault and device-local: it never travels — confirming on
 * one device says nothing about the network another one is in.
 *
 * Named limits (guide, Sync_Setup): a public name that resolves to a private
 * address is not recognised, and a confirmation is for the address, not the
 * network — the same device in someone else's network with the same address
 * range is not protected.
 */

/**
 * A host in a private network: the classifier of the http warning
 * (`isPrivateHost`), plus `.home.arpa` (RFC 8375), which that warning does not
 * name and which stays as it is there.
 */
export function isLocalNetworkHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return isPrivateHost(h) || h === "home.arpa" || h.endsWith(".home.arpa");
}

/** "scheme://host:port" of an address that needs this device's confirmation, or null when it needs none (https to a public name, or unreadable). */
export function confirmationEndpoint(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(/:$/, "");
  if (scheme !== "http" && scheme !== "https") return null;
  if (scheme === "https" && !isLocalNetworkHost(url.hostname)) return null;
  return endpointKey(scheme, url.hostname, url.port || (scheme === "https" ? "443" : "80"));
}

/**
 * The same for a mail server. IMAP always runs over TLS here, and SMTP and
 * Sieve refuse to send a password without STARTTLS, so only a private host
 * needs it.
 */
export function mailConfirmationEndpoint(protocol: "imap" | "smtp" | "sieve", host: string | null | undefined, port: number | null | undefined): string | null {
  const name = (host ?? "").trim();
  if (!name || !isLocalNetworkHost(name)) return null;
  return endpointKey(protocol, name, String(port ?? ""));
}

function endpointKey(scheme: string, host: string, port: string): string {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return `${scheme}://${h.includes(":") ? `[${h}]` : h}${port ? `:${port}` : ""}`;
}

export interface EndpointConfirmationResources {
  /** This device's settings store; never the synced profile. */
  store: ISettingsStore;
  /** The key of this vault's list. */
  storeKey: string;
}

interface Stored {
  version: 1;
  /** Set once the one-time switch-over for this vault ran. */
  settled?: boolean;
  endpoints: string[];
}

async function load(res: EndpointConfirmationResources): Promise<Stored> {
  const raw = await res.store.get<unknown>(res.storeKey);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { version: 1, endpoints: [] };
  const v = raw as Partial<Stored>;
  const endpoints = Array.isArray(v.endpoints) ? v.endpoints.filter((e): e is string => typeof e === "string" && !!e) : [];
  return { version: 1, ...(v.settled ? { settled: true } : {}), endpoints };
}

async function persist(res: EndpointConfirmationResources, value: Stored): Promise<void> {
  await res.store.set(res.storeKey, value);
  await res.store.save();
}

/** Whether the endpoint is confirmed on this device; an endpoint that needs no confirmation (null) always is. A list that cannot be read confirms nothing. */
export async function isEndpointConfirmed(res: EndpointConfirmationResources, endpoint: string | null): Promise<boolean> {
  if (!endpoint) return true;
  try {
    return (await load(res)).endpoints.includes(endpoint);
  } catch {
    return false;
  }
}

/** Confirms endpoints on this device: the account was set up or repaired here, or the person confirmed it on the account page. */
export async function confirmEndpoints(res: EndpointConfirmationResources, endpoints: ReadonlyArray<string | null>): Promise<void> {
  const fresh = endpoints.filter((e): e is string => !!e);
  if (!fresh.length) return;
  const current = await load(res);
  const next = [...new Set([...current.endpoints, ...fresh])];
  if (next.length === current.endpoints.length) return;
  await persist(res, { ...current, endpoints: next });
}

/**
 * The one-time switch-over of a vault (F57): every endpoint this device has
 * already used successfully, or whose password was typed here, counts as
 * confirmed — a phone that syncs a Nextcloud over `http` at home asks nothing
 * after the update. Runs once per vault, before anything sends; the shells
 * pass what they can prove for each account (`proven`). Afterwards only a
 * set-up, a repair or the person confirm.
 */
export async function settleEndpointConfirmations(res: EndpointConfirmationResources, proven: () => Promise<ReadonlyArray<string | null>>): Promise<void> {
  const current = await load(res);
  if (current.settled) return;
  const endpoints = (await proven()).filter((e): e is string => !!e);
  await persist(res, { version: 1, settled: true, endpoints: [...new Set([...current.endpoints, ...endpoints])] });
}

/**
 * Refused before anything was sent: the stored password would go to an
 * address this device never confirmed. Carries status 401 so every service
 * treats it as the sign-in it is — parked, not retried every cycle — until
 * the address is confirmed.
 */
export class EndpointNotConfirmedError extends Error {
  readonly status = 401;
  constructor(readonly endpoint: string) {
    super(`not confirmed on this device: ${endpoint}`);
    this.name = "EndpointNotConfirmedError";
  }
}

/** Throws `EndpointNotConfirmedError` unless the endpoint needs no confirmation or is confirmed here. */
export async function assertEndpointConfirmed(res: EndpointConfirmationResources, endpoint: string | null): Promise<void> {
  if (!(await isEndpointConfirmed(res, endpoint))) throw new EndpointNotConfirmedError(endpoint!);
}

/**
 * The list of one vault on this device. `vaultKey` is what the shell names the
 * vault by everywhere else (the desktop its path, the phone its id), so mail,
 * calendar and files of one vault read the same list.
 */
export async function endpointConfirmationsOf(vaultKey: string): Promise<EndpointConfirmationResources> {
  return { store: await getPlatformServices().loadSettings(), storeKey: `endpointConfirmations_${btoa(unescape(encodeURIComponent(vaultKey)))}` };
}

/** The switch-over running per vault: a send path asked meanwhile waits for it. */
const settling = new Map<string, Promise<void>>();

/**
 * `settleEndpointConfirmations` for a vault, at vault open before anything
 * sends. A check that runs while it is still underway waits for it, so the
 * first cycle after the update does not read an account as unconfirmed.
 */
export function settleEndpointConfirmationsIn(vaultKey: string, proven: () => Promise<ReadonlyArray<string | null>>): Promise<void> {
  const running = settling.get(vaultKey);
  if (running) return running;
  const run = endpointConfirmationsOf(vaultKey)
    .then((res) => settleEndpointConfirmations(res, proven))
    .finally(() => settling.delete(vaultKey));
  settling.set(vaultKey, run);
  return run;
}

/** `isEndpointConfirmed` for a vault; a store that cannot be reached confirms nothing. */
export async function isEndpointConfirmedIn(vaultKey: string, endpoint: string | null): Promise<boolean> {
  if (!endpoint) return true;
  try {
    await settling.get(vaultKey)?.catch(() => undefined);
    return await isEndpointConfirmed(await endpointConfirmationsOf(vaultKey), endpoint);
  } catch {
    return false;
  }
}

/** `assertEndpointConfirmed` for a vault: every send path with a stored password asks this first. */
export async function assertEndpointConfirmedIn(vaultKey: string, ...endpoints: Array<string | null>): Promise<void> {
  for (const endpoint of endpoints) {
    if (!(await isEndpointConfirmedIn(vaultKey, endpoint))) throw new EndpointNotConfirmedError(endpoint!);
  }
}

/** `confirmEndpoints` for a vault: after a set-up or repair here, or the person's **Confirm**. */
export async function confirmEndpointsIn(vaultKey: string, endpoints: ReadonlyArray<string | null>): Promise<void> {
  if (!endpoints.some(Boolean)) return;
  await confirmEndpoints(await endpointConfirmationsOf(vaultKey), endpoints);
}

/** The endpoints a mailbox sends its password to: IMAP, and SMTP and Sieve where it has them. */
export function mailboxEndpoints(account: { host?: string; port?: number; smtpHost?: string; smtpPort?: number; sieveHost?: string; sievePort?: number }): Array<string | null> {
  return [
    mailConfirmationEndpoint("imap", account.host, account.port ?? 993),
    account.smtpHost ? mailConfirmationEndpoint("smtp", account.smtpHost, account.smtpPort ?? 587) : null,
    account.sieveHost ? mailConfirmationEndpoint("sieve", account.sieveHost, account.sievePort ?? 4190) : null,
  ];
}

/** An address of an account that this device has not confirmed, with the vault whose list it goes in. */
export interface UnconfirmedEndpoint {
  endpoint: string;
  vaultKey: string;
}

/** Of the addresses an account sends its password to, those this device has not confirmed — one row each on its card. */
export async function unconfirmedEndpointsOf(entries: ReadonlyArray<{ vaultKey: string; endpoint: string | null }>): Promise<UnconfirmedEndpoint[]> {
  const out: UnconfirmedEndpoint[] = [];
  for (const { vaultKey, endpoint } of entries) {
    if (!endpoint || out.some((e) => e.endpoint === endpoint && e.vaultKey === vaultKey)) continue;
    if (!(await isEndpointConfirmedIn(vaultKey, endpoint))) out.push({ endpoint, vaultKey });
  }
  return out;
}
