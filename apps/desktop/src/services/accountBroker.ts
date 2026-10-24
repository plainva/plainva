import {
  brokerCardsFor,
  brokerFamily,
  brokeredSubsystemId,
  describeBrokerLookup as describeSharedBrokerLookup,
  createServiceGrantProbe,
  resolveFileBrokerAccount,
  type FileBrokerBinding,
  createTokenBroker,
  hasStoredAccountGrant,
  createTokenRefreshCoordinator,
  normalizeOAuthScopes,
  oauthScopeFor,
  sameStoredAccountToken,
  accountCredentialGrants,
  primaryAccountToken,
  selectAccountToken,
  mergeAccountToken,
  rotateAccountToken,
  updateAccountCredentials,
  withAccountCredentialLock,
  replaceOAuthClientRegistration,
  sameOAuthClient,
  googleScopeFor as sharedGoogleScopeFor,
  tokenCoversService,
  type CloudAccountRecord,
  type CloudServiceId,
  type OAuthClientRegistration,
  logDiagnostic,
  normalizeVerifiedProviderIdentity,
  verifiedProviderIdentityKey,
  type RefreshResult,
  type TokenBroker,
  type StoredAccountToken,
} from "@plainva/ui";
import { loadCloudAccounts } from "./cloudAccounts";
import { getSettingsStore } from "./settingsStore";
import {
  refreshDriveAccessToken,
  refreshOneDriveAccessToken,
} from "@plainva/core";
import { forgetGraphMailRuntime } from "@plainva/ui/mail";
import { credentialManager } from "./CredentialManager";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { microsoftAuthFetch } from "./authFetch";
import { readSlot, removeSlot } from "@plainva/ui";
import { legacySlot, slot } from "./keychainSlots";
import { accountCredentialStore } from "./accountCredentialStore";

/** Desktop storage and transport for the shared account broker. Accounts
 * connected through union consent use one stored grant; older per-service
 * connections keep their own source until explicitly reconnected. */

/** Keychain slot for the account-wide token, per vault (ADR 0005 shape). */
export function accountSecretKey(vaultPath: string, accountId: string): string {
  return slot.account(vaultPath, accountId);
}

async function readAccountCredentialsUnlocked(vaultPath: string, accountId: string): Promise<unknown> {
  for (const key of [slot.account(vaultPath, accountId), legacySlot.account(vaultPath, accountId)]) {
    const raw = await accountCredentialStore.read(key);
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      if (value === null) throw new Error("The stored account sign-in is invalid");
      return value;
    }
  }
  return readSlot<unknown>(
    credentialManager,
    slot.account(vaultPath, accountId),
    legacySlot.account(vaultPath, accountId),
  );
}

async function forgetAccountMailRuntime(vaultPath: string, accountId: string): Promise<void> {
  const record = (await loadCloudAccounts(vaultPath)).find((r) => r.id === accountId);
  if (record?.family === "microsoft" && record.services.mail) forgetGraphMailRuntime(vaultPath, record.services.mail.mailAccountId);
}

export async function getAccountToken(vaultPath: string, accountId: string, audience?: string, family?: "google" | "microsoft", client?: OAuthClientRegistration): Promise<StoredAccountToken | null> {
  return withAccountCredentialLock(accountSecretKey(vaultPath, accountId), async () => {
    const raw = await readAccountCredentialsUnlocked(vaultPath, accountId);
    return audience && family ? selectAccountToken(raw, family, audience, client) : primaryAccountToken(raw);
  });
}

async function writeRotatedAccountToken(vaultPath: string, accountId: string, next: StoredAccountToken, expected: StoredAccountToken): Promise<void> {
  await withAccountCredentialLock(accountSecretKey(vaultPath, accountId), async () => {
    await updateAccountCredentials(accountCredentialStore, accountSecretKey(vaultPath, accountId),
      (current) => rotateAccountToken(current, next, expected), () => readAccountCredentialsUnlocked(vaultPath, accountId));
  });
}

export async function saveAccountToken(vaultPath: string, accountId: string, token: StoredAccountToken, expected?: StoredAccountToken | null): Promise<void> {
  await withAccountCredentialLock(accountSecretKey(vaultPath, accountId), async () => {
    await updateAccountCredentials(accountCredentialStore, accountSecretKey(vaultPath, accountId), (raw) => {
      if (expected !== undefined) {
        const current = primaryAccountToken(raw);
        if (expected === null ? current !== null : !sameStoredAccountToken(current, expected)) throw new Error("The account sign-in changed. Please try again.");
      }
      return mergeAccountToken(raw, token);
    }, () => readAccountCredentialsUnlocked(vaultPath, accountId));
    forgetAccountBroker(vaultPath, accountId);
  });
  // The Graph mail runtime resolves its token source ONCE, when it is built. A
  // runtime built before this token existed would keep using the per-service
  // slot the migration blanked (finding 2026-07-30).
  await forgetAccountMailRuntime(vaultPath, accountId);
}

/**
 * Changes this installation's client registration without ever pairing the
 * new client with the old token. Returns true when a local re-auth is needed.
 */
export async function replaceAccountClientRegistration(
  vaultPath: string,
  accountId: string,
  next: OAuthClientRegistration,
): Promise<boolean> {
  return withAccountCredentialLock(accountSecretKey(vaultPath, accountId), async () => {
    const current = primaryAccountToken(await readAccountCredentialsUnlocked(vaultPath, accountId));
    if (current && sameOAuthClient(current, next)) return false;
    forgetAccountBroker(vaultPath, accountId);
    await updateAccountCredentials(accountCredentialStore, accountSecretKey(vaultPath, accountId), (raw) =>
      mergeAccountToken(raw, replaceOAuthClientRegistration(primaryAccountToken(raw), next)),
    () => readAccountCredentialsUnlocked(vaultPath, accountId));
    await forgetAccountMailRuntime(vaultPath, accountId);
    return true;
  });
}

export async function clearAccountToken(vaultPath: string, accountId: string): Promise<void> {
  await withAccountCredentialLock(accountSecretKey(vaultPath, accountId), async () => {
    forgetAccountBroker(vaultPath, accountId);
    await removeSlot(credentialManager, slot.account(vaultPath, accountId), legacySlot.account(vaultPath, accountId));
    await forgetAccountMailRuntime(vaultPath, accountId);
  });
}

/** Delegated Graph scopes per audience — the union of what the account uses. */
export function microsoftScopeFor(audience: string): string {
  const scope = oauthScopeFor("microsoft", audience);
  if (!scope) throw new Error(`unknown audience: ${audience}`);
  return scope;
}

/**
 * Google scopes per audience. Mail is absent on purpose: Gmail is reached over
 * IMAP with an app password (the CASA decision), so a Google account never asks
 * this for a mail token.
 */
export function googleScopeFor(audience: string): string {
  const scope = sharedGoogleScopeFor(audience);
  if (!scope) throw new Error(`unknown Google audience: ${audience}`);
  return scope;
}

/** Families whose services can share one refresh token through the broker. */
export { brokerFamily };

/** Union of the scopes of the services an account actually connects. */
export function microsoftUnionScope(audiences: readonly string[]): string {
  const parts = new Set<string>();
  for (const audience of audiences) {
    for (const scope of microsoftScopeFor(audience).split(/\s+/)) if (scope) parts.add(scope);
  }
  return [...parts].join(" ");
}

/** A verified identity and local client identify a coordination lane. They
 * do not prove two independently issued grants are the same: request sharing
 * and rotation propagation also compare the actual predecessor credential.
 * Microsoft does not immediately revoke the previous token on rotation. The
 * coordinator preserves ordering and permissions without assuming it does. */
function grantKeyOf(identity: unknown, clientId: string): string | null {
  const verified = normalizeVerifiedProviderIdentity(identity);
  if (!verified || !clientId) return null;
  return verifiedProviderIdentityKey(verified) + " " + clientId;
}

async function grantKeyFor(vaultPath: string, accountId: string, clientId: string): Promise<string | null> {
  try {
    const record = (await loadCloudAccounts(vaultPath)).find((r) => r.id === accountId);
    return grantKeyOf(record?.verifiedProviderIdentity, clientId);
  } catch {
    return null;
  }
}

/** Sharing includes persistence and is specific to the requested rights. */
let grantRefreshCoordinator: ReturnType<typeof createTokenRefreshCoordinator<RefreshResult>> | undefined;
function getGrantRefreshCoordinator() {
  return grantRefreshCoordinator ??= createTokenRefreshCoordinator<RefreshResult>();
}

/** Every vault this installation knows about — open ones first. */
async function knownVaultPaths(): Promise<string[]> {
  const store = await getSettingsStore();
  const open = (await store.get<string[]>("lastVaultPaths")) ?? [];
  const recents = (await store.get<string[]>("recentVaults")) ?? [];
  return [...new Set([...open, ...recents])];
}

/** Carries a confirmed rotation to matching predecessor slots. An unavailable
 * vault is reported and left alone; no claim is made that it received the new
 * credential. Independent or newer consents are never replaced. */
async function shareRotatedToken(homeVault: string, accountId: string, next: StoredAccountToken, expected: StoredAccountToken): Promise<void> {
  if (!next.refreshToken) return;
  const key = await grantKeyFor(homeVault, accountId, next.clientId);
  if (!key) return;

  for (const vaultPath of await knownVaultPaths()) {
    if (vaultPath === homeVault) continue;
    try {
      for (const record of await loadCloudAccounts(vaultPath)) {
        if (grantKeyOf(record.verifiedProviderIdentity, next.clientId) !== key) continue;
        const storedGrants = await withAccountCredentialLock(accountSecretKey(vaultPath, record.id), async () => accountCredentialGrants(await readAccountCredentialsUnlocked(vaultPath, record.id)));
        for (const stored of storedGrants) {
          if (!stored.refreshToken || !sameOAuthClient(stored, expected) || stored.refreshToken !== expected.refreshToken) continue;
          if (stored.refreshToken === next.refreshToken) continue;
          await writeRotatedAccountToken(vaultPath, record.id, { ...stored, refreshToken: next.refreshToken }, stored);
        }
      }
    } catch (err) {
      logDiagnostic(
        "sync",
        "could not carry a rotated sign-in into " + vaultPath + ": " + (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}

/** Test seam: no production invalidation discards pending storage work. */
export function resetGrantSharingForTests(): void {
  grantRefreshCoordinator = undefined;
}

/**
 * One broker instance per (vault, account) so the single-flight guarantee
 * actually holds across the three subsystems — a fresh instance per call would
 * give every consumer its own in-flight map and defeat the purpose.
 */
const brokers = new Map<string, TokenBroker>();

async function adoptLegacyGrant(vaultPath: string, record: CloudAccountRecord, service: CloudServiceId): Promise<boolean> {
  try {
    const { migrateLegacyAccountGrant } = await import("./accountGrantMigration");
    await migrateLegacyAccountGrant(vaultPath, record, service);
    return true;
  } catch {
    logDiagnostic("sync", `The existing ${service} sign-in could not be adopted; its service source was kept.`);
    return false;
  }
}

export function getAccountBroker(vaultPath: string, accountId: string, family: "microsoft" | "google" = "microsoft"): TokenBroker {
  const key = JSON.stringify([accountSecretKey(vaultPath, accountId), family]);
  const existing = brokers.get(key);
  if (existing) return existing;

  const coordinator = getGrantRefreshCoordinator();
  const grants = new Set<string>();
  const broker = createTokenBroker({
    family,
    onForget: () => { for (const grant of grants) coordinator.forget(grant); },
    coordinateRefresh: async (stored, scope, execute) => {
      const identity = await grantKeyFor(vaultPath, accountId, stored.clientId);
      const grant = identity ? JSON.stringify([identity, stored.clientSecret ?? ""]) : key;
      grants.add(grant);
      const request = JSON.stringify([stored.clientId, stored.clientSecret ?? "", stored.refreshToken, normalizeOAuthScopes(scope, family)]);
      return coordinator.run(grant, request, execute);
    },
    store: {
      read: (audience, client) => getAccountToken(vaultPath, accountId, audience, family, client),
      write: async (next, expected) => {
        await writeRotatedAccountToken(vaultPath, accountId, next, expected);
        await shareRotatedToken(vaultPath, accountId, next, expected);
      },
    },
    refresh: async ({ clientId, clientSecret, refreshToken, scope }) => {
      if (family === "google") {
        // Preserve the actual scope returned by the refresh endpoint.
        const tokens = await refreshDriveAccessToken(
          { clientId, clientSecret: clientSecret ?? "", refreshToken },
          httpFetch
        );
        return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, scope: tokens.scope };
      }
      const tokens = await refreshOneDriveAccessToken({ clientId, refreshToken, scope }, microsoftAuthFetch);
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        scope: tokens.scope,
      };
    },
    scopeFor: family === "google" ? googleScopeFor : microsoftScopeFor,
  });
  brokers.set(key, broker);
  return broker;
}

export function forgetAccountBroker(vaultPath: string, accountId: string): void {
  for (const family of ["google", "microsoft"]) {
    const key = JSON.stringify([accountSecretKey(vaultPath, accountId), family]);
    brokers.get(key)?.forget();
    brokers.delete(key);
  }
}

export function calendarGrantProbe(vaultPath: string, accountId: string, family: "google" | "microsoft", client: { clientId: string; clientSecret?: string }, allowUnbound = false) {
  return createServiceGrantProbe({ accountId, family, service: "calendar", ...client, allowUnbound }, {
    records: () => loadCloudAccounts(vaultPath),
    token: () => getAccountToken(vaultPath, accountId, "calendar", family, client),
    accessToken: async (force) => {
      const broker = getAccountBroker(vaultPath, accountId, family);
      if (force) broker.forget();
      return broker.getAccessToken("calendar", client);
    },
  });
}

/**
 * The ONE place that decides whether a service draws its access token from the
 * account broker: the account must be a broker family, must carry that service,
 * and must actually have an account-wide token (i.e. it was connected through the
 * union consent). Everything else keeps its per-service refresh path, so
 * accounts connected before stage B are untouched.
 *
 * Returns the provider shape `OneDriveSyncTarget.accessTokenProvider` and the
 * PIM/mail runtimes expect: `force` drops a cached token the server rejected.
 */
/**
 * Set while the wizard connects a Microsoft account through the union consent:
 * the account slot already holds the token, but the registry record only comes
 * into being after all services bound. Without this, the very validations that
 * run DURING the connect (listing calendars, reading the mailbox address)
 * would find no account and fall back to an empty per-service token.
 */
interface PendingBrokerAccount {
  vaultPath: string;
  accountId: string;
  family: "microsoft" | "google";
  /** The mailbox this connect creates — the one mailbox the marker answers. */
  mailAccountId?: string;
}
let pendingAccount: PendingBrokerAccount | null = null;
export function setPendingBrokerAccount(next: PendingBrokerAccount | null): void {
  pendingAccount = next;
}

/**
 * The connect in progress names the mailbox it is creating, before anything
 * asks on that mailbox's behalf.
 *
 * A mailbox is not "part of the connect" because no card claims it yet. That
 * reading failed in both directions: a mailbox that has its own sign-in and no
 * card drew the sign-in of the account being connected — and kept it, the
 * mail runtime decides once where its token comes from; and the connect's own
 * mailbox lost the token the moment a card was written for it, which the
 * registry reconcile does for every mailbox it finds, also for one the wizard
 * saved a moment ago. So the marker answers the mailbox that was named, and no
 * other.
 */
export function claimPendingMailbox(vaultPath: string, mailAccountId: string): void {
  if (pendingAccount && pendingAccount.vaultPath === vaultPath) pendingAccount = { ...pendingAccount, mailAccountId };
}

/** Whether the account being connected right now answers this question. */
function pendingAnswers(
  pending: PendingBrokerAccount,
  records: CloudAccountRecord[],
  service: CloudServiceId,
  subsystemId: string
): boolean {
  if (service === "mail") return pending.mailAccountId === subsystemId;
  return !belongsToAnotherAccount(records, service, subsystemId, pending.accountId);
}

/** Resolve only a service whose stored grant covers it. Both shells use the
 * same permission rule; each invocation looks up the current broker so a
 * reconnect also reaches providers captured by an already-running worker. */
export async function brokerTokenProvider(
  vaultPath: string,
  service: CloudServiceId,
  /**
   * The subsystem account that is asking (pim row / mail account). Required:
   * as an option it could be left out, and mail left it out — every mailbox of
   * a vault then drew the sign-in of the first card (finding 2026-10-12).
   */
  subsystemId: string
): Promise<((force: boolean) => Promise<string>) | undefined> {
  if (service === "files") return undefined; // Files must supply their concrete provider/client below.
  // Nobody asking is nobody to answer — not even the connect in progress.
  if (!subsystemId) return undefined;
  const records = await loadCloudAccounts(vaultPath);
  if (
    pendingAccount &&
    pendingAccount.vaultPath === vaultPath &&
    pendingAnswers(pendingAccount, records, service, subsystemId)
  ) {
    const minted = await getAccountToken(vaultPath, pendingAccount.accountId, service, pendingAccount.family);
    // The same scope rule as below: a consent that just covered file sync must
    // not be handed to the calendar mid-connect either.
    if (minted && tokenCoversService(minted, service, pendingAccount.family)) {
      const { accountId, family } = pendingAccount;
      return async (force: boolean) => {
        const broker = getAccountBroker(vaultPath, accountId, family);
        if (force) broker.forget();
        return broker.getAccessToken(service);
      };
    }
  }
  // Google joined Microsoft here (2026-07-28): its consent has always covered
  // the whole account, but the token was copied into every service slot and
  // the copies drifted apart. Accounts without an account slot keep their
  // per-service path untouched (E8).
  //
  // EVERY candidate is tried, not just the first (finding 2026-07-30): the
  // reconcile can hold more than one record of a family, and one without an
  // account token used to shadow the one that actually had the sign-in.
  // A candidate is a card that points at the account that asks, and no other
  // (`brokerCardsFor`): no match means no broker, and the service falls back
  // to its own sign-in — never to a stranger's.
  for (const record of brokerCardsFor(records, service, subsystemId)) {
    const family = brokerFamily(record.family);
    if (!family) continue;
    if (!await adoptLegacyGrant(vaultPath, record, service)) continue;
    const stored = await getAccountToken(vaultPath, record.id, service, family);
    if (!hasStoredAccountGrant(stored)) continue;
    if (!tokenCoversService(stored, service, family)) continue;
    return async (force: boolean) => {
      const broker = getAccountBroker(vaultPath, record.id, family);
      if (force) broker.forget();
      return broker.getAccessToken(service);
    };
  }
  return undefined;
}

export async function fileBrokerTokenProvider(vaultPath: string, binding: FileBrokerBinding): Promise<((force: boolean) => Promise<string>) | undefined> {
  const candidates = (await loadCloudAccounts(vaultPath)).filter((record) => record.family === (binding.provider === "drive" ? "google" : "microsoft")
    && record.services.files?.provider === binding.provider && (!binding.accountId || record.id === binding.accountId));
  for (const candidate of candidates) if (!await adoptLegacyGrant(vaultPath, candidate, "files")) return undefined;
  const resolve = () => loadCloudAccounts(vaultPath).then((records) => resolveFileBrokerAccount(records, binding, (id) => getAccountToken(vaultPath, id, "files", binding.provider === "drive" ? "google" : "microsoft", binding)));
  const record = await resolve();
  if (!record) return undefined;
  return async (force) => {
    if ((await resolve())?.id !== record.id) throw new Error("The file account changed. Reconnect file sync.");
    const broker = getAccountBroker(vaultPath, record.id, binding.provider === "drive" ? "google" : "microsoft");
    if (force) broker.forget();
    return broker.getAccessToken("files", binding);
  };
}

/**
 * Whether the asking subsystem already belongs to a card OTHER than the one
 * being connected right now.
 *
 * The pending marker exists so the validations that run DURING a connect find
 * the freshly minted token, before the registry record exists. But the workers
 * keep running meanwhile — and the marker outlived its connect, so from the
 * moment a second account was added, every service of the vault drew that
 * account's token: the Google calendar was handed the MICROSOFT access token
 * and Google answered 401 UNAUTHENTICATED "Expected OAuth 2 access token",
 * which reads exactly like a revoked sign-in. Deleting the new account made it
 * disappear, because that removed the token the marker pointed at (finding
 * 2026-07-30).
 *
 * A subsystem that some card already claims is never part of the connect in
 * progress, so it keeps its own path. That only holds when the subsystem is
 * named: mail asked without its mailbox until 2026-10-12, so for the length of
 * a connect every OAuth mailbox of the vault drew the token just minted for
 * the new account.
 *
 * This is the calendar's rule. Mail no longer asks it: the connect names the
 * mailbox it creates (`claimPendingMailbox`), and the marker answers that one.
 */
function belongsToAnotherAccount(
  records: CloudAccountRecord[],
  service: CloudServiceId,
  subsystemId: string,
  pendingId: string
): boolean {
  return records.some((r) => r.id !== pendingId && brokeredSubsystemId(r, service) === subsystemId);
}

/**
 * Why the broker did not answer for this account, in one sentence, for the
 * error a person reads — the shared rule (`@plainva/ui`) over this shell's
 * registry and account slots.
 */
export async function describeBrokerLookup(vaultPath: string, service: CloudServiceId, subsystemId: string): Promise<string> {
  return describeSharedBrokerLookup(
    {
      records: () => loadCloudAccounts(vaultPath),
      token: (accountId, forService, family) => getAccountToken(vaultPath, accountId, forService, family),
    },
    service,
    subsystemId,
  );
}
