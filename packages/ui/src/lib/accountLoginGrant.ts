import { accountServices, type CloudAccountRecord, type CloudServiceId } from "./cloudAccounts";
import { oauthScopeFor, oauthScopesCover, type OAuthFamily } from "./oauthScopes";
import type { StoredAccountToken } from "./tokenBroker";
import { normalizeVerifiedProviderIdentity, verifiedProviderIdentityKey, parseGoogleUserInfo, parseMicrosoftMe } from "./accountProfile";
import type { FetchFn } from "@plainva/core";

export function accountOAuthServices(record: CloudAccountRecord): CloudServiceId[] {
  if (record.family !== "google" && record.family !== "microsoft") return [];
  return accountServices(record).filter((service) => record.family !== "google" || service !== "mail");
}

/** The fields that identify which concrete services a reconnect may change.
 * Labels may be edited meanwhile; replacing a service must invalidate the flow. */
export function accountLoginBinding(record: CloudAccountRecord): string {
  const identity = normalizeVerifiedProviderIdentity(record.verifiedProviderIdentity);
  return JSON.stringify({
    id: record.id,
    family: record.family,
    files: record.services.files?.provider ?? null,
    calendar: record.services.calendar?.pimAccountId ?? null,
    mail: record.services.mail?.mailAccountId ?? null,
    identity: identity ? verifiedProviderIdentityKey(identity) : null,
  });
}

export interface AccountGrantReview {
  token: StoredAccountToken;
  services: CloudServiceId[];
  missing: CloudServiceId[];
}

/** A new consent never inherits the historical allowance for Microsoft slots
 * whose scopes were not recorded. The response is checked before persistence. */
export function reviewAccountGrant(
  family: OAuthFamily,
  services: readonly CloudServiceId[],
  token: Omit<StoredAccountToken, "scopes">,
  requestedScope: string,
  grantedScope: unknown,
): AccountGrantReview {
  if (typeof token.clientId !== "string" || !token.clientId.trim()
    || typeof token.refreshToken !== "string" || !token.refreshToken.trim()
    || (token.clientSecret !== undefined && typeof token.clientSecret !== "string")) {
    throw new Error("the provider returned an incomplete sign-in");
  }
  if (grantedScope !== undefined && typeof grantedScope !== "string") throw new Error("the provider returned invalid permissions");
  // Microsoft permits omission when the granted scope equals the request.
  // Google's integration records only an explicit grant from its response.
  const scopes = (grantedScope === undefined ? (family === "microsoft" ? requestedScope : "") : grantedScope).trim();
  const selected = [...new Set(services)].filter((service) => family !== "google" || service !== "mail");
  if (selected.length === 0) throw new Error("this account has no OAuth service");
  const missing = selected.filter((service) => {
    const required = oauthScopeFor(family, service);
    return !required || !oauthScopesCover(scopes, required, family);
  });
  return { token: { ...token, scopes }, services: selected, missing };
}

export class AccountGrantMissingPermissionsError extends Error {
  constructor(readonly missing: readonly CloudServiceId[]) {
    super("The new sign-in does not cover every selected service; existing sign-ins were kept");
    this.name = "AccountGrantMissingPermissionsError";
  }
}

export function requireCompleteAccountGrant(review: AccountGrantReview): StoredAccountToken {
  if (review.missing.length) throw new AccountGrantMissingPermissionsError(review.missing);
  return review.token;
}

export function assertAccountLoginBinding(expected: CloudAccountRecord, current: CloudAccountRecord | undefined): void {
  if (!current || accountLoginBinding(expected) !== accountLoginBinding(current)) {
    throw new Error("The account changed during sign-in. Open its current settings and try again.");
  }
}

/** A known provider subject cannot be replaced by a different browser account.
 * Use the provider API, never an unverified token payload or display label. */
export async function assertAccountGrantIdentity(record: CloudAccountRecord, accessToken: string | undefined, fetchFn: FetchFn): Promise<void> {
  const expected = normalizeVerifiedProviderIdentity(record.verifiedProviderIdentity);
  if (!expected) return;
  if (!accessToken) throw new Error("The provider account could not be verified. Existing sign-ins were kept.");
  const response = await fetchFn(record.family === "google" ? "https://openidconnect.googleapis.com/v1/userinfo" : "https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("The provider account could not be verified. Existing sign-ins were kept.");
  const body = await response.json();
  const profile = record.family === "google" ? parseGoogleUserInfo(body) : parseMicrosoftMe(body);
  if (!profile || verifiedProviderIdentityKey(profile.identity) !== verifiedProviderIdentityKey(expected)) {
    throw new Error("A different provider account was selected. Existing sign-ins were kept.");
  }
}

/** Shared completion boundary. Nothing is saved or detached before every
 * selected service has a usable grant and the original account still exists. */
export async function completeAccountGrant(ports: {
  record: CloudAccountRecord;
  review: AccountGrantReview;
  readRecord(): Promise<CloudAccountRecord | undefined>;
  beforeSave?(): Promise<void>;
  save(token: StoredAccountToken): Promise<void>;
  bind(service: CloudServiceId, token: StoredAccountToken): Promise<void>;
}): Promise<void> {
  const token = requireCompleteAccountGrant(ports.review);
  await ports.readRecord().then((current) => assertAccountLoginBinding(ports.record, current));
  await ports.beforeSave?.();
  await ports.readRecord().then((current) => assertAccountLoginBinding(ports.record, current));
  await ports.save(token);
  for (const service of ports.review.services) {
    await ports.readRecord().then((current) => assertAccountLoginBinding(ports.record, current));
    await ports.bind(service, token);
  }
}
