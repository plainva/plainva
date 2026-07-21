/**
 * Stable per-connection fingerprint (settings-sync plan §3.5). Every combination
 * of sync provider + remote root gets an independent E2E manifest and an
 * independent locally-stored E2E state, so switching connections never silently
 * inherits the previous connection's encryption status. The fingerprint is a
 * short, deterministic, human-inspectable string — not a secret.
 */

/** Normalizes a remote root path/label for a stable fingerprint. */
function normalizeRoot(remoteRoot: string): string {
  return remoteRoot.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
}

/** Builds the connection fingerprint `<provider>:<normalized-root>`. */
export function connectionFingerprint(provider: string, remoteRoot: string): string {
  return `${provider.trim().toLowerCase()}:${normalizeRoot(remoteRoot)}`;
}
