/**
 * Tells the app that the sync pulled files (S45).
 *
 * The editor already knows what to do when a note changes under it: realign a
 * clean buffer, ignore its own echo, and preserve a dirty draft as a .CONFLICT
 * before adopting the foreign version (EditorHost). It just was never told.
 *
 * `m-external-update` had exactly one source on the phone — the indexer, which
 * fires it when the file's hash differs from the `local_sha256` it has on
 * record. That can never be true for a pulled file: the worker writes the
 * remote content and advances `local_sha256` to the hash of what it just wrote
 * (SyncWorker `updateLocalHashGuarded`) BEFORE it reports the paths. By the
 * time the reindex runs, the hashes match and the event is not emitted.
 *
 * The consequence is the worst thing this app can do. Note open on the phone,
 * another device edits it, the worker writes the remote version — the editor
 * keeps its stale buffer, and its next save sees `local_sha256 === disk`, finds
 * no conflict, overwrites the pulled version and pushes it. The other device's
 * edits are gone everywhere, with no conflict copy, and no snapshot either (the
 * worker's own write already used up the snapshot interval).
 *
 * The desktop never had this hole: it dispatches per pulled path directly.
 * `.CONFLICT` files are excluded there and here — they are the preservation of
 * an editor's draft, not a change to the note being edited.
 */
export function notifyPulledFiles(
  paths: readonly string[],
  dispatch: (event: Event) => void = (e) => window.dispatchEvent(e),
): void {
  dispatch(new CustomEvent("m-vault-changed"));
  for (const path of paths) {
    if (path.includes(".CONFLICT")) continue;
    dispatch(new CustomEvent("m-external-update", { detail: { path } }));
  }
}
