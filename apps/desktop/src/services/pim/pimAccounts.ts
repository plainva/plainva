import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { CalDavPimTarget, GooglePimTarget, GraphPimTarget, type PimAccountRow } from "@plainva/core";
import type { PimRuntime } from "./pimRuntime";
import { authorizeGooglePim, authorizeMicrosoftPim, buildPimAuthProvider } from "./pimAuth";
import { savePimCredentials, clearPimCredentials, type PimStoredCredentials } from "./pimCredentials";

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
export async function checkCalDavLogin(opts: { url: string; user: string; pass: string }): Promise<void> {
  const calendars = await new CalDavPimTarget(opts, httpFetch).listCalendars();
  if (calendars.length === 0) throw new Error("No calendars found on this server.");
}

async function finishConnect(
  runtime: PimRuntime,
  vaultPath: string,
  account: PimAccountRow,
  creds: PimStoredCredentials
): Promise<PimAccountRow> {
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
  const calendars = await target.listCalendars();
  const label = calendars.find((c) => c.primary)?.id ?? "Google";
  const account: PimAccountRow = { id, provider: "google", label, config: { clientId: opts.clientId }, enabled: true };
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
  try {
    const res = await httpFetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${await auth.getAccessToken()}` },
    });
    if (res.ok) {
      const me = (await res.json()) as { userPrincipalName?: string; displayName?: string };
      label = me.userPrincipalName || me.displayName || label;
    }
  } catch {
    /* label fallback is fine */
  }
  const target = new GraphPimTarget(auth, httpFetch);
  await target.listCalendars(); // validate before persisting anything
  const account: PimAccountRow = { id, provider: "microsoft", label, config: { clientId: opts.clientId }, enabled: true };
  return finishConnect(runtime, vaultPath, account, creds);
}

export async function removePimAccount(runtime: PimRuntime, vaultPath: string, accountId: string): Promise<void> {
  await runtime.cache.deleteAccount(accountId);
  await clearPimCredentials(vaultPath, accountId).catch(() => {});
}

export async function setPimAccountEnabled(runtime: PimRuntime, account: PimAccountRow, enabled: boolean): Promise<void> {
  await runtime.cache.upsertAccount({ ...account, enabled });
  if (enabled) void runtime.worker.triggerImmediate();
}
