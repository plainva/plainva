import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { EditorState, Range, RangeSetBuilder, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { activeLineSet } from "./LivePreviewPlugin";
import { renderMermaidDiagram, currentMermaidTheme } from "../services/mermaidRender";

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
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView) {
      const builder = new RangeSetBuilder<Decoration>();
      const selection = view.state.selection;

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

          // Caret/selection touching the expression keeps it raw source.
          let focused = false;
          for (const r of selection.ranges) {
            if (r.from <= matchEnd && r.to >= matchStart) { focused = true; break; }
          }
          if (focused) continue;

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
  constructor(readonly code: string, readonly theme: string, readonly texts: MathMermaidTexts) { super(); }

  eq(other: MermaidLiveWidget) {
    return this.code === other.code && this.theme === other.theme;
  }

  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "pv-mermaid-live";
    // Padding, NOT margin: an element's OWN margin is excluded from the height
    // CodeMirror measures (offsetHeight), which left a small residual caret
    // offset per diagram. Padding sits inside the border-box and is measured.
    el.style.padding = "0.4em 0";
    el.style.overflowX = "auto";
    el.style.cursor = "text"; // clicking flips to source (caret enters the fence)
    el.addEventListener("mousedown", (e) => caretIntoWidget(view, el, e));
    keepHeightInSync(view, el);
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
        box.style.cssText = "border:1px solid var(--warning-border);background:var(--warning-bg);color:var(--warning-text);border-radius:var(--radius-sm);padding:0.5em 0.8em;font-size:0.85rem;";
        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.textContent = this.texts.error;
        const pre = document.createElement("pre");
        pre.style.cssText = "margin:0.3em 0 0;white-space:pre-wrap;font-size:0.8rem;";
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

function buildBlockDecorations(state: EditorState, texts: MathMermaidTexts): DecorationSet {
  const decos: Range<Decoration>[] = [];
  try {
    const activeLines = activeLineSet(state);
    const doc = state.doc;
    const fences: Array<{ from: number; to: number }> = [];

    // ```mermaid fences via the syntax tree (the only fence type we replace).
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name !== "FencedCode") return;
        fences.push({ from: node.from, to: node.to });
        const firstLine = doc.lineAt(node.from);
        if (!/^(`{3,}|~{3,})\s*mermaid\s*$/i.test(firstLine.text)) return false;
        const lastLine = doc.lineAt(Math.min(node.to, doc.length));
        // An unterminated fence swallows the rest of the note — only replace
        // when the closing marker exists.
        if (lastLine.number === firstLine.number || !/^(`{3,}|~{3,})\s*$/.test(lastLine.text)) return false;
        for (let i = firstLine.number; i <= lastLine.number; i++) {
          if (activeLines.has(i)) return false;
        }
        const code = doc.sliceString(doc.line(firstLine.number + 1).from, doc.line(lastLine.number - 1).to);
        if (!code.trim()) return false;
        decos.push(
          Decoration.replace({
            widget: new MermaidLiveWidget(code, currentMermaidTheme(), texts),
            block: true,
          }).range(firstLine.from, lastLine.to)
        );
        return false;
      },
    });

    // Multi-line $$ blocks: an opening line that starts with $$ (and does not
    // close on the same line) up to the next line ending in $$.
    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n);
      const t = line.text.trim();
      if (!t.startsWith("$$") || (t.length > 2 && t.endsWith("$$"))) continue;
      if (overlaps(line.from, line.to, fences)) continue;
      let closing = -1;
      for (let m = n + 1; m <= doc.lines; m++) {
        if (doc.line(m).text.trim().endsWith("$$")) { closing = m; break; }
      }
      if (closing === -1) break;
      let focused = false;
      for (let i = n; i <= closing; i++) if (activeLines.has(i)) { focused = true; break; }
      if (!focused) {
        const raw = doc.sliceString(line.from, doc.line(closing).to);
        const expr = raw.replace(/^\s*\$\$/, "").replace(/\$\$\s*$/, "").trim();
        if (expr) {
          decos.push(
            Decoration.replace({
              widget: new MathWidget(expr, true),
              block: true,
            }).range(line.from, doc.line(closing).to)
          );
        }
      }
      n = closing;
    }
  } catch (e) {
    console.error("[mathMermaidLive] build error", e);
    return Decoration.none;
  }
  return Decoration.set(decos, true);
}

// Block-level widgets MUST come from a StateField (not a view plugin): they
// change line heights and have to be known before the viewport is measured —
// same rule as tableField.
export function mathMermaidBlockField(texts: MathMermaidTexts) {
  return StateField.define<DecorationSet>({
    create: (state) => buildBlockDecorations(state, texts),
    update: (value, tr) => {
      if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return buildBlockDecorations(tr.state, texts);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
