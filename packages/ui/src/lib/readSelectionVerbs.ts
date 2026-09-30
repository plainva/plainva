/**
 * Actions for a marked passage. Clipboard actions remain available without
 * writing or commenting rights. Edit preserves the marked source range when
 * switching from reading to writing; a double-tap still selects a word.
 */
export type ReadSelectionVerb = "copy" | "selectAll" | "comment" | "suggest" | "edit" | "ai";

export interface ReadSelectionAbilities {
  /** The shell needs explicit clipboard verbs when no system callout appears. */
  canCopy?: boolean;
  /** The note accepts comments (workspace with comment rights). */
  canComment: boolean;
  /** A comment sheet is wired. */
  hasComment: boolean;
  /** The suggestion mode is available for this note right now. */
  hasSuggest: boolean;
  /** The user may write this note (and a switch to editing is wired). */
  canEdit: boolean;
  /** The AI is on: the passage can be taken to it (plan KI-Harness P1.5). */
  hasAi?: boolean;
}

export function readSelectionVerbs(a: ReadSelectionAbilities): ReadSelectionVerb[] {
  const out: ReadSelectionVerb[] = [];
  if (a.canCopy) out.push("copy", "selectAll");
  if (a.canComment && a.hasComment) out.push("comment");
  if (a.canComment && a.hasSuggest) out.push("suggest");
  if (a.canEdit) out.push("edit");
  if (a.hasAi) out.push("ai");
  return out;
}
