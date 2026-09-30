import { MoveBlockedError } from "@plainva/ui";
import { dirtyStore } from "./dirtyStore";
import { requestSaveFlush } from "./saveFlush";

/**
 * Unsaved text of an open note under these paths lands before they move —
 * a later save would find its file gone and refuse to write it back there
 * (issue 110), which left the text only in the draft journal.
 *
 * A flush that FAILS stops the move (issue 113, V3): it used to be
 * swallowed, and the note moved without its latest text. Every flush is
 * awaited first, so nothing is still writing when the refusal is reported;
 * the first failure is thrown as a {@link MoveBlockedError} naming its note.
 *
 * `paths` are the items about to move; a folder covers every note inside it.
 */
export async function flushUnsavedBeforeMove(
  paths: readonly string[],
  vaultPath: string | undefined,
  deps: { dirty?: () => ReadonlySet<string>; flush?: (path: string, vaultPath?: string) => Promise<void> } = {},
): Promise<void> {
  const dirty = deps.dirty ?? dirtyStore.get;
  const flush = deps.flush ?? requestSaveFlush;
  const pending = [...dirty()].filter((p) => paths.some((s) => p === s || p.startsWith(`${s}/`)));
  const results = await Promise.allSettled(pending.map((p) =>
    flush(p, vaultPath).catch((reason: unknown) => { throw new MoveBlockedError(p, reason); })));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}
