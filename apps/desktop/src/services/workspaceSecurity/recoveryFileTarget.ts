/**
 * Is this a place the recovery file may go?
 *
 * The one artifact that cannot be regenerated must not live inside the vault it unlocks
 * (finding 2026-08-25, B7): the vault is what gets encrypted, synced and — in the case this
 * file exists for — lost. Saving it there produces a key that is only readable while you do
 * not need it.
 *
 * Desktop-only by construction: the phone writes to the OS documents directory and never
 * offers the vault container as a target, so there is nothing to guard there.
 */

/** Case-insensitive, separator-agnostic, no trailing separator. */
function normalize(path: string): string {
  return path.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function isInsideVault(target: string, vaultPath: string): boolean {
  const vault = normalize(vaultPath);
  if (!vault) return false;
  const candidate = normalize(target);
  return candidate === vault || candidate.startsWith(`${vault}/`);
}
