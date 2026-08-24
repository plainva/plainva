import {
  accountServices,
  createTokenBroker,
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
  GRAPH_CALENDAR_SCOPES,
  ONEDRIVE_DEFAULT_SCOPE,
  refreshDriveAccessToken,
  refreshOneDriveAccessToken,
} from "@plainva/core";
import { GRAPH_MAIL_SCOPES, forgetAllGraphMailRuntimes } from "@plainva/ui/mail";
import { credentialManager } from "./CredentialManager";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { microsoftAuthFetch } from "./authFetch";
import { readSlot, removeSlot } from "@plainva/ui";
import { legacySlot, slot } from "./keychainSlots";

/**
 * Desktop wiring of the shared token broker (cloud accounts stage B / B3).
 *
 * A Microsoft or Google account connected through the wizard's union consent
 * keeps ONE refresh token in an account slot; file sync, calendar and mail all
 * draw their access tokens from here instead of holding a copy each. Accounts
 * connected before this existed keep their per-service slots and their old
 * refresh paths — nothing is migrated behind the user's back (decision E8).
 *
 * Google was added on 2026-07-28. Its consent had covered the whole account
 * from the start, but the resulting token was COPIED into each service's slot,
 * on the reasoning that Google tokens do not rotate. They do not — yet the
 * copies still drifted: renewing one service wrote one slot and left the others
 * holding a dead token, which is how a vault ended up syncing files happily
 * while its calendar reported invalid_grant.
 */

/** Keychain slot for the account-wide token, per vault (ADR 0005 shape). */
export function accountSecretKey(vaultPath: string, accountId: string): string {
  return slot.account(vaultPath, accountId);
}

export async function getAccountToken(vaultPath: string, accountId: string): Promise<StoredAccountToken | null> {
  return readSlot<StoredAccountToken>(
    credentialManager,
    slot.account(vaultPath, accountId),
    legacySlot.account(vaultPath, accountId),
  );
}

export async function saveAccountToken(vaultPath: string, accountId: string, token: StoredAccountToken): Promise<void> {
  await credentialManager.writeSecret(accountSecretKey(vaultPath, accountId), token);
  forgetAccountBroker(vaultPath, accountId);
  // The Graph mail runtime resolves its token source ONCE, when it is built. A
  // runtime built before this token existed would keep using the per-service
  // slot the migration blanked (finding 2026-07-30).
  forgetAllGraphMailRuntimes();
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
  const current = await getAccountToken(vaultPath, accountId);
  if (current && sameOAuthClient(current, next)) return false;
  await saveAccountToken(vaultPath, accountId, replaceOAuthClientRegistration(current, next));
  return true;
}

export async function clearAccountToken(vaultPath: string, accountId: string): Promise<void> {
  await removeSlot(credentialManager, slot.account(vaultPath, accountId), legacySlot.account(vaultPath, accountId));
  forgetAccountBroker(vaultPath, accountId);
}

/** Delegated Graph scopes per audience — the union of what the account uses. */
export function microsoftScopeFor(audience: string): string {
  if (audience === "files") return ONEDRIVE_DEFAULT_SCOPE;
  if (audience === "calendar") return GRAPH_CALENDAR_SCOPES;
  if (audience === "mail") return GRAPH_MAIL_SCOPES;
  throw new Error(`unknown audience: ${audience}`);
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

/**
 * ONE GRANT, SEVERAL VAULTS (multi-window stage D, plan § 5.5).
 *
 * A refresh token does not belong to a vault. It belongs to a GRANT — the
 * identity the provider confirmed, plus the local OAuth client that minted it —
 * and the same account connected in two vaults holds that one grant in two
 * keychain slots. Microsoft and Dropbox rotate the refresh token on every
 * renewal, so the second vault's renewal invalidates the first vault's copy.
 * Until stage D only one vault was ever open, so the case could not arise.
 *
 * Two halves, and neither can replace the other:
 *
 * - the **gate** below covers the concurrent case (two windows renew in the
 *   same second — they share one round trip and one answer);
 * - the **write-through** in `getAccountBroker`'s store covers the sequential
 *   one (an hour later, another vault renews from a token that has since been
 *   rotated away) — and it also heals a vault that is closed right now.
 *
 * A label is not an identity: two people in one company are easily called the
 * same thing, which is why the settings sync refuses to merge on a label. And
 * the client id must match too, because a refresh token is bound to the client
 * that issued it — the same person under a different registration is a
 * different grant.
 */
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

/** Renewals in flight, keyed by grant rather than by vault. */
const refreshInFlight = new Map<string, Promise<RefreshResult>>();

async function sharedRefresh(key: string | null, run: () => Promise<RefreshResult>): Promise<RefreshResult> {
  // No provable grant: no sharing. Renewing on its own is the behaviour that
  // existed before, and it is the safe side of this decision.
  if (!key) return run();
  const running = refreshInFlight.get(key);
  if (running) return running;
  const started = run().finally(() => {
    refreshInFlight.delete(key);
  });
  refreshInFlight.set(key, started);
  return started;
}

/** Every vault this installation knows about — open ones first. */
async function knownVaultPaths(): Promise<string[]> {
  const store = await getSettingsStore();
  const open = (await store.get<string[]>("lastVaultPaths")) ?? [];
  const recents = (await store.get<string[]>("recentVaults")) ?? [];
  return [...new Set([...open, ...recents])];
}

/**
 * Carries a rotated refresh token into every other slot that holds the same
 * grant.
 *
 * Best effort on purpose: the home slot is written (and awaited) by the broker
 * itself, and losing THAT is what locks an account out. A vault whose registry
 * cannot be read — one on a drive that is not plugged in — must not take the
 * renewal down with it; it is simply healed the next time it is reachable.
 *
 * `credentialManager.writeSecret` rather than `saveAccountToken`: the latter
 * also drops the Graph mail runtimes app-wide, which is right after a reconnect
 * and pure noise for an hourly rotation.
 */
async function shareRotatedToken(homeVault: string, accountId: string, next: StoredAccountToken): Promise<void> {
  if (!next.refreshToken) return;
  const key = await grantKeyFor(homeVault, accountId, next.clientId);
  if (!key) return;

  for (const vaultPath of await knownVaultPaths()) {
    if (vaultPath === homeVault) continue;
    try {
      for (const record of await loadCloudAccounts(vaultPath)) {
        if (grantKeyOf(record.verifiedProviderIdentity, next.clientId) !== key) continue;
        const stored = await getAccountToken(vaultPath, record.id);
        if (!stored?.refreshToken || stored.clientId !== next.clientId) continue;
        if (stored.refreshToken === next.refreshToken) continue;
        await credentialManager.writeSecret(accountSecretKey(vaultPath, record.id), {
          ...stored,
          refreshToken: next.refreshToken,
        });
      }
    } catch (err) {
      logDiagnostic(
        "sync",
        "could not carry a rotated sign-in into " + vaultPath + ": " + (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}

async function sharedRefreshFor(
  vaultPath: string,
  accountId: string,
  clientId: string,
  run: () => Promise<RefreshResult>,
): Promise<RefreshResult> {
  return sharedRefresh(await grantKeyFor(vaultPath, accountId, clientId), run);
}

/** Test seam: forgets which renewals are in flight. */
export function resetGrantSharingForTests(): void {
  refreshInFlight.clear();
}

/**
 * One broker instance per (vault, account) so the single-flight guarantee
 * actually holds across the three subsystems — a fresh instance per call would
 * give every consumer its own in-flight map and defeat the purpose.
 */
const brokers = new Map<string, TokenBroker>();

export function getAccountBroker(vaultPath: string, accountId: string, family: "microsoft" | "google" = "microsoft"): TokenBroker {
  const key = accountSecretKey(vaultPath, accountId);
  const existing = brokers.get(key);
  if (existing) return existing;

  const broker = createTokenBroker({
    store: {
      read: () => getAccountToken(vaultPath, accountId),
      write: async (next) => {
        await credentialManager.writeSecret(accountSecretKey(vaultPath, accountId), next);
        await shareRotatedToken(vaultPath, accountId, next);
      },
    },
    refresh: ({ clientId, clientSecret, refreshToken, scope }) => sharedRefreshFor(vaultPath, accountId, clientId, async () => {
      if (family === "google") {
        // Google does not rotate refresh tokens, so nothing comes back to
        // persist — but the single-flight and the one shared copy are what
        // this is about, not rotation.
        const tokens = await refreshDriveAccessToken(
          { clientId, clientSecret: clientSecret ?? "", refreshToken },
          httpFetch
        );
        return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
      }
      const tokens = await refreshOneDriveAccessToken({ clientId, refreshToken, scope }, microsoftAuthFetch);
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
      };
    }),
    scopeFor: family === "google" ? googleScopeFor : microsoftScopeFor,
  });
  brokers.set(key, broker);
  return broker;
}

export function forgetAccountBroker(vaultPath: string, accountId: string): void {
  brokers.delete(accountSecretKey(vaultPath, accountId));
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

/**
 * Whether a Google account token can serve this service AT ALL.
 *
 * Google ignores the `scope` parameter of a refresh_token grant: the access
 * token carries exactly what the CONSENT granted, and no later request widens
 * it. Drive and calendar/tasks are disjoint scope sets, so an account slot
 * minted by a Drive-only consent can never serve the calendar — it hands over a
 * Drive token, and Google answers with 401 UNAUTHENTICATED, which reads like an
 * expired sign-in and cannot be fixed by signing in again.
 *
 * That is what broke the calendar of an account whose file sync kept working
 * (finding 2026-07-30): stage B made the calendar PREFER the shared slot over
 * its own, perfectly good, per-service token. Microsoft is the opposite case —
 * it honours the requested scope on every refresh — which is why this guards
 * Google alone.
 *
 * A slot without recorded scopes cannot PROVE coverage, so it does not get to
 * claim the service: the fallback is the service's own sign-in, which is what
 * worked before any of this existed. Every writer of a Google account slot has
 * recorded its scopes from the start, so this costs nothing real — while
 * trusting an unprovable slot costs a 401 that no re-authorisation can clear.
 */
/**
 * Does this slot prove it carries the service? The rule itself now lives once
 * in `@plainva/ui` — the phone answered the same question with its own copy,
 * and two copies of a decision are how one account came to be judged
 * differently on two devices (finding 2026-08-19).
 */
function googleTokenCovers(token: StoredAccountToken, service: CloudServiceId): boolean {
  return tokenCoversService(token, service, "google");
}

export async function brokerTokenProvider(
  vaultPath: string,
  service: CloudServiceId,
  /** The asking subsystem account (pim row / mail account), where there is one. */
  subsystemId?: string
): Promise<((force: boolean) => Promise<string>) | undefined> {
  const records = await loadCloudAccounts(vaultPath);
  if (
    pendingAccount &&
    pendingAccount.vaultPath === vaultPath &&
    !belongsToAnotherAccount(records, service, subsystemId, pendingAccount.accountId)
  ) {
    const minted = await getAccountToken(vaultPath, pendingAccount.accountId);
    // The same scope rule as below: a consent that just covered file sync must
    // not be handed to the calendar mid-connect either.
    if (minted && (pendingAccount.family !== "google" || googleTokenCovers(minted, service))) {
      const broker = getAccountBroker(vaultPath, pendingAccount.accountId, pendingAccount.family);
      return async (force: boolean) => {
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
    if (family === "google" && !googleTokenCovers(stored, service)) continue;
    const broker = getAccountBroker(vaultPath, record.id, family);
    return async (force: boolean) => {
      if (force) broker.forget();
      return broker.getAccessToken(service);
    };
  }
  return undefined;
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
      if (brokerFamily(record.family) === "google" && !googleTokenCovers(stored, service)) outOfScope++;
    }
    if (withToken === 0) {
      return `${candidates.length} cloud account(s) carry this service, but none holds the shared sign-in — reconnect the account with "one login for all services".`;
    }
    // The precise case, and the one nobody could have guessed from a 401: the
    // shared sign-in exists but was granted for other services only.
    if (outOfScope === withToken) {
      return `the shared sign-in of this Google account was granted for its other services only and cannot cover this one — sign in again, which now asks for the whole account.`;
    }
    return `a shared sign-in is stored (${withToken}/${candidates.length}) but could not be used for this service — reconnect the account with "one login for all services".`;
  } catch (err) {
    return `the cloud account list could not be read (${err instanceof Error ? err.message : String(err)}).`;
  }
}
