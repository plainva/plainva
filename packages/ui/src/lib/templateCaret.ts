/**
 * Where the caret goes in a note that was just created from a template
 * (plan Vorlagen-Engine, P3 — `{{cursor}}`).
 *
 * Same shape as the search-jump store, for the same reason: the editor pane
 * that will show the note may not be MOUNTED yet when the note is written
 * (lazy Editor, first file open). The creating code parks the offset here and
 * pokes mounted editors with `plainva-template-caret`; whichever consumer sees
 * that path first takes it — one shot, so a second note never inherits a
 * stale caret.
 */
let pending: { path: string; offset: number } | null = null;

export function setPendingTemplateCaret(caret: { path: string; offset: number }): void {
  pending = caret;
}

/** Hands the parked caret to the caller iff it targets `path`; clears it. */
export function consumePendingTemplateCaret(path: string | null): { path: string; offset: number } | null {
  if (!path || !pending || pending.path !== path) return null;
  const caret = pending;
  pending = null;
  return caret;
}

/** Drops a parked caret — used when the creation it belonged to was abandoned. */
export function clearPendingTemplateCaret(): void {
  pending = null;
}
