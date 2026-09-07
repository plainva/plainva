/**
 * What a reader can do with a marked passage (design round 2026-09-04, C26;
 * third verb since the Build-91 feedback round, P5).
 *
 * The bar over a read-mode selection carried two verbs — comment, suggest —
 * and only in a workspace that accepts comments. A plain vault therefore had
 * no bar at all, and a reader who wanted to keep writing at the spot they were
 * looking at had to reach for the pencil and find the place again. The tester
 * asked for a double-tap; on a read-only text the double-tap is the system's
 * "select a word", the very gesture that opens this bar (decision E5). So the
 * word stays selected and "edit" is the third verb: it switches to writing
 * with the cursor at the selection.
 */
export type ReadSelectionVerb = "comment" | "suggest" | "edit";

export interface ReadSelectionAbilities {
  /** The note accepts comments (workspace with comment rights). */
  canComment: boolean;
  /** A comment sheet is wired. */
  hasComment: boolean;
  /** The suggestion mode is available for this note right now. */
  hasSuggest: boolean;
  /** The user may write this note (and a switch to editing is wired). */
  canEdit: boolean;
}

export function readSelectionVerbs(a: ReadSelectionAbilities): ReadSelectionVerb[] {
  const out: ReadSelectionVerb[] = [];
  if (a.canComment && a.hasComment) out.push("comment");
  if (a.canComment && a.hasSuggest) out.push("suggest");
  if (a.canEdit) out.push("edit");
  return out;
}
