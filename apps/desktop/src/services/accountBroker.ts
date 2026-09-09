import {
  accountServices,
  resolveFileBrokerAccount,
  type FileBrokerBinding,
  createTokenBroker,
  createTokenRefreshCoordinator,
  normalizeOAuthScopes,
  oauthScopeFor,
  sameStoredAccountToken,
  withAccountCredentialLock,
  replaceOAuthClientRegistration,
  sameOAuthClient,
  googleScopeFor as sharedGoogleScopeFor,
  tokenCoversService,
  type CloudAccountRecord,
  type CloudServiceId,
  type CloudProviderFamily,
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

/** Desktop storage and transport for the shared account broker. Accounts
 * connected through union consent use one stored grant; older per-service
 * connections keep their own source until explicitly reconnected. */

/** Keychain slot for the account-wide token, per vault (ADR 0005 shape). */
export function accountSecretKey(vaultPath: string, accountId: string): string {
  return slot.account(vaultPath, accountId);
}

async function readAccountTokenUnlocked(vaultPath: string, accountId: string): Promise<StoredAccountToken | null> {
  return readSlot<StoredAccountToken>(
    credentialManager,
    slot.account(vaultPath, accountId),
    legacySlot.account(vaultPath, accountId),
  );
}

async function forgetAccountMailRuntime(vaultPath: string, accountId: string): Promise<void> {
  const record = (await loadCloudAccounts(vaultPath)).find((r) => r.id === accountId);
  if (record?.family === "microsoft" && record.services.mail) forgetGraphMailRuntime(vaultPath, record.services.mail.mailAccountId);
}

export async function getAccountToken(vaultPath: string, accountId: string): Promise<StoredAccountToken | null> {
  return withAccountCredentialLock(accountSecretKey(vaultPath, accountId), () => readAccountTokenUnlocked(vaultPath, accountId));
}

async function writeRotatedAccountToken(vaultPath: string, accountId: string, next: StoredAccountToken, expected: StoredAccountToken): Promise<void> {
  await withAccountCredentialLock(accountSecretKey(vaultPath, accountId), async () => {
    if (!sameStoredAccountToken(await readAccountTokenUnlocked(vaultPath, accountId), expected)) {
      throw new Error("account sign-in changed before rotation could be saved");
    }
    await credentialManager.writeSecret(accountSecretKey(vaultPath, accountId), next);
  });
}

export async function saveAccountToken(vaultPath: string, accountId: string, token: StoredAccountToken, expected?: StoredAccountToken | null): Promise<void> {
  await withAccountCredentialLock(accountSecretKey(vaultPath, accountId), async () => {
    if (expected !== undefined) {
      const current = await readAccountTokenUnlocked(vaultPath, accountId);
      if (expected === null ? current !== null : !sameStoredAccountToken(current, expected)) throw new Error("The account sign-in changed. Please try again.");
    }
    forgetAccountBroker(vaultPath, accountId);
    await credentialManager.writeSecret(accountSecretKey(vaultPath, accountId), token);
    if (!sameStoredAccountToken(await readAccountTokenUnlocked(vaultPath, accountId), token)) throw new Error("The account sign-in could not be confirmed in secure storage.");
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
    const current = await readAccountTokenUnlocked(vaultPath, accountId);
    if (current && sameOAuthClient(current, next)) return false;
    forgetAccountBroker(vaultPath, accountId);
    await credentialManager.writeSecret(accountSecretKey(vaultPath, accountId), replaceOAuthClientRegistration(current, next));
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
export function brokerFamily(family: CloudProviderFamily): "microsoft" | "google" | null {
  return family === "microsoft" || family === "google" ? family : null;
}

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
        const stored = await getAccountToken(vaultPath, record.id);
        if (!stored?.refreshToken || !sameOAuthClient(stored, expected) || stored.refreshToken !== expected.refreshToken) continue;
        if (stored.refreshToken === next.refreshToken) continue;
        await writeRotatedAccountToken(vaultPath, record.id, { ...stored, refreshToken: next.refreshToken }, stored);
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
      read: () => getAccountToken(vaultPath, accountId),
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
let pendingAccount: { vaultPath: string; accountId: string; family: "microsoft" | "google" } | null = null;
export function setPendingBrokerAccount(next: { vaultPath: string; accountId: string; family: "microsoft" | "google" } | null): void {
  pendingAccount = next;
}

/** Resolve only a service whose stored grant covers it. Both shells use the
 * same permission rule; each invocation looks up the current broker so a
 * reconnect also reaches providers captured by an already-running worker. */
export async function brokerTokenProvider(
  vaultPath: string,
  service: CloudServiceId,
  /** The asking subsystem account (pim row / mail account), where there is one. */
  subsystemId?: string
): Promise<((force: boolean) => Promise<string>) | undefined> {
  if (service === "files") return undefined; // Files must supply their concrete provider/client below.
  const records = await loadCloudAccounts(vaultPath);
  if (
    pendingAccount &&
    pendingAccount.vaultPath === vaultPath &&
    !belongsToAnotherAccount(records, service, subsystemId, pendingAccount.accountId)
  ) {
    const minted = await getAccountToken(vaultPath, pendingAccount.accountId);
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
  for (const record of brokerCandidates(records, service, subsystemId)) {
    const family = brokerFamily(record.family);
    if (!family) continue;
    const stored = await getAccountToken(vaultPath, record.id);
    if (!stored?.refreshToken) continue;
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
  const resolve = () => loadCloudAccounts(vaultPath).then((records) => resolveFileBrokerAccount(records, binding, (id) => getAccountToken(vaultPath, id)));
  const record = await resolve();
  if (!record) return undefined;
  return async (force) => {
    if ((await resolve())?.id !== record.id) throw new Error("The file account changed. Reconnect file sync.");
    const broker = getAccountBroker(vaultPath, record.id, binding.provider === "drive" ? "google" : "microsoft");
    if (force) broker.forget();
    return broker.getAccessToken("files");
  };
}

/**
 * The records that could serve a service through the broker: a broker family
 * that carries the service. Gmail is excluded — it is IMAP with an app
 * password, never an OAuth audience.
 */
function brokerCandidates(records: CloudAccountRecord[], service: CloudServiceId, subsystemId?: string): CloudAccountRecord[] {
  const carries = records.filter(
    (r) => brokerFamily(r.family) && accountServices(r).includes(service) && !(r.family === "google" && service === "mail"),
  );
  if (!subsystemId) return carries;
  // WHICH account is asking matters as soon as a vault has two of a broker
  // family. Without this, "a calendar token for this vault" answered with the
  // first card that had one — so a Microsoft calendar could be handed the
  // GOOGLE account's token and answer 401 (finding 2026-07-30). No match means
  // no broker: the service falls back to its own sign-in, never to a stranger's.
  return carries.filter((r) => referencedSubsystemId(r, service) === subsystemId);
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
 * progress, so it keeps its own path.
 */
function belongsToAnotherAccount(
  records: CloudAccountRecord[],
  service: CloudServiceId,
  subsystemId: string | undefined,
  pendingId: string
): boolean {
  if (!subsystemId) return false;
  return records.some((r) => r.id !== pendingId && referencedSubsystemId(r, service) === subsystemId);
}

/** The subsystem account a card points its service at (pim row / mail account). */
function referencedSubsystemId(record: CloudAccountRecord, service: CloudServiceId): string | undefined {
  if (service === "calendar") return record.services.calendar?.pimAccountId;
  if (service === "mail") return record.services.mail?.mailAccountId;
  return undefined;
}

/**
 * Why the broker did not answer, in one sentence, for the error a person reads.
 *
 * The settings show the provider's own words under the advice, and "no stored
 * sign-in" alone did not say which sign-in was missing (finding 2026-07-30) —
 * the fix for "the service has none" is connecting the service, the fix for "the
 * account has none" is one login for all services. Never throws: it exists to
 * explain a failure, not to add one.
 */
export async function describeBrokerLookup(vaultPath: string, service: CloudServiceId, subsystemId?: string): Promise<string> {
  try {
    const candidates = brokerCandidates(await loadCloudAccounts(vaultPath), service, subsystemId);
    if (candidates.length === 0) {
      return "this service has no sign-in of its own, and no cloud account carries it — connect it again.";
    }
    let withToken = 0;
    let outOfScope = 0;
    for (const record of candidates) {
      const stored = await getAccountToken(vaultPath, record.id);
      if (!stored) continue;
      withToken++;
      const family = brokerFamily(record.family);
      if (family && !tokenCoversService(stored, service, family)) outOfScope++;
    }
    if (withToken === 0) {
      return `${candidates.length} cloud account(s) carry this service, but none holds the shared sign-in — reconnect the account with "one login for all services".`;
    }
    // The precise case, and the one nobody could have guessed from a 401: the
    // shared sign-in exists but was granted for other services only.
    if (outOfScope === withToken) {
      return `the shared sign-in of this account was granted for its other services only and cannot cover this one — sign in again, which now asks for the whole account.`;
    }
    return `a shared sign-in is stored (${withToken}/${candidates.length}) but could not be used for this service — reconnect the account with "one login for all services".`;
  } catch (err) {
    return `the cloud account list could not be read (${err instanceof Error ? err.message : String(err)}).`;
  }
}
