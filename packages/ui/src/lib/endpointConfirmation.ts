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
 * (`isPrivateHost`), plus what that warning does not name and which stays as
 * it is there (review of F57, finding 5):
 * - every way of writing an address the URL parser reads — `3232235786`,
 *   `0xc0a8010a`, `0300.0250.1.10`, `[::ffff:192.168.1.10]` — read as it
 *   reads it, so a mail host typed so counts like its URL;
 * - an IPv4 address mapped into IPv6 (`::ffff:a.b.c.d`), judged as the IPv4
 *   address it is;
 * - the unspecified addresses `0.0.0.0` and `::`, which reach this machine;
 * - site-local IPv6 (`fec0::/10`, deprecated but still routed in some homes);
 * - `.home.arpa` (RFC 8375), and the names routers give themselves:
 *   `fritz.box` and its names, `speedport.ip` — exactly these, never the
 *   public ending `.box`.
 */
export function isLocalNetworkHost(host: string): boolean {
  const h = canonicalHost(host);
  if (!h) return false;
  const mapped = mappedIpv4(h);
  if (mapped) return isLocalNetworkHost(mapped);
  if (h === "0.0.0.0" || h === "::" || /^fe[c-f][0-9a-f]:/.test(h)) return true;
  if (h === "home.arpa" || h.endsWith(".home.arpa")) return true;
  if (h === "fritz.box" || h.endsWith(".fritz.box") || h === "speedport.ip") return true;
  return isPrivateHost(h);
}

/** The host as the URL parser reads it, without brackets or a final dot; "" when it reads none. */
function canonicalHost(host: string): string {
  const raw = host.trim().toLowerCase().replace(/\.$/, "");
  if (!raw) return "";
  const literal = raw.includes(":") && !raw.startsWith("[") ? `[${raw}]` : raw;
  try {
    return new URL(`http://${literal}/`).hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  } catch {
    return raw.replace(/^\[|\]$/g, "");
  }
}

/** The IPv4 address of an IPv4-mapped IPv6 address (`::ffff:c0a8:10a`, as the parser writes it), or null. */
function mappedIpv4(h: string): string | null {
  const m = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!m) return null;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
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
  const h = canonicalHost(host);
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
 * The one-time switch-over of a vault (F57): every endpoint whose password
 * this device holds and was typed here — not taken through the settings sync
 * — counts as confirmed, so a phone that syncs its own Nextcloud over `http`
 * at home asks nothing after the update. Runs once per vault, before anything
 * sends; the shells pass what they can prove for each account (`proven`).
 * Proof is positive only: no password, no proof. What cannot be read proves
 * nothing either — `proven` throws, nothing is confirmed, the vault stays
 * unsettled and the next start runs it again (review of F57, O1/O2).
 * Afterwards only a set-up or the person confirm.
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
    super(`${REFUSAL_PREFIX}${endpoint}`);
    this.name = "EndpointNotConfirmedError";
  }
}

/**
 * The address an error refused, when it is a refusal of an unconfirmed one
 * (`EndpointNotConfirmedError`, or mail's `MailEndpointNotConfirmedError`) —
 * by name and field too, as an error that crossed a bridge keeps only data.
 * A surface then says **Confirm address: …**, never "signed out".
 */
export function unconfirmedEndpointOf(error: unknown): string | null {
  if (typeof error === "string") return unconfirmedEndpointInText(error);
  if (!error || typeof error !== "object") return null;
  const e = error as { name?: unknown; endpoint?: unknown };
  if ((e.name === "EndpointNotConfirmedError" || e.name === "MailEndpointNotConfirmedError") && typeof e.endpoint === "string") return e.endpoint;
  return null;
}

const REFUSAL_PREFIX = "not confirmed on this device: ";

/**
 * The address in a refusal kept as text — a calendar's last error, a line in
 * the diagnostics: `EndpointNotConfirmedError`'s own message.
 */
export function unconfirmedEndpointInText(text: string): string | null {
  const at = text.indexOf(REFUSAL_PREFIX);
  if (at < 0) return null;
  const endpoint = text.slice(at + REFUSAL_PREFIX.length).split(/\s/)[0];
  return endpoint || null;
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

/**
 * A vault made from another one on this device (the phone's account vault
 * transfer): it starts with exactly the list the transfer carries over and
 * counts as switched over — nothing it brings along is proven again.
 */
export async function adoptEndpointConfirmationsIn(vaultKey: string, endpoints: ReadonlyArray<string | null>): Promise<void> {
  const res = await endpointConfirmationsOf(vaultKey);
  const current = await load(res);
  const fresh = endpoints.filter((e): e is string => !!e);
  await persist(res, { version: 1, settled: true, endpoints: [...new Set([...current.endpoints, ...fresh])] });
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

/**
 * Before a form sends what was typed in it (review of F57, O3): an address is
 * typed here only when its endpoint — the scheme, host and port it is
 * confirmed under — is not one the form was filled in with from the account
 * (`prefilled`; empty for a form that started empty). Such an address is
 * confirmed by sending; every other one must already be confirmed, or nothing
 * is sent and nothing confirmed. A password typed in the form never confirms
 * an address that came with it.
 */
export async function confirmTypedEndpointsIn(vaultKey: string, endpoints: ReadonlyArray<string | null>, prefilled: ReadonlyArray<string | null>): Promise<void> {
  const before = new Set(prefilled.filter((e): e is string => !!e));
  const wanted = endpoints.filter((e): e is string => !!e);
  await assertEndpointConfirmedIn(vaultKey, ...wanted.filter((e) => before.has(e)));
  await confirmEndpointsIn(vaultKey, wanted.filter((e) => !before.has(e)));
}

/** `confirmEndpoints` for a vault: after a set-up here, or the person's **Confirm**. */
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

/**
 * The servers of a mailbox that a mail form does not show — Sieve, carried
 * over from the mailbox the form found or edits: never typed in the form, so
 * never confirmed by sending from it (review of F57, O-4).
 */
export function mailboxEndpointsNotInForm(account: { host?: string; port?: number; smtpHost?: string; smtpPort?: number; sieveHost?: string; sievePort?: number }): Array<string | null> {
  const shown = new Set(mailboxEndpoints({ host: account.host, port: account.port, smtpHost: account.smtpHost, smtpPort: account.smtpPort }));
  return mailboxEndpoints(account).filter((endpoint) => !!endpoint && !shown.has(endpoint));
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
