/**
 * When a deletion is big enough to ask twice (maintainer decision E2,
 * 2026-07-09): more than 10 affected files, OR more than 20% of the vault.
 *
 * Lifted out of the desktop's deleteConfirm (S4) rather than copied, because
 * mobile HAD copied it — and the copy had drifted: it was missing the
 * "a single file never needs the second prompt" clause, so deleting one note
 * in a three-note vault asked twice. Two shells asking differently about the
 * same deletion is exactly the kind of divergence a shared rule prevents.
 */

/** E2 threshold: >10 affected files OR (>1 file AND >20% of the vault). */
export function isLargeDeletion(fileCount: number, vaultFileCount: number): boolean {
  if (fileCount > 10) return true;
  // A single file never needs the second prompt, even in a tiny vault.
  return fileCount > 1 && vaultFileCount > 0 && fileCount > vaultFileCount * 0.2;
}

/** Files (not folders) affected by deleting `roots`, incl. folder children. */
export function countAffectedFiles(
  files: ReadonlyArray<{ path: string; isDir?: boolean }>,
  roots: string[]
): number {
  const norm = roots.map((r) => r.replace(/\\/g, "/").replace(/\/+$/, ""));
  let n = 0;
  for (const f of files) {
    if (f.isDir) continue;
    const p = f.path.replace(/\\/g, "/");
    if (norm.some((r) => p === r || p.startsWith(r + "/"))) n++;
  }
  return n;
}
