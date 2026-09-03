import { Compartment, type EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getChunks, getOriginalDoc, unifiedMergeView } from "@codemirror/merge";

/**
 * The suggestion mode inside the editor (plan Vorschlagsmodus, V2).
 *
 * The person types in a COPY of the note while the file stays the base:
 * `unifiedMergeView` draws the base's deleted text above the changed lines
 * and marks what was inserted, Word-style, and the host never saves while the
 * mode is on. Sending turns the chunks between base and copy into proposal
 * records; discarding puts the base back. Both leave the file as it was.
 *
 * The change list is computed by the merge view's own diff (line chunks with
 * inline change ranges, decision F2); `suggestionChunks` reads it back in the
 * shape the shell needs to write records.
 */
export interface SuggestionChunk {
  /** Range in the BASE document that goes away (empty for a pure insertion). */
  fromA: number;
  toA: number;
  /** What replaces it, taken from the copy. Empty for a pure deletion. */
  replacement: string;
}

const suggestTheme = EditorView.baseTheme({
  // The merge view's own colours are blue/red flat fills; the mode speaks in
  // the app's two tones instead (the same the cards and the reader use).
  ".cm-deletedChunk": {
    backgroundColor: "var(--error-bg)",
    color: "var(--error-text)",
    textDecoration: "line-through",
    borderRadius: "var(--radius-xs)",
    padding: "0 var(--space-1)",
  },
  ".cm-deletedChunk .cm-deletedText": { backgroundColor: "transparent" },
  ".cm-changedLine": { backgroundColor: "transparent" },
  ".cm-insertedLine": { backgroundColor: "transparent" },
  ".cm-changedText": {
    backgroundColor: "var(--success-bg)",
    color: "var(--success-text)",
    borderBottom: "2px solid var(--success-border)",
    borderRadius: "var(--radius-xs)",
  },
  ".cm-changeGutter": { display: "none" },
});

export function createSuggestMode() {
  const comp = new Compartment();
  return {
    /** Off by default: the compartment holds nothing until the mode starts. */
    extension: comp.of([]) as Extension,
    start(view: EditorView, onChunks?: (count: number) => void): void {
      const original = view.state.doc.toString();
      view.dispatch({
        effects: comp.reconfigure([
          unifiedMergeView({ original, mergeControls: false, gutter: false, highlightChanges: true, syntaxHighlightDeletions: false, allowInlineDiffs: true }),
          suggestTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && onChunks) onChunks(getChunks(update.state)?.chunks.length ?? 0);
          }),
        ]),
      });
      onChunks?.(0);
    },
    /** Leaves the mode and puts the base back; the copy's edits are gone. */
    stop(view: EditorView): void {
      const original = originalDoc(view.state);
      const current = view.state.doc.toString();
      view.dispatch({
        changes: original !== null && original !== current ? { from: 0, to: current.length, insert: original } : undefined,
        effects: comp.reconfigure([]),
      });
    },
  };
}

function originalDoc(state: EditorState): string | null {
  try {
    return getOriginalDoc(state).toString();
  } catch {
    return null;
  }
}

/** The base text the mode started from, or null outside the mode. */
export function suggestionBase(state: EditorState): string | null {
  return originalDoc(state);
}

/** The changes between base and copy, as the shell writes them - base order, front to back. */
export function suggestionChunks(state: EditorState): SuggestionChunk[] {
  const original = originalDoc(state);
  if (original === null) return [];
  const result = getChunks(state);
  if (!result) return [];
  const current = state.doc.toString();
  return result.chunks.map((chunk) => ({
    fromA: chunk.fromA,
    toA: Math.min(chunk.toA, original.length),
    replacement: current.slice(chunk.fromB, Math.min(chunk.toB, current.length)),
  }));
}
