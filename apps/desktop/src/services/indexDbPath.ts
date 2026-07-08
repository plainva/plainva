/**
 * Per-vault filename for the SQLite index DB in the OS app-data dir (WP5 5b).
 *
 * The index used to live in `<vault>/.plainva/vault.db`; on a network-drive
 * vault every save paid a round-trip per index statement (and the sqlx pool
 * forbids batching them into one transaction). Moving the DB to app-data makes
 * those local. Pure and unit-testable; the app-data path resolution + the
 * one-time migration of an existing in-vault DB live in VaultContext.
 */

/** SHA-256 of the slash/case-normalized vault path, first 16 hex chars. */
export async function hashVaultPath(vaultPath: string): Promise<string> {
  const norm = vaultPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * `<sanitized-basename>-<hash16>.db` — deterministic and normalized, so the same
 * vault always maps to the same file and same-named vaults in different folders
 * never collide (the hash disambiguates; the basename aids debugging).
 */
export async function indexDbFileName(vaultPath: string): Promise<string> {
  const hash = await hashVaultPath(vaultPath);
  const base =
    (vaultPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "vault").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
  return `${base}-${hash}.db`;
}
