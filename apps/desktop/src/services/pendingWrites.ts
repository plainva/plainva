/**
 * In-flight note writes, per vault (P1.7, widened for stage D).
 *
 * MODULE level on purpose: after a pane is closed and reopened, the NEW editor
 * instance must still wait for a write the previous instance started -
 * otherwise it reads (and later re-saves) the pre-write content. Entries remove
 * themselves once settled.
 *
 * The key carries the VAULT, not just the note path. Editor paths are
 * vault-relative, so with two vaults open at once (stage D) a plain
 * `Notes/A.md` collided across vaults: writes in the two vaults serialised
 * against each other, and an editor opening that file in one vault waited for a
 * write in the other. Nothing was lost by it, but it was the wrong question.
 *
 * `settlePendingWrites` is what makes closing a vault safe: the last window
 * looking away tears the runtime down, and a write started by an editor that
 * unmounted a moment earlier must be FINISHED, not merely started, before the
 * runtime counts as gone.
 */

const pending = new Map<string, Promise<void>>();

// NUL separates the two halves: both are file paths, and a space or slash can
// appear in either, so any printable separator would make "<vault> <file>"
// ambiguous.
const keyOf = (vaultPath: string, path: string) => vaultPath + "\u0000" + path;

/** The write currently in flight for this note, if any. */
export function pendingWriteFor(vaultPath: string, path: string): Promise<void> | undefined {
  return pending.get(keyOf(vaultPath, path));
}

/**
 * Registers `run` as the in-flight write for this note and awaits it. The entry
 * is dropped afterwards unless a NEWER write has already replaced it.
 */
export async function trackPendingWrite(
  vaultPath: string,
  path: string,
  run: Promise<void>,
): Promise<void> {
  const key = keyOf(vaultPath, path);
  pending.set(key, run);
  try {
    await run;
  } finally {
    if (pending.get(key) === run) pending.delete(key);
  }
}

/**
 * Waits for every write of ONE vault to settle - failures included, because a
 * failed write is finished too and its error was reported where it happened.
 */
export async function settlePendingWrites(vaultPath: string): Promise<void> {
  const prefix = vaultPath + "\u0000";
  const runs: Promise<void>[] = [];
  for (const [key, run] of pending) if (key.startsWith(prefix)) runs.push(run);
  if (runs.length === 0) return;
  await Promise.allSettled(runs);
}

/** Tests only. */
export function resetPendingWritesForTests(): void {
  pending.clear();
}
