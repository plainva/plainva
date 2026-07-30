import { accountServices, createTokenBroker, type CloudAccountRecord, type CloudServiceId, type CloudProviderFamily, type TokenBroker, type StoredAccountToken } from "@plainva/ui";
import { loadCloudAccounts } from "./cloudAccounts";
import {
  DRIVE_DEFAULT_SCOPE,
  GOOGLE_CALENDAR_SCOPES,
  GRAPH_CALENDAR_SCOPES,
  ONEDRIVE_DEFAULT_SCOPE,
  refreshDriveAccessToken,
  refreshOneDriveAccessToken,
} from "@plainva/core";
import { GRAPH_MAIL_SCOPES, forgetAllGraphMailRuntimes } from "@plainva/ui/mail";
import { credentialManager } from "./CredentialManager";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { microsoftAuthFetch } from "./authFetch";

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
  return `account_${accountId}_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
}

export async function getAccountToken(vaultPath: string, accountId: string): Promise<StoredAccountToken | null> {
  return credentialManager.readSecret<StoredAccountToken>(accountSecretKey(vaultPath, accountId));
}

export async function saveAccountToken(vaultPath: string, accountId: string, token: StoredAccountToken): Promise<void> {
  await credentialManager.writeSecret(accountSecretKey(vaultPath, accountId), token);
  forgetAccountBroker(vaultPath, accountId);
  // The Graph mail runtime resolves its token source ONCE, when it is built. A
  // runtime built before this token existed would keep using the per-service
  // slot the migration blanked (finding 2026-07-30).
  forgetAllGraphMailRuntimes();
}

export async function clearAccountToken(vaultPath: string, accountId: string): Promise<void> {
  await credentialManager.removeSecret(accountSecretKey(vaultPath, accountId));
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
  if (audience === "files") return DRIVE_DEFAULT_SCOPE;
  if (audience === "calendar") return GOOGLE_CALENDAR_SCOPES;
  throw new Error(`unknown Google audience: ${audience}`);
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
      },
    },
    refresh: async ({ clientId, clientSecret, refreshToken, scope }) => {
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
    },
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
function googleTokenCovers(token: StoredAccountToken, service: CloudServiceId): boolean {
  if (!token.scopes) return false;
  let needed: string[];
  try {
    needed = googleScopeFor(service).split(/\s+/).filter(Boolean);
  } catch {
    return false; // no Google audience for this service (Gmail is IMAP)
  }
  const granted = new Set(token.scopes.split(/\s+/).filter(Boolean));
  return needed.every((scope) => granted.has(scope));
}

export async function brokerTokenProvider(
  vaultPath: string,
  service: CloudServiceId,
  /** The asking subsystem account (pim row / mail account), where there is one. */
  subsystemId?: string
): Promise<((force: boolean) => Promise<string>) | undefined> {
  if (pendingAccount && pendingAccount.vaultPath === vaultPath) {
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
  const records = await loadCloudAccounts(vaultPath);
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
    if (!stored) continue;
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
