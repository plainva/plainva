/**
 * Turning a stored OAuth failure into something a person can act on.
 *
 * Account failures reach the surface as plain strings: the PIM worker writes
 * `lastError` into its scope state, and by the time the settings show it there
 * is no Error object left to inspect. So the classification works on the text —
 * which is exactly why the core keeps the provider's machine-readable `error`
 * code in the message (see `sync/oauthError.ts`).
 *
 * The distinction that matters is between "your sign-in is gone, connect the
 * account again" and "the app registration is wrong, fixing it is a trip to the
 * provider's console". Until now both arrived as `400 Bad Request` next to a
 * "Try again" button that could never help (finding 2026-07-28).
 */

export type AuthErrorKind =
  /** The authorisation is gone: revoked, expired, or the token was replaced. */
  | "expired"
  /** Client id/secret/redirect are wrong — the console, not the app. */
  | "config"
  /** Never reached the provider; retrying is genuinely the right move. */
  | "network"
  | "unknown";

/**
 * Thrown instead of a doomed refresh when there is no refresh token to send.
 *
 * An account migrated to the shared account slot keeps its per-service slots
 * EMPTY by design; asking the provider to renew nothing earned an
 * `AADSTS900144` that read like a broken account (finding 2026-07-30). The
 * marker is a constant so the thrower and the classifier cannot drift apart.
 */
export const NO_STORED_SIGN_IN = "no_stored_sign_in";

const EXPIRED = [
  "invalid_grant", // both Google and Microsoft use this for revoked/expired
  "aadsts50173", // fresh sign-in required after a password change
  "aadsts700082", // refresh token expired (inactivity)
  "token_expired",
  "token_revoked",
  // Google's REST errors. A 401 on an API call means the access token minted
  // from the stored refresh token is not accepted; a missing scope means the
  // consent does not cover this service. Both are repaired by signing in
  // again — for Google that is the one union consent (finding 2026-07-30).
  "unauthenticated",
  "invalid credentials",
  "insufficientpermissions",
  "insufficient permission",
  NO_STORED_SIGN_IN,
  // Microsoft's answer to a refresh whose body carries no refresh_token. It
  // describes OUR request, but by the time a person sees it the cause is always
  // the same: the stored sign-in is gone, and connecting again is the fix.
  "aadsts900144",
  // The broker's own words for an account slot without a token.
  "account is not connected",
];

const CONFIG = [
  "invalid_client",
  "unauthorized_client",
  "redirect_uri_mismatch",
  "redirect_uri",
  "aadsts7000218", // public client flows disabled
  "aadsts700016", // application not found in this tenant
  "aadsts90023",
  "unsupported_grant_type",
  // Google: the API itself is not enabled in the user's own Cloud project.
  // A sign-in button cannot help here — this is a trip to the console, which
  // is exactly the distinction this classifier exists for.
  "accessnotconfigured",
  "service_disabled",
  "invalid_scope",
];

const NETWORK = ["failed to fetch", "networkerror", "timed out", "timeout", "enotfound", "econnrefused", "econnreset", "offline"];

/**
 * Classifies a failure message. Order matters: an expired grant is the case we
 * must never mistake for something a retry fixes, so it is checked first.
 */
export function classifyAuthError(message: string | null | undefined): AuthErrorKind {
  if (!message) return "unknown";
  const text = message.toLowerCase();
  if (EXPIRED.some((needle) => text.includes(needle))) return "expired";
  if (CONFIG.some((needle) => text.includes(needle))) return "config";
  if (NETWORK.some((needle) => text.includes(needle))) return "network";
  return "unknown";
}

/**
 * The narrow config case where the registration is FINE and the API itself is
 * switched off in the user's own Google Cloud project. It shares the "console,
 * not the app" family with the other config failures, but the advice differs:
 * checking client id, secret and redirect URI would send someone looking at
 * three things that are all correct (finding 2026-07-30).
 */
export function isApiNotEnabled(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("accessnotconfigured") || text.includes("service_disabled") || text.includes("has not been used in project");
}

/** Whether re-authorising the account is what this failure calls for. */
export function needsReauthorisation(message: string | null | undefined): boolean {
  return classifyAuthError(message) === "expired";
}
