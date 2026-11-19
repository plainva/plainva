import { overBudgetInlineRanges, type BoundedRange } from "@plainva/core";
import { StateEffect, StateField, type EditorState, type Extension, type Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/**
 * The stretches of the note the parse budget reads as text (`inlineParseBudget.ts`
 * in core: a paragraph or table over its own budget, the heaviest blocks of a
 * note over the note's budget), for the editor (L14, Gesamtplan Leistung § 3a.2).
 * There the live preview draws no widget and no formatting but the source, as
 * the reading view shows it: one decision for every reader of the note.
 *
 * The scan reads the whole note. It runs when the note opens, and after an
 * edit once the typing pauses (`SCAN_PAUSE_MS`), not at every keystroke; in
 * between, the stretches move with the text.
 */

/** New stretches, from a scan of the whole note. */
const setReadAsText = StateEffect.define<readonly BoundedRange[]>();

/** How long the typing pauses before the note is scanned again. */
export const SCAN_PAUSE_MS = 400;

const scan = (state: EditorState): readonly BoundedRange[] => overBudgetInlineRanges(state.doc.toString());

export const readAsTextField = StateField.define<readonly BoundedRange[]>({
  create: scan,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setReadAsText)) return effect.value;
    if (!tr.docChanged || value.length === 0) return value;
    return value.map((range) => ({ ...range, from: tr.changes.mapPos(range.from, 1), to: tr.changes.mapPos(range.to, -1) })).filter((range) => range.to > range.from);
  },
});

/** Whether the scan of the note gave new stretches in `tr`: every drawing that asks `readAsTextTouches` decides anew. */
export function readAsTextChanged(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(setReadAsText));
}

/** Whether `[from, to)` meets a stretch read as text (false where the field is not installed). */
export function readAsTextTouches(state: EditorState, from: number, to: number): boolean {
  const ranges = state.field(readAsTextField, false);
  if (!ranges || ranges.length === 0) return false;
  let lo = 0;
  let hi = ranges.length;
  // The first stretch that ends after `from`.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid].to <= from) lo = mid + 1;
    else hi = mid;
  }
  return lo < ranges.length && ranges[lo].from < Math.max(to, from + 1);
}

/** `set` without the decorations that meet a stretch read as text. */
export function withoutReadAsText(state: EditorState, set: DecorationSet): DecorationSet {
  const ranges = state.field(readAsTextField, false);
  if (!ranges || ranges.length === 0) return set;
  return set.update({ filter: (from, to) => !readAsTextTouches(state, from, to) });
}

const rescan = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    constructor(private readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        const next = scan(this.view.state);
        const current = this.view.state.field(readAsTextField);
        const same = next.length === current.length && next.every((range, i) => range.from === current[i].from && range.to === current[i].to && !!range.table === !!current[i].table && !!range.block === !!current[i].block);
        if (!same) this.view.dispatch({ effects: setReadAsText.of(next) });
      }, SCAN_PAUSE_MS);
    }
    destroy() {
      if (this.timer) clearTimeout(this.timer);
    }
  },
);

/** The stretches read as text, kept for the note in the editor. */
export function readAsText(): Extension {
  return [readAsTextField, rescan];
}
