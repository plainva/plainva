import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { CalDavPimTarget, GooglePimTarget, GraphPimTarget, type PimAccountRow } from "@plainva/core";
import type { PimRuntime } from "./pimRuntime";
import { authorizeGooglePim, authorizeMicrosoftPim, buildPimAuthProvider } from "./pimAuth";
import { savePimCredentials, clearPimCredentials, getPimCredentials, type PimStoredCredentials } from "./pimCredentials";
import { noteAccountRemovedLocally } from "../settingsProfile";
import {
  accountToAdoptInto,
  adoptAccountInto,
  parseGoogleUserInfo,
  parseMicrosoftMe,
  verifiedProviderIdentityOf,
  VERIFIED_PROVIDER_IDENTITY_KEY,
} from "@plainva/ui";

/**
 * Account management used by the settings section: connect flows (validate by
 * actually listing the account's calendars — a connect that cannot list is a
 * failed connect and persists NOTHING), removal (cache + keychain), toggles.
 */

function newAccountId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Proves a CalDAV credential set without touching any stored slot — the
 * counterpart to the mail core's checkMailLogin. Used by the account-wide
 * password update (stage B / B1), which must validate EVERY service before it
 * writes the first one.
 */
/**
 * The desktop has no "device" account by decision (EventKit plan E3): macOS
 * would have EventKit, Windows and Linux have nothing comparable, and a
 * provider that exists on one desktop platform is the kind of asymmetry nobody
 * can explain. The desktop reaches the same calendars through CalDAV, Google
 * and Graph; a row with provider "device" cannot arrive here (the profile
 * never carries one, E8) and would build no target.
 */
export const DESKTOP_PIM_PROVIDERS = ["caldav", "google", "microsoft"] as const;

export async function checkCalDavLogin(opts: { url: string; user: string; pass: string }): Promise<void> {
  const calendars = await new CalDavPimTarget(opts, httpFetch).listCalendars();
  if (calendars.length === 0) throw new Error("No calendars found on this server.");
}

/**
 * Moves a validated connect onto an account this vault already holds, when the
 * provider says they are the same one.
 *
 * The move itself is shared with the phone (`adoptAccountInto`) — including the
 * re-read of the possibly rotated credential and the order the cascade demands.
 * What is local here is the question of WHETHER to adopt, and what the merged
 * account row should say afterwards.
 */
async function adoptIfKnown(
  runtime: PimRuntime,
  vaultPath: string,
  fresh: PimAccountRow,
  creds: PimStoredCredentials
): Promise<PimAccountRow | null> {
  const existing = await runtime.cache.listAccounts().catch(() => [] as PimAccountRow[]);
  const target = accountToAdoptInto(existing, {
    id: fresh.id,
    provider: fresh.provider,
    identity: verifiedProviderIdentityOf(fresh),
  });
  if (!target) return null;

  await adoptAccountInto(
    {
      getCredentials: getPimCredentials,
      saveCredentials: (v, id, c) => savePimCredentials(v, id, c as PimStoredCredentials),
      clearCredentials: clearPimCredentials,
      reassignRows: (from, to) => runtime.cache.reassignAccountRows(from, to),
      deleteAccount: (id) => runtime.cache.deleteAccount(id),
    },
    { vault: vaultPath, freshId: fresh.id, targetId: target.id, validatedCreds: creds },
  );

  // Keep the target's identity, take the fresh label and config: a re-connect
  // is also how a renamed account gets its new name.
  return { ...target, label: fresh.label, config: fresh.config, enabled: true };
}

async function finishConnect(
  runtime: PimRuntime,
  vaultPath: string,
  account: PimAccountRow,
  creds: PimStoredCredentials
): Promise<PimAccountRow> {
  // Is this a repair of an account we already have? Connecting again is the
  // normal fix for an expired sign-in, and every connect mints a new id — so
  // without this the vault ends up with two rows for one account while the
  // task anchors and cursors stay with the old one (C22).
  const adopted = await adoptIfKnown(runtime, vaultPath, account, creds);
  if (adopted) account = adopted;

  // Persist secret + account only after listCalendars proved the connection.
  await savePimCredentials(vaultPath, account.id, creds);
  await runtime.cache.upsertAccount(account);
  const target = await runtime.buildTarget(account);
  if (target) {
    const calendars = await target.listCalendars();
    await runtime.cache.replaceCalendars(account.id, calendars);
    const lists = await target.listTaskLists().catch(() => []);
    await runtime.cache.replaceTaskLists(account.id, lists);
  }
  // First data pull runs in the background — the section renders immediately.
  void runtime.worker.triggerImmediate();
  return account;
}

export async function connectCalDavAccount(
  runtime: PimRuntime,
  vaultPath: string,
  opts: { url: string; user: string; pass: string }
): Promise<PimAccountRow> {
  const target = new CalDavPimTarget({ url: opts.url, user: opts.user, pass: opts.pass }, httpFetch);
  const calendars = await target.listCalendars();
  if (calendars.length === 0) throw new Error("No calendars found on this server.");
  const host = new URL(opts.url).host;
  const account: PimAccountRow = {
    id: newAccountId(),
    provider: "caldav",
    label: `${opts.user}@${host}`,
    config: { url: opts.url, user: opts.user },
    enabled: true,
  };
  return finishConnect(runtime, vaultPath, account, { kind: "caldav", url: opts.url, user: opts.user, pass: opts.pass });
}

export async function connectGoogleAccount(
  runtime: PimRuntime,
  vaultPath: string,
  /**
   * `refreshToken` short-circuits the consent: the cloud-accounts wizard may
   * already hold one from a single union-scope run covering files AND calendar
   * (stage B / B2). `viaBroker` says that token now lives in the ACCOUNT slot,
   * so this slot must NOT keep a copy — copies were what drifted apart and left
   * a calendar dead while the file sync kept working (finding 2026-07-28).
   */
  opts: { clientId: string; clientSecret: string; refreshToken?: string; viaBroker?: boolean }
): Promise<PimAccountRow> {
  const { refreshToken } = opts.viaBroker
    ? { refreshToken: "" }
    : opts.refreshToken
      ? { refreshToken: opts.refreshToken }
      : await authorizeGooglePim(opts);
  const id = newAccountId();
  const creds: PimStoredCredentials = { kind: "google", clientId: opts.clientId, clientSecret: opts.clientSecret, refreshToken };
  // Validate + derive the label: Google's primary calendar id IS the address.
  const auth = buildPimAuthProvider(vaultPath, id, creds);
  const target = new GooglePimTarget(auth, httpFetch);
  const accessToken = await auth.getAccessToken();
  const [calendars, profileResponse] = await Promise.all([
    target.listCalendars(),
    httpFetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => null),
  ]);
  const profile = profileResponse?.ok
    ? parseGoogleUserInfo(await profileResponse.json())
    : null;
  const label = profile?.label ?? calendars.find((c) => c.primary)?.id ?? "Google";
  const account: PimAccountRow = {
    id,
    provider: "google",
    label,
    config: {
      clientId: opts.clientId,
      ...(profile ? { [VERIFIED_PROVIDER_IDENTITY_KEY]: profile.identity } : {}),
    },
    enabled: true,
  };
  return finishConnect(runtime, vaultPath, account, creds);
}

export async function connectMicrosoftAccount(
  runtime: PimRuntime,
  vaultPath: string,
  /**
   * `viaBroker` marks an account whose refresh token lives in the shared
   * account slot (union consent, stage B): no consent of our own, and the
   * per-service slot deliberately stores an empty token because every read
   * goes through the broker.
   */
  opts: { clientId: string; viaBroker?: boolean }
): Promise<PimAccountRow> {
  const { refreshToken } = opts.viaBroker ? { refreshToken: "" } : await authorizeMicrosoftPim(opts);
  const id = newAccountId();
  const creds: PimStoredCredentials = { kind: "microsoft", clientId: opts.clientId, refreshToken };
  const auth = buildPimAuthProvider(vaultPath, id, creds);
  // Label from Graph /me (User.Read is part of the requested scopes).
  let label = "Microsoft";
  let profile: ReturnType<typeof parseMicrosoftMe> = null;
  try {
    const res = await httpFetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${await auth.getAccessToken()}` },
    });
    if (res.ok) {
      const me = await res.json();
      profile = parseMicrosoftMe(me);
      const displayName = (me as { displayName?: unknown }).displayName;
      label = profile?.label
        ?? (typeof displayName === "string" && displayName.trim() ? displayName.trim() : label);
    }
  } catch {
    /* label fallback is fine */
  }
  const target = new GraphPimTarget(auth, httpFetch);
  await target.listCalendars(); // validate before persisting anything
  const account: PimAccountRow = {
    id,
    provider: "microsoft",
    label,
    config: {
      clientId: opts.clientId,
      ...(profile ? { [VERIFIED_PROVIDER_IDENTITY_KEY]: profile.identity } : {}),
    },
    enabled: true,
  };
  return finishConnect(runtime, vaultPath, account, creds);
}

export async function removePimAccount(runtime: PimRuntime, vaultPath: string, accountId: string): Promise<void> {
  // Before it is gone: the tombstone stops the next profile import putting it
  // back, which is what made deleted calendar accounts keep returning (P2).
  await noteAccountRemovedLocally(vaultPath, "pim", accountId).catch(() => {});
  await runtime.cache.deleteAccount(accountId);
  await clearPimCredentials(vaultPath, accountId).catch(() => {});
}

export async function setPimAccountEnabled(runtime: PimRuntime, account: PimAccountRow, enabled: boolean): Promise<void> {
  await runtime.cache.upsertAccount({ ...account, enabled });
  if (enabled) void runtime.worker.triggerImmediate();
}
