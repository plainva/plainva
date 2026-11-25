import { readAsTextParts, type BoundedRange } from "@plainva/core";
import { StateEffect, StateField, type ChangeDesc, type EditorState, type Extension, type Transaction } from "@codemirror/state";
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
 * between, the stretches move with the text. A scan after an edit hands the
 * stretches it replaces along (`readAsTextParts` with `previous`): the blocks
 * read as text stay text within a tenth under the note's budget, so that the
 * typing at the threshold turns no block back and forth.
 */

/** What of the note is read as text, and what of that is not read for its links at all (`readAsTextParts`). */
export interface ReadAsTextState {
  ranges: readonly BoundedRange[];
  unread: readonly BoundedRange[];
}

/** New stretches, from a scan of the whole note. */
const setReadAsText = StateEffect.define<ReadAsTextState>();

/** How long the typing pauses before the note is scanned again. */
export const SCAN_PAUSE_MS = 400;

const scan = (state: EditorState, previous?: readonly BoundedRange[]): ReadAsTextState => {
  const { ranges, unread } = readAsTextParts(state.doc.toString(), undefined, previous);
  return { ranges, unread };
};

const moved = (ranges: readonly BoundedRange[], changes: ChangeDesc): readonly BoundedRange[] =>
  ranges.map((range) => ({ ...range, from: changes.mapPos(range.from, 1), to: changes.mapPos(range.to, -1) })).filter((range) => range.to > range.from);

export const readAsTextField = StateField.define<ReadAsTextState>({
  create: (state) => scan(state),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setReadAsText)) return effect.value;
    if (!tr.docChanged || value.ranges.length === 0) return value;
    return { ranges: moved(value.ranges, tr.changes), unread: moved(value.unread, tr.changes) };
  },
});

/** Whether the scan of the note gave new stretches in `tr`: every drawing that asks `readAsTextTouches` decides anew. */
export function readAsTextChanged(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(setReadAsText));
}

/** Whether `[from, to)` meets a stretch read as text (false where the field is not installed). */
export function readAsTextTouches(state: EditorState, from: number, to: number): boolean {
  const ranges = state.field(readAsTextField, false)?.ranges;
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
  const ranges = state.field(readAsTextField, false)?.ranges;
  if (!ranges || ranges.length === 0) return set;
  return set.update({ filter: (from, to) => !readAsTextTouches(state, from, to) });
}

const sameRanges = (a: readonly BoundedRange[], b: readonly BoundedRange[]): boolean =>
  a.length === b.length && a.every((range, i) => range.from === b[i].from && range.to === b[i].to && !!range.table === !!b[i].table && !!range.block === !!b[i].block);

const rescan = (onChange?: (state: ReadAsTextState) => void) =>
  ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      constructor(private readonly view: EditorView) {
        onChange?.(view.state.field(readAsTextField));
      }
      update(update: ViewUpdate) {
        if (update.transactions.some(readAsTextChanged)) onChange?.(update.state.field(readAsTextField));
        if (!update.docChanged) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          const current = this.view.state.field(readAsTextField);
          // The stretches read as text so far, moved with the edits: within a tenth under the budget they stay.
          const next = scan(this.view.state, current.ranges);
          if (!sameRanges(next.ranges, current.ranges) || !sameRanges(next.unread, current.unread)) this.view.dispatch({ effects: setReadAsText.of(next) });
        }, SCAN_PAUSE_MS);
      }
      destroy() {
        if (this.timer) clearTimeout(this.timer);
      }
    },
  );

/**
 * The stretches read as text, kept for the note in the editor; `onChange`
 * hears them when the editor opens and at every new scan — the note's notice
 * (`ReadAsTextNotice`) reads the editor's decision, not one of its own.
 */
export function readAsText(onChange?: (state: ReadAsTextState) => void): Extension {
  return [readAsTextField, rescan(onChange)];
}
