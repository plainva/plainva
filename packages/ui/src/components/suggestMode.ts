import { Compartment, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { presentableDiff } from "@codemirror/merge";

/**
 * The suggestion mode inside the editor (plan Vorschlagsmodus, V2; word-level
 * since the maintainer's test of 2026-09-03).
 *
 * The person types in a COPY of the note while the file stays the base. The
 * mode draws every change Word-style, INSIDE the paragraph: the words that
 * went away struck through where they stood, the words that came marked -
 * so a changed clause reads as a changed clause, not as a paragraph that was
 * deleted and written again. The host never saves while the mode is on.
 * Sending turns the changes between base and copy into proposal records, one
 * per change; discarding puts the base back. Both leave the file as it was.
 *
 * The change list is `presentableDiff` from the merge package: a
 * character diff aligned to word boundaries, which is exactly the grain a
 * reader decides on. The merge package's own unified view worked in lines,
 * and a one-word edit became a whole paragraph in red and a whole paragraph
 * in green (finding 2026-09-03).
 */
export interface SuggestionChunk {
  /** Range in the BASE document that goes away (empty for a pure insertion). */
  fromA: number;
  toA: number;
  /** What replaces it, taken from the copy. Empty for a pure deletion. */
  replacement: string;
}

/** The base the mode started from; null outside the mode. */
const baseField = StateField.define<string | null>({
  create: () => null,
  update: (value) => value,
});

/** The struck words, drawn where they stood. */
class DeletedWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: DeletedWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("del");
    el.className = "cm-suggest-del";
    el.textContent = this.text;
    return el;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

const insertedMark = Decoration.mark({ class: "cm-suggest-ins" });

function buildDecorations(state: EditorState): DecorationSet {
  const base = state.field(baseField, false) ?? null;
  if (base === null) return Decoration.none;
  const current = state.doc.toString();
  const ranges = [];
  for (const change of presentableDiff(base, current)) {
    const gone = base.slice(change.fromA, change.toA);
    if (gone.length > 0) ranges.push(Decoration.widget({ widget: new DeletedWidget(gone), side: -1 }).range(change.fromB));
    if (change.toB > change.fromB) ranges.push(insertedMark.range(change.fromB, change.toB));
  }
  return Decoration.set(ranges, true);
}

const decorationField = StateField.define<DecorationSet>({
  create: buildDecorations,
  update: (deco, tr) => (tr.docChanged ? buildDecorations(tr.state) : deco),
  provide: (field) => EditorView.decorations.from(field),
});

const suggestTheme = EditorView.baseTheme({
  // The app's two tones - the same the cards and the reader use (K5).
  ".cm-suggest-del": {
    backgroundColor: "var(--error-bg)",
    color: "var(--error-text)",
    textDecoration: "line-through",
    textDecorationThickness: "1px",
    borderRadius: "var(--radius-xs)",
    padding: "0 var(--space-1)",
  },
  ".cm-suggest-ins": {
    backgroundColor: "var(--success-bg)",
    color: "var(--success-text)",
    borderBottom: "2px solid var(--success-border)",
    borderRadius: "var(--radius-xs)",
  },
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
          baseField.init(() => original),
          decorationField,
          suggestTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && onChunks) onChunks(suggestionChunks(update.state).length);
          }),
        ]),
      });
      onChunks?.(0);
    },
    /** Leaves the mode and puts the base back; the copy's edits are gone. */
    stop(view: EditorView): void {
      const original = suggestionBase(view.state);
      const current = view.state.doc.toString();
      view.dispatch({
        changes: original !== null && original !== current ? { from: 0, to: current.length, insert: original } : undefined,
        effects: comp.reconfigure([]),
      });
    },
  };
}

/** The base text the mode started from, or null outside the mode. */
export function suggestionBase(state: EditorState): string | null {
  return state.field(baseField, false) ?? null;
}

/**
 * The changes between base and copy, as the shell writes them - base order,
 * front to back, one per changed clause rather than one per paragraph.
 */
export function suggestionChunks(state: EditorState): SuggestionChunk[] {
  const original = suggestionBase(state);
  if (original === null) return [];
  const current = state.doc.toString();
  return presentableDiff(original, current).map((change) => ({
    fromA: change.fromA,
    toA: change.toA,
    replacement: current.slice(change.fromB, change.toB),
  }));
}
