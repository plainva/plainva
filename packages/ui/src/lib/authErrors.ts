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

const EXPIRED = [
  "invalid_grant", // both Google and Microsoft use this for revoked/expired
  "aadsts50173", // fresh sign-in required after a password change
  "aadsts700082", // refresh token expired (inactivity)
  "token_expired",
  "token_revoked",
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

/** Whether re-authorising the account is what this failure calls for. */
export function needsReauthorisation(message: string | null | undefined): boolean {
  return classifyAuthError(message) === "expired";
}
