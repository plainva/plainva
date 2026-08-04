/**
 * What a vault ZIP is called, which ones get deleted, and when the next one is
 * due (S36).
 *
 * These four decisions were desktop-only. The phone is about to make the same
 * ones, and they are exactly the kind that must not be made twice: a retention
 * rule that drifts between shells deletes DIFFERENT files on two devices
 * looking at the same folder, and the mistake only shows up when someone needs
 * the backup that is no longer there.
 *
 * The zipping itself stays per shell — the desktop has a native Rust zipper
 * and a user-chosen destination, the phone zips in memory and writes into its
 * own documents directory. That difference is real. The naming, the pruning
 * and the due-check are not.
 */

/** Auto-ZIP cadence is fixed at daily (maintainer decision E2). */
export const ZIP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_ZIP_KEEP = 7;

/**
 * Directory NAMES pruned from vault ZIPs at any depth. `.obsidian` stays in on
 * purpose (user configuration belongs in a disaster backup); `.plainva` is
 * rebuildable (index) or redundant (snapshots).
 */
export const ZIP_EXCLUDED_DIR_NAMES = [".plainva", ".git", ".trash", "node_modules"];

/** Windows-safe file/folder name component. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || "Vault";
}

/** `<Vault>_YYYY-MM-DD_HH-mm-ss.zip` — sorts lexicographically, oldest first. */
export function buildZipFileName(vaultName: string, when: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}` +
    `_${p(when.getHours())}-${p(when.getMinutes())}-${p(when.getSeconds())}`;
  return `${sanitizeFileName(vaultName)}_${stamp}.zip`;
}

/** Strict name pattern of OUR zips for a vault — protects foreign files in a
 *  user-chosen destination (rotation + the forget-vault cleanup share it). */
export function zipNamePattern(vaultName: string): RegExp {
  const esc = sanitizeFileName(vaultName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc}_\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}\\.zip$`);
}

/**
 * Returns the file names to delete so at most `keep` of OUR zips remain.
 * The strict pattern protects foreign files in a user-chosen destination.
 * The timestamp format sorts lexicographically, oldest first.
 */
export function selectZipsToDelete(fileNames: string[], vaultName: string, keep: number): string[] {
  const pattern = zipNamePattern(vaultName);
  const matching = fileNames.filter((n) => pattern.test(n)).sort();
  // Zero would mean "delete every backup we have" — a retention setting must
  // never be able to express that by accident.
  const effectiveKeep = Math.max(1, keep);
  if (matching.length <= effectiveKeep) return [];
  return matching.slice(0, matching.length - effectiveKeep);
}

/** Pure due-check for the daily auto ZIP. */
export function shouldRunZip(s: { enabled: boolean; lastRun: number; now: number; running: boolean }): boolean {
  return s.enabled && !s.running && s.now - s.lastRun > ZIP_INTERVAL_MS;
}
