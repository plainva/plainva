import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, RangeSet, EditorState, Extension, StateEffect } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { ListPrefixMeasurer } from "./listPrefixMeasurement";

/**
 * List indentation for live + source mode (#2).
 *
 * CodeMirror renders markdown as flat lines, so nested list items only step by
 * their literal leading spaces — nearly invisible in a proportional font, unlike
 * the read view which nests real `<ul>`/`<ol>`. This plugin adds a per-line
 * indent (derived from the real list nesting in the syntax tree, so code fences
 * and non-list text are untouched) plus a hanging indent so wrapped lines align
 * under the item text — mirroring the read view in both editor modes.
 *
 * The hanging indent is MEASURED, not assumed (feedback round 2026-09-01, T1).
 * It used to be a constant (`-1em`, "matches the bullet widget + source
 * space"), but the rendered prefix of a marker line is anything but constant:
 * a bullet, a checkbox or `10.`, in whatever font the user picked. The error
 * grew with every level until a wrapped line sat LEFT of the bullet at level
 * three. The plugin measures the actual rendered prefix in a separate box,
 * without the line's own padding or hanging indent,
 * while every line of an item is padded to the edge of the marker line's text.
 * The constant survives only as the fallback for the instant before the first
 * measurement.
 *
 * Leading whitespace is the one thing a measurement cannot tame: a tab's width
 * depends on where the row starts, and the hanging indent moves the row — the
 * two used to chase each other. In live mode the leading whitespace of a list line is
 * therefore not rendered at all (the depth padding already shows the level, as
 * the read view does; the source keeps every space and tab, and Tab/Shift-Tab
 * still change it). Source mode shows the raw text, so there a line indented
 * with tabs keeps the em fallback instead of a measurement that cannot settle.
 */

/** Nesting step per list level. */
export const INDENT_EM = 1.5;
/**
 * Where level one starts, in nesting steps: `0.5` puts the top-level bullet
 * about one step in from the body text (the read view pads its `<ul>` by
 * 1.5em) — decided together with the measured indent (T8a asked for smaller
 * indents; the old `(depth + 1)` formula pushed level one two full steps in).
 */
export const INDENT_BASE_STEPS = 0.5;
/** Deepest list level that still gets its own indent guide; deeper lines draw this many. */
export const MAX_LIST_GUIDES = 8;
/** Fallback hanging indent until the first measurement lands. */
const MARKER_INDENT_EM = 1;
/** Breathing room between the line box's left edge and a measured prefix. */
const PREFIX_GUTTER_PX = 4;
const MARKER_RE = /^\s*([-*+]|\d+[.)])\s/;
const TASK_BOX_RE = /^\[[ xX]\]\s?/;

/** Whether a line begins a list item (bullet or ordered marker). */
export function isListMarkerLine(text: string): boolean {
  return MARKER_RE.test(text);
}

/**
 * Length of the rendered prefix of a marker line in characters: leading
 * whitespace, the marker, the following space — and for a task item the
 * `[ ] ` box, because the checkbox widget replaces it. Null for non-marker lines.
 */
export function listMarkerPrefixLength(text: string): number | null {
  const m = MARKER_RE.exec(text);
  if (!m) return null;
  let len = m[0].length;
  const box = TASK_BOX_RE.exec(text.slice(len));
  if (box) len += box[0].length;
  return len;
}

/** Padding (in em) for a list line at `depth`. */
export function listIndentPaddingEm(depth: number): number {
  return (depth + INDENT_BASE_STEPS) * INDENT_EM;
}

/** Measured widths, in CSS px, for one list line. */
export interface MeasuredListPrefix {
  /** This line's own rendered prefix: marker (+ box) for a marker line, leading whitespace otherwise. */
  own: number;
  /** The item's marker-line prefix — the edge every line of the item aligns to. */
  item: number;
}

/**
 * Inline style for a list line, or null when it isn't inside a list (depth <= 0).
 *
 * With a measurement, the line pulls its first row back by exactly its own
 * prefix and pads to the item's text edge (at least the em step, so a wide
 * prefix — `10.`, a checkbox — can never push the first row out of the line
 * box). Without one, the em-based fallback applies: marker lines hang by a
 * constant, continuation lines only get the padding.
 */
export function listIndentStyle(depth: number, isMarker: boolean, measured: MeasuredListPrefix | null = null): string | null {
  if (depth <= 0) return null;
  const padEm = listIndentPaddingEm(depth);
  if (measured === null) {
    const pad = `padding-left:${padEm}em;`;
    return isMarker ? `${pad}text-indent:-${MARKER_INDENT_EM}em;` : pad;
  }
  const half = (n: number) => Math.round(n * 2) / 2;
  const own = half(measured.own);
  const item = half(measured.item);
  const pad = `padding-left:max(${padEm}em,${item + PREFIX_GUTTER_PX}px);`;
  return own > 0 ? `${pad}text-indent:-${own}px;` : pad;
}

/** Number of ancestor ListItem nodes at a document position (0 = not in a list). */
export function listDepthAt(state: EditorState, pos: number): number {
  return listItemAt(state, pos).depth;
}

/**
 * The innermost ListItem around `pos`: its nesting depth and its start offset
 * (the key under which the item's measured prefix is stored, shared by the
 * marker line and its continuation lines).
 */
export function listItemAt(state: EditorState, pos: number): { depth: number; itemFrom: number | null } {
  let depth = 0;
  let itemFrom: number | null = null;
  for (let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name === "ListItem") {
      if (itemFrom === null) itemFrom = node.from;
      depth++;
    }
  }
  return { depth, itemFrom };
}

/** Prefix widths were re-measured; rebuild the line decorations. */
const prefixMeasured = StateEffect.define<null>();
const HIDDEN_WS = Decoration.replace({});

export interface ListIndentOptions {
  /**
   * Live mode: do not render the leading whitespace of list lines (see the
   * module comment). Source mode leaves it visible.
   */
  hideLeadingWhitespace?: boolean;
}

interface LineToMeasure {
  lineFrom: number;
  /** 1-based line number - the key widths are stored under (see Widths). */
  lineNumber: number;
  /** Where this line's visible text begins (after marker/box, or after leading whitespace). */
  textStart: number;
  /** Set for marker lines: the line number of the item whose text edge this prefix defines. */
  itemLine: number | null;
}

/**
 * Measured widths, keyed by LINE NUMBER rather than document offset: typing
 * inside a line shifts every later offset but no line number, so a keystroke
 * that changes no width dispatches nothing. Only a new or removed line shifts
 * the keys - one re-measure, one repaint, then quiet again.
 */
interface Widths {
  /** Own prefix per line. */
  lines: Map<number, number>;
  /** Marker-line prefix per ListItem, keyed by the item's first line. */
  items: Map<number, number>;
}

function sameWidths(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w === undefined || Math.abs(w - v) >= 0.5) return false;
  }
  return true;
}

function buildDecorations(
  view: EditorView,
  widths: Widths,
  toMeasure: LineToMeasure[],
  hideWs: boolean
): { lines: DecorationSet; hidden: DecorationSet } {
  const lines = new RangeSetBuilder<Decoration>();
  const hidden = new RangeSetBuilder<Decoration>();
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const text = line.text;
      if (text.trim().length > 0) {
        // Resolve at the first non-whitespace char so we land inside the ListItem.
        const wsLen = text.length - text.trimStart().length;
        const firstNonWs = line.from + wsLen;
        const { depth, itemFrom } = listItemAt(state, firstNonWs);
        if (depth > 0) {
          const prefixLen = listMarkerPrefixLength(text);
          const isMarker = prefixLen !== null;
          const itemLine = itemFrom !== null ? state.doc.lineAt(itemFrom).number : null;
          const own = widths.lines.get(line.number);
          const item = itemLine !== null ? widths.items.get(itemLine) : undefined;
          const measured = own !== undefined && item !== undefined ? { own, item } : null;
          const style = listIndentStyle(depth, isMarker, measured);
          // Indent guides (finding 2026-09-19): one hairline per PARENT level,
          // drawn by the theme as a background of the line (MarkdownTheme.ts).
          // Live mode only - the positions belong to the layout in which the
          // leading whitespace is not rendered.
          const guides = hideWs && depth > 1 ? `cm-list-guides-${Math.min(depth - 1, MAX_LIST_GUIDES)}` : undefined;
          if (style) lines.add(line.from, line.from, Decoration.line(guides ? { attributes: { style }, class: guides } : { attributes: { style } }));
          if (hideWs && wsLen > 0) hidden.add(line.from, firstNonWs, HIDDEN_WS);
          // A tab's width depends on where the row starts, and the hanging
          // indent moves the row: measuring such a line can never settle. With
          // the whitespace hidden the tab is not rendered; visible, the line
          // keeps the em fallback.
          const tabInWs = !hideWs && text.slice(0, wsLen).includes("\t");
          if (!tabInWs) {
            toMeasure.push({
              lineFrom: line.from,
              lineNumber: line.number,
              textStart: line.from + (prefixLen ?? wsLen),
              itemLine: isMarker ? itemLine : null,
            });
          }
        }
      }
      pos = line.to + 1;
    }
  }
  return { lines: lines.finish(), hidden: hidden.finish() };
}

/** Line-indent decorations for markdown lists; safe in both live and source mode. */
export function listIndentPlugin(options: ListIndentOptions = {}): Extension {
  const hideWs = options.hideLeadingWhitespace === true;
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      hidden: DecorationSet;
      private widths: Widths = { lines: new Map(), items: new Map() };
      private toMeasure: LineToMeasure[] = [];
      private readonly prefixes: ListPrefixMeasurer;
      private readonly fonts: FontFaceSet | undefined;
      private destroyed = false;
      private readonly fontLoaded: () => void;
      private readonly measure = {
        read: (): Widths => {
          const next: Widths = { lines: new Map(), items: new Map() };
          for (const { lineFrom, lineNumber, textStart, itemLine } of this.toMeasure) {
            const w = this.prefixes.width(lineFrom, textStart);
            if (w === null) continue;
            next.lines.set(lineNumber, w);
            if (itemLine !== null) next.items.set(itemLine, w);
          }
          return next;
        },
        write: (next: Widths, view: EditorView) => {
          if (sameWidths(next.lines, this.widths.lines) && sameWidths(next.items, this.widths.items)) return;
          this.widths = next;
          // A decoration change needs an update; an empty transaction carrying
          // the effect is that update. Deferred so it never nests in the write phase.
          queueMicrotask(() => {
            if (this.destroyed) return;
            try {
              view.dispatch({ effects: prefixMeasured.of(null) });
            } catch {
              /* view gone */
            }
          });
        },
      };
      constructor(view: EditorView) {
        this.prefixes = new ListPrefixMeasurer(view, hideWs ? "live" : "source");
        this.fonts = view.dom.ownerDocument.fonts;
        this.fontLoaded = () => { this.prefixes.invalidate(); view.requestMeasure(this.measure); };
        this.fonts?.addEventListener("loadingdone", this.fontLoaded);
        const built = buildDecorations(view, this.widths, (this.toMeasure = []), hideWs);
        this.decorations = built.lines;
        this.hidden = built.hidden;
        view.requestMeasure(this.measure);
      }
      update(u: ViewUpdate) {
        // The tree-progress check mirrors markdownDecorationPlugin: lezer parses
        // asynchronously, so right after load/paste/external reload the depth can
        // be computed from a stale tree — without rebuilding on parse progress the
        // indent then visibly "jumps" on the next unrelated update (Jitter, P5).
        const remeasured = u.transactions.some((tr) => tr.effects.some((e) => e.is(prefixMeasured)));
        const treeMoved = syntaxTree(u.startState) !== syntaxTree(u.state);
        if (u.docChanged || u.viewportChanged || remeasured || treeMoved) {
          const built = buildDecorations(u.view, this.widths, (this.toMeasure = []), hideWs);
          this.decorations = built.lines;
          this.hidden = built.hidden;
        }
        // Our own decoration transaction never requests another measurement.
        // External geometry/font changes invalidate metrics; the unindented
        // probe and dead band make their result independent of our padding.
        if (!remeasured && (u.docChanged || u.viewportChanged || u.geometryChanged || treeMoved)) {
          if (u.geometryChanged) this.prefixes.invalidate();
          u.view.requestMeasure(this.measure);
        }
      }
      destroy() {
        this.destroyed = true;
        this.fonts?.removeEventListener("loadingdone", this.fontLoaded);
        this.prefixes.destroy();
      }
    },
    {
      decorations: (v) => RangeSet.join([v.decorations, v.hidden]),
      // The hidden whitespace is one atom: the cursor lands before or after
      // it, never invisibly inside.
      provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.hidden ?? Decoration.none),
    }
  );
  return [plugin, EditorView.baseTheme({
    ".cm-list-prefix-measure": { position: "absolute", top: "0", left: "0", height: "0", minHeight: "0", width: "max-content", maxWidth: "none", visibility: "hidden", pointerEvents: "none", padding: "0", overflow: "visible" },
    ".cm-list-prefix-measure > .cm-line": { width: "max-content", minHeight: "0", margin: "0", padding: "0", border: "0", textIndent: "0", whiteSpace: "pre" },
  })];
}
