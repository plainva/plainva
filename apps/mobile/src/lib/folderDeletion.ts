import type { VaultFileInfo } from "@plainva/core";

/**
 * How much a folder deletion actually removes (S4).
 *
 * The dialog used to name the folder and nothing else, which on a phone is the
 * one place a number matters: there is no trash to walk back through, and the
 * backup adapter can only preserve what this device has written at least once.
 * Counting first is what makes "34 files" — and the sentence about what cannot
 * be restored — possible before the tap rather than after it.
 */

/** Files (never directories, never Plainva's own folder) below a listing. */
export function countFolderFiles(entries: ReadonlyArray<VaultFileInfo>): number {
  let n = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    if (e.path.startsWith(".plainva/") || e.path === ".plainva") continue;
    n++;
  }
  return n;
}

/**
 * How many files the vault holds — the base for the 20% half of the threshold.
 *
 * Without an index (the plain-web build has no SQLite backing store) this
 * returns 0, which makes `isLargeDeletion` fall back to its ">10 files" half.
 * That is the honest answer: a share of an unknown total is not a number.
 */
export async function countVaultFiles(
  queryService: { db: { query<T>(sql: string): Promise<T[]> } } | null | undefined
): Promise<number> {
  if (!queryService) return 0;
  try {
    const rows = await queryService.db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM files`);
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
