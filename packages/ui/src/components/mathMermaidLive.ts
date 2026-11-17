import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { EditorState, Extension, RangeSetBuilder, Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { interactivityChanged, revealsRange } from "./LivePreviewPlugin";
import { isEditorInteractive } from "./editorInteractive";
import { fenceOpenerFor, fencedCodeRanges, fencedCodeRangesIn, findFencedBlocks, findFencedBlocksIn, type FencedBlock } from "./fencedBlocks";
import { blockDecorationsFromScratch, incrementalBlockField, nodeScopedDiscovery, selectionTouches, type BlockEntry, type BlockFieldConfig, type BlockKind, type BlockRescan, type KindState, type SyntaxNode } from "./incrementalBlocks";
import { renderMermaidDiagram, currentMermaidTheme } from "../services/mermaidRender";
import { anchorFrameAt, anchorFrameSignature, decorateAnchorTarget, hasAnchorHighlightChange, type AnchorFrame } from "./anchorHighlight";
import i18n from "../i18n";

/**
 * Live-preview rendering for LaTeX math and ```mermaid fences (Nachfass
 * 2026-07-06: P3.4 demanded "Read + Live" for KaTeX; the maintainer lifted
 * the E-D mermaid-live waiver on 2026-07-06).
 *
 * Same interaction contract as every live widget: the caret inside the
 * expression/fence shows raw markdown, everywhere else the rendered form.
 * Clicking a rendered block places the caret inside it, flipping it back to
 * editable source.
 *
 * Two extension shapes for one CodeMirror rule: INLINE math is a ViewPlugin
 * over the visible ranges (like image previews); multi-line $$ blocks and
 * mermaid fences REPLACE line breaks and therefore must come from a
 * StateField (same reason tableField is one).
 */

// ---------------------------------------------------------------------------
// KaTeX loading + render cache
// ---------------------------------------------------------------------------

type KatexModule = typeof import("katex").default;
let katexModule: KatexModule | null = null;
let katexLoading: Promise<KatexModule | null> | null = null;

function ensureKatex(): Promise<KatexModule | null> {
  if (katexModule) return Promise.resolve(katexModule);
  if (!katexLoading) {
    katexLoading = Promise.all([import("katex"), import("katex/dist/katex.min.css")])
      .then(([m]) => {
        katexModule = m.default;
        return katexModule;
      })
      .catch((e) => {
        console.warn("[mathLive] loading KaTeX failed", e);
        katexLoading = null; // allow retry
        return null;
      });
  }
  return katexLoading;
}

const htmlCache = new Map<string, string>();

function katexHtml(expr: string, displayMode: boolean): string | null {
  if (!katexModule) return null;
  const key = `${displayMode ? "D" : "i"} ${expr}`;
  let html = htmlCache.get(key);
  if (html === undefined) {
    // throwOnError:false renders invalid TeX in KaTeX's own error color
    // instead of throwing — the raw source stays one caret-click away.
    html = katexModule.renderToString(expr, { throwOnError: false, displayMode });
    if (htmlCache.size > 500) htmlCache.clear();
    htmlCache.set(key, html);
  }
  return html;
}

// Clicking a rendered widget must flip it back to source. CodeMirror maps a
// click on a (block) replace widget to its EDGE, which can land on the line
// after the range and leave the widget rendered — so the widgets place the
// caret themselves: posAtDOM resolves the widget's CURRENT start position
// (safe across eq()-reused DOM), which is inside the replaced range and
// triggers the caret guard.
function caretIntoWidget(view: EditorView, el: HTMLElement, event: MouseEvent) {
  // Read mode keeps the rendered form (GitHub issue 118): the press is the
  // system's, to select text, not a way into the source.
  if (!isEditorInteractive(view.state)) return;
  event.preventDefault();
  const pos = view.posAtDOM(el);
  view.dispatch({ selection: { anchor: pos } });
  view.focus();
}

// KaTeX (web fonts) and mermaid (SVG layout) settle their rendered SIZE a frame
// or more AFTER toDOM runs — a single requestMeasure right after render reads
// the too-small "loading" height. CodeMirror then keeps a too-short height for
// that block, and because the error is PER widget it ACCUMULATES: with several
// math/mermaid blocks stacked, mouse clicks and arrow-key motion land
// progressively further below the target the further down the document you go.
// A ResizeObserver keeps CM's height map in lockstep with the ACTUAL rendered
// size — re-measuring whenever (and however late) the content grows or shrinks.
// Guarded for jsdom, which has no ResizeObserver (unit tests mock rendering).
type HeightObserverHost = HTMLElement & { __pvHeightObs?: ResizeObserver };

function keepHeightInSync(view: EditorView, el: HTMLElement) {
  if (typeof ResizeObserver === "undefined") return;
  const ro = new ResizeObserver(() => view.requestMeasure());
  ro.observe(el);
  (el as HeightObserverHost).__pvHeightObs = ro;
}

function stopHeightSync(dom: HTMLElement) {
  const host = dom as HeightObserverHost;
  host.__pvHeightObs?.disconnect();
  host.__pvHeightObs = undefined;
}

class MathWidget extends WidgetType {
  constructor(readonly expr: string, readonly display: boolean) { super(); }

  eq(other: MathWidget) {
    return this.expr === other.expr && this.display === other.display;
  }

  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "pv-math-widget";
    // flow-root (not plain block): KaTeX display math is a `.katex-display` with
    // `margin: 1em 0`. Under plain block those margins COLLAPSE OUT of el, so
    // el.offsetHeight — the height CodeMirror measures for the block — omits
    // ~2em per formula. The error is per-widget, so the caret offset piles up
    // downward the more math you stack. A flow-root box contains child margins
    // inside its border-box, so the measured height matches the real one.
    if (this.display) el.style.display = "flow-root";
    el.style.cursor = "text";
    el.addEventListener("mousedown", (e) => caretIntoWidget(view, el, e));
    keepHeightInSync(view, el);
    const render = () => {
      const html = katexHtml(this.expr, this.display);
      if (html !== null) el.innerHTML = html; // KaTeX output, not note content
      return html !== null;
    };
    if (!render()) {
      // Not loaded yet: show the raw source dimmed, swap in place after load.
      el.textContent = this.display ? `$$${this.expr}$$` : `$${this.expr}$`;
      el.style.opacity = "0.6";
      void ensureKatex().then(() => {
        if (el.isConnected && render()) {
          el.style.opacity = "";
          // Immediate nudge after the swap; keepHeightInSync's observer catches
          // any further reflow (KaTeX web-font metrics settle a frame later).
          view.requestMeasure();
        }
      });
    }
    return el;
  }

  ignoreEvent() { return true; } // our mousedown handler owns the interaction
  destroy(dom: HTMLElement) { stopHeightSync(dom); }
}

// ---------------------------------------------------------------------------
// Inline math (single-line $…$ / $$…$$) — ViewPlugin over visible ranges
// ---------------------------------------------------------------------------

// Same boundary rules as the reader's gate (MarkdownReader hasMath): no
// leading/trailing space inside, no $ digit confusion, escapes respected.
const INLINE_MATH_RE = /\$\$([^\n$]+?)\$\$|(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g;

/** Ranges the math scan must never touch: code, HTML, existing math in code. */
function codeRanges(state: EditorState, from: number, to: number): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "InlineCode" || node.name === "HTMLBlock" || node.name === "CommentBlock") {
        ranges.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  // Lezer may expose a deliberately incomplete syntax tree during the first
  // time-sliced parse of a busy editor. Inline code is cheap to recognise
  // directly per visible line, and doing so prevents a transient `$code$`
  // math widget that otherwise remains until another editor transaction.
  const firstLine = state.doc.lineAt(from).number;
  const lastLine = state.doc.lineAt(to).number;
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
    const line = state.doc.line(lineNumber);
    const runs = [...line.text.matchAll(/`+/g)];
    let opener: RegExpMatchArray | null = null;
    for (const run of runs) {
      const index = run.index ?? 0;
      let slashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line.text[cursor] === "\\"; cursor--) slashes++;
      if (slashes % 2 === 1) continue;
      if (!opener) {
        opener = run;
      } else if (opener[0].length === run[0].length) {
        ranges.push({
          from: line.from + (opener.index ?? 0),
          to: line.from + index + run[0].length,
        });
        opener = null;
      }
    }
  }
  return ranges;
}

const overlaps = (aFrom: number, aTo: number, ranges: Array<{ from: number; to: number }>) =>
  ranges.some((r) => aFrom < r.to && aTo > r.from);

export function mathInlinePlugin() {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      // The tree-progress check mirrors listIndent and the block field below:
      // lezer parses asynchronously and time-budgeted, so right after load the
      // decorations can be built from a tree that has not reached the formula
      // yet. Without rebuilding on parse progress the inline math then stays
      // raw until something ELSE happens (a keystroke, a scroll) — the block
      // field had this check, the inline plugin did not (S8, 2026-08-12).
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        interactivityChanged(update.startState, update.state)
      ) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>();

      for (const { from, to } of view.visibleRanges) {
        const excluded = codeRanges(view.state, from, to);
        const text = view.state.sliceDoc(from, to);
        INLINE_MATH_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = INLINE_MATH_RE.exec(text)) !== null) {
          const display = match[1] !== undefined;
          const expr = (display ? match[1] : match[2]).trim();
          if (!expr) continue;
          const matchStart = from + match.index;
          const matchEnd = matchStart + match[0].length;
          if (overlaps(matchStart, matchEnd, excluded)) continue;

          // Caret/selection touching the expression keeps it raw source - while editing.
          if (revealsRange(view.state, matchStart, matchEnd)) continue;

          builder.add(matchStart, matchEnd, Decoration.replace({ widget: new MathWidget(expr, display) }));
        }
      }
      return builder.finish();
    }
  }, { decorations: (v) => v.decorations });
}

// ---------------------------------------------------------------------------
// Block widgets: multi-line $$ math + ```mermaid fences — StateField
// ---------------------------------------------------------------------------

class MermaidLiveWidget extends WidgetType {
  // The theme joins the identity so a rebuild after a theme switch re-renders.
  constructor(
    readonly code: string,
    readonly theme: string,
    readonly texts: MathMermaidTexts,
    /** The fence's range in the document - what a comment on the diagram anchors to. */
    readonly from: number,
    readonly to: number,
    readonly frame: AnchorFrame | null,
    /**
     * The line class of the quote or callout the fence stands in, "" at the top
     * level: the diagram replaces those lines, so it carries their card.
     */
    readonly quoteClass: string,
  ) { super(); }

  eq(other: MermaidLiveWidget) {
    // The frame joins the identity too: without it CodeMirror keeps the DOM it
    // already built and the frame would never appear.
    return this.code === other.code && this.theme === other.theme && this.quoteClass === other.quoteClass
      && anchorFrameSignature(other.frame) === anchorFrameSignature(this.frame);
  }

  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = this.quoteClass ? `pv-mermaid-live ${this.quoteClass}` : "pv-mermaid-live";
    // Padding, NOT margin: an element's OWN margin is excluded from the height
    // CodeMirror measures (offsetHeight), which left a small residual caret
    // offset per diagram. Padding sits inside the border-box and is measured.
    // Top and bottom only: the sides belong to the quote or callout card.
    el.style.paddingTop = "0.4em";
    el.style.paddingBottom = "0.4em";
    el.style.overflowX = "auto";
    el.style.cursor = "text"; // clicking flips to source (caret enters the fence)
    el.addEventListener("mousedown", (e) => caretIntoWidget(view, el, e));
    keepHeightInSync(view, el);
    // Outline, not border: an outline sits outside layout entirely, so the frame
    // cannot disturb the height measured just above.
    decorateAnchorTarget({
      view,
      host: el,
      target: el,
      range: { from: this.from, to: this.to },
      display: { kind: "diagram" },
      frame: this.frame,
      bubbleLabel: i18n.t("comments.commentOnDiagram"),
    });
    el.textContent = this.texts.loading;
    el.style.color = "var(--text-faint)";
    void renderMermaidDiagram(this.code).then((result) => {
      if (!el.isConnected) return;
      el.style.color = "";
      if ("svg" in result) {
        // SVG comes from mermaid's strict-mode renderer, not from the note.
        el.innerHTML = result.svg;
      } else {
        el.textContent = "";
        const box = document.createElement("div");
        box.style.cssText = "border:1px solid var(--warning-border);background:var(--warning-bg);color:var(--warning-text);border-radius:var(--radius-sm);padding:0.5em 0.8em;font-size:0.85em;";
        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.textContent = this.texts.error;
        const pre = document.createElement("pre");
        // pre nests inside box, whose own font-size is already 0.85em — dividing
        // by 0.85 cancels that scale so the traceback still renders at 0.8em of
        // the WIDGET's base size (matching the two formerly-independent 0.85rem/
        // 0.8rem literals) instead of compounding to 0.8 × 0.85 of it.
        pre.style.cssText = "margin:0.3em 0 0;white-space:pre-wrap;font-size:calc(0.8em / 0.85);";
        pre.textContent = result.error;
        box.append(title, pre);
        el.appendChild(box);
      }
      // Immediate nudge after swapping in the diagram; keepHeightInSync's
      // observer catches any later SVG layout/scaling so the height stays exact.
      view.requestMeasure();
    });
    return el;
  }

  ignoreEvent() { return true; } // our mousedown handler owns the interaction
  destroy(dom: HTMLElement) { stopHeightSync(dom); }
}

export interface MathMermaidTexts {
  loading: string;
  error: string;
}

/** The opening line of a mermaid fence, without what stands in front of the run. */
const MERMAID_OPEN = fenceOpenerFor("mermaid");

interface MermaidInfo {
  readonly code: string;
  readonly quoteClass: string;
}

interface BlockContext {
  /** The caret shows a block's source (editing, not the touch read mode). */
  readonly reveal: boolean;
  readonly theme: string;
}

const mermaidEntry = (block: FencedBlock): BlockEntry<MermaidInfo> => ({ from: block.from, to: block.to, info: { code: block.code, quoteClass: block.quoteClass } });

// ```mermaid fences - at the top level, in a list item, and in a quote or
// callout (the shared detection of fencedBlocks.ts, which the ```tasks
// query block reads too).
function mermaidKind(texts: MathMermaidTexts): BlockKind<MermaidInfo, BlockContext> {
  return {
    ...nodeScopedDiscovery<MermaidInfo>(
      (state) => findFencedBlocks(state, MERMAID_OPEN).map(mermaidEntry),
      (state, top, out) => {
        const found: FencedBlock[] = [];
        findFencedBlocksIn(state, MERMAID_OPEN, top, found);
        for (const block of found) out.push(mermaidEntry(block));
      },
    ),
    decorate(state, ctx, block) {
      if (ctx.reveal && selectionTouches(state.selection, block.from, block.to)) return null;
      if (!block.info.code.trim()) return null;
      return Decoration.replace({
        widget: new MermaidLiveWidget(block.info.code, ctx.theme, texts, block.from, block.to, anchorFrameAt(state, block.from, block.to), block.info.quoteClass),
        block: true,
      });
    },
  };
}

interface MathInfo {
  /** The expression between the `$$`; empty draws nothing. */
  readonly expr: string;
}

interface MathExtra {
  /** Start of an opening line that never closes: the search stopped there. */
  readonly stoppedAt: number | null;
}

const isMathOpener = (text: string) => {
  const t = text.trim();
  return t.startsWith("$$") && !(t.length > 2 && t.endsWith("$$"));
};

/** The first line from line number `from` on that ends in `$$`, or -1. */
function mathClosing(doc: Text, from: number): number {
  for (let m = from; m <= doc.lines; m++) {
    if (doc.line(m).text.trim().endsWith("$$")) return m;
  }
  return -1;
}

function mathEntry(doc: Text, open: number, closing: number): BlockEntry<MathInfo> {
  const from = doc.line(open).from;
  const to = doc.line(closing).to;
  const raw = doc.sliceString(from, to);
  return { from, to, info: { expr: raw.replace(/^\s*\$\$/, "").replace(/\$\$\s*$/, "").trim() } };
}

/**
 * Multi-line $$ blocks: an opening line that starts with $$ (and does not
 * close on the same line) up to the next line ending in $$. An opening line
 * inside fenced code is none; an opening line without a closing one ends the
 * search. Every pair counts, also one with nothing between the `$$`: the next
 * search starts after it.
 */
function discoverAllMath(state: EditorState): KindState<MathInfo, MathExtra> {
  const doc = state.doc;
  const fences = fencedCodeRanges(state);
  const blocks: BlockEntry<MathInfo>[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!isMathOpener(line.text)) continue;
    if (overlaps(line.from, line.to, fences)) continue;
    const closing = mathClosing(doc, n + 1);
    if (closing === -1) return { blocks, extra: { stoppedAt: line.from } };
    blocks.push(mathEntry(doc, n, closing));
    n = closing;
  }
  return { blocks, extra: { stoppedAt: null } };
}

/**
 * The same search, continued from the last pair the edit left alone and ended
 * where it meets the old search again. Unlike the other blocks a `$$` pair is
 * not one node of the tree - it pairs lines along the whole note - so it is
 * followed line by line: the old pairs before the rescanned stretch stand
 * (their lines and the fences around them did not change), the search runs
 * through the stretch, and behind it, at the first line where neither the old
 * nor the new search is inside a pair, both go on alike.
 */
function discoverMath(state: EditorState, prev: KindState<MathInfo, MathExtra>, plan: BlockRescan): KindState<MathInfo, MathExtra> {
  if (plan.from === Infinity) return prev;
  const doc = state.doc;
  const old = prev.blocks;
  const oldStop = prev.extra?.stoppedAt ?? null;
  const startLine = doc.lineAt(Math.min(plan.from, doc.length));
  const blocks: BlockEntry<MathInfo>[] = [];
  let i = 0;
  while (i < old.length && old[i].to < startLine.from) blocks.push(old[i++]);

  // Fenced code along the search, collected per top-level node as it advances.
  const top = syntaxTree(state).topNode;
  let nextNode: SyntaxNode | null | undefined;
  const fences: Array<{ from: number; to: number }> = [];
  const inFence = (from: number, to: number) => {
    if (nextNode === undefined) nextNode = top.childAfter(from);
    while (nextNode && nextNode.from < to) {
      fencedCodeRangesIn(nextNode, fences);
      nextNode = nextNode.nextSibling;
    }
    return overlaps(from, to, fences);
  };

  let n: number;
  if (oldStop !== null && oldStop < startLine.from) {
    // The old search stopped at an opening line before the stretch: no line
    // between it and the stretch ends in `$$`, so look for its closing from there.
    const open = doc.lineAt(oldStop).number;
    const closing = mathClosing(doc, Math.max(open + 1, startLine.number));
    if (closing === -1) return { blocks, extra: { stoppedAt: oldStop } };
    blocks.push(mathEntry(doc, open, closing));
    n = closing + 1;
  } else {
    // A pair the stretch cuts through is searched again from its opening line.
    n = i < old.length && old[i].from < startLine.from ? doc.lineAt(old[i].from).number : startLine.number;
  }

  // Where the old search stood at a line start: outside every pair, and not yet stopped.
  const oldOutside = (pos: number) => {
    if (oldStop !== null && pos > oldStop) return false;
    let lo = 0;
    let hi = old.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (old[mid].from < pos) lo = mid + 1;
      else hi = mid - 1;
    }
    // old[hi] is the last pair opening before pos.
    return hi < 0 || pos > old[hi].to;
  };

  for (; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.from >= plan.to) {
      const oldPos = line.from - plan.delta;
      if (oldOutside(oldPos)) {
        for (const block of old) {
          if (block.from >= oldPos) blocks.push({ from: block.from + plan.delta, to: block.to + plan.delta, info: block.info });
        }
        return { blocks, extra: { stoppedAt: oldStop === null ? null : oldStop + plan.delta } };
      }
    }
    if (!isMathOpener(line.text)) continue;
    if (inFence(line.from, line.to)) continue;
    const closing = mathClosing(doc, n + 1);
    if (closing === -1) return { blocks, extra: { stoppedAt: line.from } };
    blocks.push(mathEntry(doc, n, closing));
    n = closing;
  }
  return { blocks, extra: { stoppedAt: null } };
}

const mathKind: BlockKind<MathInfo, BlockContext, MathExtra> = {
  discoverAll: discoverAllMath,
  discover: discoverMath,
  decorate(state, ctx, block) {
    if (ctx.reveal && selectionTouches(state.selection, block.from, block.to)) return null;
    if (!block.info.expr) return null;
    return Decoration.replace({ widget: new MathWidget(block.info.expr, true), block: true });
  },
};

function blockFieldConfig(texts: MathMermaidTexts): BlockFieldConfig<BlockContext> {
  return {
    label: "mathMermaidLive",
    kinds: [mermaidKind(texts), mathKind],
    // The theme joins the context so a switch redraws every diagram.
    context: (state) => ({ reveal: isEditorInteractive(state), theme: currentMermaidTheme() }),
    sameContext: (a, b) => a.reveal === b.reveal && a.theme === b.theme,
    triggers: (tr) => tr.docChanged || !!tr.selection || hasAnchorHighlightChange(tr) || syntaxTree(tr.startState) !== syntaxTree(tr.state) || interactivityChanged(tr.startState, tr.state),
    refreshesAll: hasAnchorHighlightChange,
  };
}

/** The diagram and `$$` decorations of `state` searched from scratch - what the field always equals. */
export function mathMermaidDecorationsFromScratch(state: EditorState, texts: MathMermaidTexts): DecorationSet {
  return blockDecorationsFromScratch(blockFieldConfig(texts), state);
}

// Block-level widgets MUST come from a StateField (not a view plugin): they
// change line heights and have to be known before the viewport is measured —
// same rule as tableField. The field follows the text (performance plan L6,
// incrementalBlocks.ts).
export function mathMermaidBlockField(texts: MathMermaidTexts): Extension {
  return incrementalBlockField(blockFieldConfig(texts));
}
