import { Decoration, ViewPlugin, EditorView, ViewUpdate, DecorationSet, WidgetType } from "@codemirror/view";
import { Range, StateField, EditorState, Extension, EditorSelection, Facet } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { parseCalloutMarker, calloutColorKey, calloutColor, calloutIconPath } from "./callouts";
import { parseMarkdownTable, serializeTable, setCell, type TableModel, type TableAlign } from "./tableModel";
import { renderInlineMarkdown, type InlineLinkHandlers } from "@plainva/ui";
import { formatRelativeDate, DATE_TOKEN_RE } from "../services/dynamicDate";
import i18n from "@plainva/ui/i18n";

const HIDE = Decoration.replace({});

/** Link handlers for rendered table-cell content (wiki links, external URLs).
 *  Provided by the editor; widgets read them via `view.state.facet(...)`. */
export const tableLinkHandlers = Facet.define<InlineLinkHandlers, InlineLinkHandlers>({
  combine: (values) => values[0] ?? {},
});

function buildFrontmatterDeco(state: EditorState, hide: boolean): DecorationSet {
  const decos = [];
  if (state.doc.lines >= 1) {
    const firstLine = state.doc.line(1).text;
    if (firstLine === "---") {
      let endLine = 0;
      for (let i = 2; i <= state.doc.lines; i++) {
        if (state.doc.line(i).text === "---") {
          endLine = i;
          break;
        }
      }
      if (endLine > 0) {
        const from = state.doc.line(1).from;
        const to = state.doc.line(endLine).to;
        const toWithNewline = Math.min(to + 1, state.doc.length);
        if (from < toWithNewline) {
          if (hide) {
            decos.push(Decoration.replace({ block: true }).range(from, toWithNewline));
          } else {
            // Apply line decoration to reset styles in Source Mode
            for (let i = 1; i <= endLine; i++) {
              decos.push(Decoration.line({ class: "cm-frontmatter" }).range(state.doc.line(i).from));
            }
          }
        }
      }
    }
  }
  return Decoration.set(decos, true);
}

export function frontmatterStateField(isLive: boolean) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildFrontmatterDeco(state, isLive);
    },
    update(value, tr) {
      if (tr.docChanged) {
        return buildFrontmatterDeco(tr.state, isLive);
      }
      return value;
    },
    provide: f => EditorView.decorations.from(f)
  });
}

export function frontmatterProtectPlugin(isLive: boolean): Extension {
  if (!isLive) return [];
  return EditorState.transactionFilter.of(tr => {
    let frontmatterEnd = 0;
    if (tr.startState.doc.lines >= 1) {
      if (tr.startState.doc.line(1).text === "---") {
        for (let i = 2; i <= tr.startState.doc.lines; i++) {
          if (tr.startState.doc.line(i).text === "---") {
            frontmatterEnd = Math.min(tr.startState.doc.line(i).to + 1, tr.startState.doc.length);
            break;
          }
        }
      }
    }

    if (frontmatterEnd > 0) {
      // Reject any user-initiated document changes inside the frontmatter
      if (tr.docChanged && (tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("paste") || tr.isUserEvent("undo") || tr.isUserEvent("redo"))) {
        let invalidChange = false;
        tr.changes.iterChanges((fromA) => {
          if (fromA < frontmatterEnd) {
            invalidChange = true;
          }
        });
        if (invalidChange) {
          return []; // Reject transaction completely
        }
      }

      // Force selection out of frontmatter
      if (tr.selection) {
        let selectionAdjusted = false;
        const newRanges = tr.selection.ranges.map(range => {
          if (range.head < frontmatterEnd || range.anchor < frontmatterEnd) {
            selectionAdjusted = true;
            const head = Math.max(range.head, frontmatterEnd);
            const anchor = Math.max(range.anchor, frontmatterEnd);
            return EditorSelection.range(anchor, head);
          }
          return range;
        });
        if (selectionAdjusted) {
          return [tr, { selection: EditorSelection.create(newRanges, tr.selection.mainIndex) }];
        }
      }
    }
    return tr;
  });
}

export function frontmatterHidePlugin(isLive: boolean): Extension {
  return [frontmatterStateField(isLive), frontmatterProtectPlugin(isLive)];
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = "•";
    span.className = "cm-md-bullet";
    return span;
  }
}
const bulletDeco = Decoration.replace({ widget: new BulletWidget() });

// Interactive task checkbox. Clicking toggles the source character between
// " " and "x" at the recorded document position.
class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) { super(); }
  eq(other: TaskWidget) { return other.checked === this.checked && other.pos === this.pos; }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-md-task";
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() { return false; }
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Colored type icon shown at the start of a callout header (Obsidian-style),
// replacing the raw "[!type]" marker in live mode.
class CalloutIconWidget extends WidgetType {
  constructor(readonly type: string) { super(); }
  eq(other: CalloutIconWidget) { return other.type === this.type; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-callout-icon";
    span.style.color = calloutColor(this.type);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = calloutIconPath(this.type); // static, trusted markup
    span.appendChild(svg);
    return span;
  }
}

// Renders an `@YYYY-MM-DD` token as a relative date chip (Heute/Morgen/… or the
// full date), recomputed each render against the current day (#4 dynamic dates).
class DateChipWidget extends WidgetType {
  constructor(readonly iso: string) { super(); }
  eq(other: DateChipWidget) { return other.iso === this.iso; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-date-chip";
    const locale = (i18n.language || "de").slice(0, 2);
    span.textContent = formatRelativeDate(this.iso, new Date(), locale);
    span.title = this.iso;
    return span;
  }
}

// Capitalized type name shown as the header when a callout has no custom title.
class CalloutLabelWidget extends WidgetType {
  constructor(readonly type: string) { super(); }
  eq(other: CalloutLabelWidget) { return other.type === this.type; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-callout-label";
    span.style.color = calloutColor(this.type);
    span.textContent = this.type.charAt(0).toUpperCase() + this.type.slice(1);
    return span;
  }
}

// Lines (1-based) touched by the selection — their raw markdown stays visible.
export function activeLineSet(state: EditorState): Set<number> {
  const set = new Set<number>();
  for (const r of state.selection.ranges) {
    const s = state.doc.lineAt(r.from).number;
    const e = state.doc.lineAt(r.to).number;
    for (let i = s; i <= e; i++) set.add(i);
  }
  return set;
}

function alignToCss(a: TableAlign): "left" | "center" | "right" {
  return a === "center" ? "center" : a === "right" ? "right" : "left";
}

// Replace the table's source range [from, to] with a freshly serialized model.
// No `selection` is set so the caret stays outside the table and the widget
// keeps rendering (a caret inside the range would flip it back to raw markdown).
function replaceTableRange(view: EditorView, from: number, to: number, model: TableModel) {
  const safeTo = Math.min(to, view.state.doc.length);
  view.dispatch({ changes: { from, to: safeTo, insert: serializeTable(model) }, userEvent: "input" });
}

// Renders a GFM table as a real <table>. Clicking a cell opens a native <input>
// editor in place; committing on blur / Enter rewrites the canonical GFM
// source. Right-clicking a cell opens the row/column context menu (handled in
// Editor.tsx via a window event). The raw markdown stays reachable through
// Source mode.
//
// A native <input> is used (not contenteditable on the cell): the table lives
// inside CodeMirror's editable contentDOM, and a contenteditable cell would
// route keystrokes through CM's beforeinput handler and overwrite the document.
// An <input> has its own input model, so combined with ignoreEvent /
// ignoreMutation CodeMirror stays entirely out of the cell.
class TableWidget extends WidgetType {
  constructor(readonly model: TableModel, readonly from: number, readonly to: number) { super(); }
  eq(other: TableWidget) {
    return other.from === this.from && other.to === this.to
      && JSON.stringify(other.model) === JSON.stringify(this.model);
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table-wrap";
    // The wrapper is not editable; cells open their own <input> on click. This
    // keeps CodeMirror from treating the table chrome as editable text.
    wrap.contentEditable = "false";
    const table = document.createElement("table");
    table.className = "cm-md-table";

    // Cell DISPLAY renders the inline-markdown subset (bold, links, <br>, …);
    // editing keeps the raw markdown in the <input>.
    const handlers = view.state.facet(tableLinkHandlers);
    const renderCell = (cell: HTMLTableCellElement, raw: string) => {
      cell.textContent = "";
      cell.appendChild(renderInlineMarkdown(raw, handlers));
    };

    const openCellEditor = (cell: HTMLTableCellElement, kind: "header" | "body", rowIndex: number, colIndex: number) => {
      if (cell.querySelector("input")) return; // already editing this cell
      const original = (kind === "header" ? this.model.headers[colIndex] : this.model.rows[rowIndex]?.[colIndex]) ?? "";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "cm-md-table-input";
      input.value = original;
      input.style.textAlign = alignToCss(this.model.aligns[colIndex] ?? null);
      cell.textContent = "";
      cell.appendChild(input);
      input.focus();
      input.select();
      let finished = false;
      const finish = (save: boolean) => {
        if (finished) return;
        finished = true;
        const value = save ? input.value : original;
        renderCell(cell, value); // remove the input, restore the rendered cell
        if (save && value !== original) {
          replaceTableRange(view, this.from, this.to, setCell(this.model, kind, rowIndex, colIndex, value));
        }
      };
      input.addEventListener("blur", () => finish(true));
      input.addEventListener("keydown", (e) => {
        e.stopPropagation(); // keep CM keymaps (e.g. select-all) out of the cell
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      });
    };

    const wireCell = (cell: HTMLTableCellElement, kind: "header" | "body", rowIndex: number, colIndex: number) => {
      cell.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return; // left button only; right opens the menu
        e.preventDefault();
        e.stopPropagation();
        openCellEditor(cell, kind, rowIndex, colIndex);
      });
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("plainva-open-table-menu", {
          detail: {
            x: e.clientX, y: e.clientY,
            from: this.from, to: this.to,
            kind, rowIndex, colIndex,
            align: this.model.aligns[colIndex] ?? null,
          },
        }));
      });
    };

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    this.model.headers.forEach((h, i) => {
      const th = document.createElement("th");
      renderCell(th, h);
      th.style.textAlign = alignToCss(this.model.aligns[i] ?? null);
      wireCell(th, "header", -1, i);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    this.model.rows.forEach((row, r) => {
      const tr = document.createElement("tr");
      row.forEach((cell, i) => {
        const td = document.createElement("td");
        renderCell(td, cell);
        td.style.textAlign = alignToCss(this.model.aligns[i] ?? null);
        wireCell(td, "body", r, i);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }
  // Let the browser/cell handle its own events (typing, selection, context
  // menu); CodeMirror must not treat them as editor input.
  ignoreEvent() { return true; }
  // Crucial for contenteditable cells: the cells live inside CodeMirror's
  // editable contentDOM, so its DOMObserver would otherwise read every
  // keystroke as a document edit (and replay it, wiping the doc). Ignoring
  // mutations leaves the cell DOM under our control; the only path back into
  // the document is the explicit commit in `replaceTableRange`.
  ignoreMutation() { return true; }
}

function buildTableDecorations(state: EditorState, isLive: boolean): DecorationSet {
  if (!isLive) return Decoration.none;
  const decos: Range<Decoration>[] = [];
  try {
    const tree = syntaxTree(state);
    const activeLines = activeLineSet(state);
    tree.iterate({
      enter: (node) => {
        if (node.name !== "Table") return;
        const startLine = state.doc.lineAt(node.from).number;
        let endLine = state.doc.lineAt(Math.min(node.to, state.doc.length)).number;
        // lezer folds the line directly below the table (when no blank line
        // separates them) into the Table node. Trim back to the last real table
        // row (one containing a pipe) so the caret being on that following line
        // doesn't mark the table active (which would flip it to raw markdown).
        while (endLine > startLine + 1 && !state.doc.line(endLine).text.includes("|")) endLine--;
        for (let i = startLine; i <= endLine; i++) if (activeLines.has(i)) return false;
        const from = state.doc.line(startLine).from;
        const to = state.doc.line(endLine).to;
        const model = parseMarkdownTable(state.sliceDoc(from, to));
        if (model) {
          decos.push(Decoration.replace({ widget: new TableWidget(model, from, to), block: true }).range(from, to));
        }
        return false;
      },
    });
  } catch (e) {
    console.error("[tableField] build error", e);
    return Decoration.none;
  }
  return Decoration.set(decos, true);
}

// Block-level table widgets MUST come from a StateField (not a view plugin),
// because they change line heights and have to be known before the viewport is
// measured. (Same reason the frontmatter block decoration uses a field.)
export function tableField(isLive: boolean) {
  return StateField.define<DecorationSet>({
    create: (state) => buildTableDecorations(state, isLive),
    update: (value, tr) => {
      if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return buildTableDecorations(tr.state, isLive);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

const HIGHLIGHT_RE = /==([^=\n]+)==/g;

/**
 * Markdown editor decorations. Works in both "live" and "source" mode:
 * - Blockquote left border and ==highlight== background are shown in both modes.
 * - In live mode it additionally hides the markdown syntax marks on inactive
 *   lines (headers, emphasis, strong, strikethrough, code, quote), renders
 *   unordered list bullets, interactive task checkboxes and horizontal rules.
 * Building is wrapped in try/catch so a parser edge case can never blank the editor.
 *
 * Live mode reveals markdown syntax only where the caret sits (Notion-like); the
 * full raw markdown is always reachable through Source mode.
 */
export function markdownDecorationPlugin(isLive: boolean) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(update: ViewUpdate) {
        // Rebuild on edits, viewport moves, and — crucially — when the syntax tree
        // advances. The tree is parsed lazily/asynchronously, so right after a file
        // is opened the first build can run against an incomplete tree and leave raw
        // markdown ("code") on screen. CodeMirror dispatches an update when background
        // parsing progresses, but that update has neither docChanged nor
        // viewportChanged nor selectionSet — without this check the decorations would
        // never refresh and the formatting would stay missing (Phase 9 block 1 bug).
        let needsRebuild = update.docChanged || update.viewportChanged
          || syntaxTree(update.startState) !== syntaxTree(update.state);
        // Live mode reveals only the span under the cursor, so any caret move
        // (even within a line) must rebuild the decorations.
        if (!needsRebuild && update.selectionSet && isLive) {
          needsRebuild = true;
        }
        if (needsRebuild) {
          this.decorations = this.build(update.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const decos: Range<Decoration>[] = [];
        const { state } = view;
        try {
          const tree = syntaxTree(state);

          // Lines that contain the cursor/selection — in live mode we keep their
          // raw markdown visible so the user can edit it.
          const activeLines = isLive ? activeLineSet(state) : new Set<number>();
          // True when the selection touches [from, to] — used for "notion" token reveal.
          const cursorInRange = (from: number, to: number) =>
            state.selection.ranges.some((r) => r.from <= to && r.to >= from);

          const quoteLineClass = new Map<number, string>();
          const hrLines = new Set<number>();
          // Ranges of tables rendered as widgets (by tableField); we must not add
          // any inline decoration inside them or it would overlap the block widget.
          const inactiveTableRanges: [number, number][] = [];

          let frontmatterEnd = 0;
          if (isLive && state.doc.lines >= 1) {
            const firstLine = state.doc.line(1).text;
            if (firstLine === "---") {
              let endLine = 0;
              for (let i = 2; i <= state.doc.lines; i++) {
                if (state.doc.line(i).text === "---") {
                  endLine = i;
                  break;
                }
              }
              if (endLine > 0) {
                const to = state.doc.line(endLine).to;
                frontmatterEnd = Math.min(to + 1, state.doc.length);
              }
            }
          }

          for (const { from, to } of view.visibleRanges) {
            tree.iterate({
              from,
              to,
              enter: (node) => {
                if (node.name !== "Document" && node.from < frontmatterEnd) return false; // Skip nodes inside frontmatter

                const name = node.name;

                // HTML comments stay visible but unobtrusive in live mode —
                // e.g. the invisible list separator from block drag (E2).
                if (isLive && (name === "CommentBlock" || name === "Comment") && !activeLines.has(state.doc.lineAt(node.from).number)) {
                  decos.push(Decoration.mark({ class: "cm-md-comment-dim" }).range(node.from, node.to));
                  return false;
                }

                // Blockquote: remember every spanned line (both modes). Detect an
                // Obsidian callout from the first line for a type-colored border.
                if (name === "Blockquote") {
                  const startLine = state.doc.lineAt(node.from).number;
                  const endLine = state.doc.lineAt(Math.min(node.to, state.doc.length)).number;
                  const firstLine = state.doc.line(startLine);
                  const firstText = firstLine.text.replace(/^\s*>+\s?/, "");
                  const callout = parseCalloutMarker(firstText);
                  const cls = callout
                    ? `cm-blockquote-line cm-callout-${calloutColorKey(callout.type)}`
                    : "cm-blockquote-line";
                  for (let i = startLine; i <= endLine; i++) quoteLineClass.set(i, cls);
                  // In live mode, turn the (inactive) header line into an
                  // Obsidian-style callout header: replace the raw "[!type]"
                  // marker with a colored type icon, and show the type name when
                  // there is no custom title (so the callout always says what it
                  // is). A custom title is kept but styled bold + in the color.
                  if (callout && isLive && !activeLines.has(startLine)) {
                    const mm = firstLine.text.match(/\[![A-Za-z]+\][+-]?[ \t]?/);
                    if (mm && mm.index !== undefined) {
                      const mStart = firstLine.from + mm.index;
                      const mEnd = mStart + mm[0].length;
                      decos.push(
                        Decoration.replace({ widget: new CalloutIconWidget(callout.type) }).range(mStart, mEnd)
                      );
                      if (callout.title) {
                        decos.push(
                          Decoration.mark({
                            class: "cm-callout-title",
                            attributes: { style: `color:${calloutColor(callout.type)}` },
                          }).range(mEnd, firstLine.to)
                        );
                      } else {
                        decos.push(
                          Decoration.widget({ widget: new CalloutLabelWidget(callout.type), side: 1 }).range(mEnd)
                        );
                      }
                    }
                  }
                  return;
                }

                if (!isLive) return;

                // Tables: when inactive they are replaced by a block widget
                // (tableField), so skip their children here to avoid overlap.
                // When active, descend so the raw markdown stays editable.
                if (name === "Table") {
                  const startLine = state.doc.lineAt(node.from).number;
                  let endLine = state.doc.lineAt(Math.min(node.to, state.doc.length)).number;
                  // Match buildTableDecorations: trim the line lezer folds in
                  // below the table so the widget and this skip agree on its range.
                  while (endLine > startLine + 1 && !state.doc.line(endLine).text.includes("|")) endLine--;
                  let active = false;
                  for (let i = startLine; i <= endLine; i++) if (activeLines.has(i)) { active = true; break; }
                  if (!active) {
                    inactiveTableRanges.push([state.doc.line(startLine).from, state.doc.line(endLine).to]);
                    return false;
                  }
                  return;
                }

                const lineNo = state.doc.lineAt(node.from).number;
                const lineActive = activeLines.has(lineNo);

                // Block-level marks reveal the whole line when the caret is on it
                // (both styles): they belong to the line being edited.
                if (name === "HorizontalRule") {
                  if (lineActive) return;
                  hrLines.add(lineNo);
                  decos.push(HIDE.range(node.from, node.to));
                  return;
                }
                if (name === "TaskMarker") {
                  if (lineActive) return;
                  const text = state.doc.sliceString(node.from, node.to);
                  const checked = /[xX]/.test(text);
                  // Toggle character sits between the brackets: "[ ]" -> index +1.
                  decos.push(
                    Decoration.replace({ widget: new TaskWidget(checked, node.from + 1) }).range(node.from, node.to)
                  );
                  return;
                }
                if (name === "ListMark") {
                  if (lineActive) return;
                  const text = state.doc.sliceString(node.from, node.to);
                  // Ordered list numbers stay as-is.
                  if (/^[-*+]$/.test(text)) {
                    // For task items (- [ ] ...) hide the bullet AND the single
                    // space after it so the checkbox sits flush like a bullet;
                    // otherwise render a "•" bullet.
                    const after = state.doc.sliceString(node.to, Math.min(node.to + 4, state.doc.length));
                    if (/^\s*\[[ xX]\]/.test(after)) {
                      decos.push(HIDE.range(node.from, after.startsWith(" ") ? node.to + 1 : node.to));
                    } else {
                      decos.push(bulletDeco.range(node.from, node.to));
                    }
                  }
                  return;
                }
                if (name === "HeaderMark" || name === "QuoteMark" || name === "CodeMark") {
                  if (lineActive) return;
                  // "# " and "> " marks: hide the single following space too —
                  // otherwise headings/quotes sit visibly indented by one
                  // character compared to body text (maintainer report
                  // 2026-07-06). CodeMark has no trailing-space semantics
                  // (backticks hug their content), and setext/closing marks are
                  // followed by a newline, which the guard leaves alone.
                  let end = node.to;
                  if (name !== "CodeMark" && state.doc.sliceString(end, end + 1) === " ") end += 1;
                  decos.push(HIDE.range(node.from, end));
                  return;
                }
                // Inline emphasis marks: precise reveal — only the span under the
                // cursor shows its (dimmed) markers, the rest of the line stays
                // formatted (Notion-like). The raw markdown is always reachable
                // through Source mode.
                if (name === "EmphasisMark" || name === "StrongEmphasisMark" || name === "StrikethroughMark") {
                  const parent = node.node.parent;
                  const sf = parent ? parent.from : node.from;
                  const st = parent ? parent.to : node.to;
                  if (cursorInRange(sf, st)) {
                    decos.push(Decoration.mark({ class: "cm-md-mark" }).range(node.from, node.to));
                    return;
                  }
                  decos.push(HIDE.range(node.from, node.to));
                  return;
                }
              },
            });
          }

          // Line decorations for blockquotes / callouts / horizontal rules.
          for (const [ln, cls] of quoteLineClass) {
            const line = state.doc.line(ln);
            decos.push(Decoration.line({ class: cls }).range(line.from));
          }
          for (const ln of hrLines) {
            const line = state.doc.line(ln);
            decos.push(Decoration.line({ class: "cm-md-hr-line" }).range(line.from));
          }

          // ==highlight== background (both modes); hide the == marks in live mode.
          for (const { from, to } of view.visibleRanges) {
            const searchFrom = Math.max(from, frontmatterEnd);
            if (searchFrom >= to) continue;
            const text = state.doc.sliceString(searchFrom, to);
            let m: RegExpExecArray | null;
            HIGHLIGHT_RE.lastIndex = 0;
            while ((m = HIGHLIGHT_RE.exec(text)) !== null) {
              const start = searchFrom + m.index;
              const end = start + m[0].length;
              // Skip matches inside a table rendered as a block widget.
              if (inactiveTableRanges.some(([f, t]) => start >= f && start < t)) continue;
              decos.push(Decoration.mark({ class: "cm-md-highlight" }).range(start + 2, end - 2));
              if (isLive && !cursorInRange(start, end)) {
                decos.push(HIDE.range(start, start + 2));
                decos.push(HIDE.range(end - 2, end));
              }
            }
          }

          // Dynamic date tokens @YYYY-MM-DD -> relative chip (live only); raw while
          // the cursor sits in the token so it stays editable.
          if (isLive) {
            for (const { from, to } of view.visibleRanges) {
              const searchFrom = Math.max(from, frontmatterEnd);
              if (searchFrom >= to) continue;
              const text = state.doc.sliceString(searchFrom, to);
              DATE_TOKEN_RE.lastIndex = 0;
              let dm: RegExpExecArray | null;
              while ((dm = DATE_TOKEN_RE.exec(text)) !== null) {
                const start = searchFrom + dm.index;
                const end = start + dm[0].length;
                if (inactiveTableRanges.some(([f, t]) => start >= f && start < t)) continue;
                if (cursorInRange(start, end)) continue; // editing -> show raw
                const iso = `${dm[1]}-${dm[2]}-${dm[3]}`;
                decos.push(Decoration.replace({ widget: new DateChipWidget(iso) }).range(start, end));
              }
            }
          }
        } catch (e) {
          // Never break editor rendering on a decoration error.
          console.error("[markdownDecorationPlugin] build error", e);
          return Decoration.none;
        }
        return Decoration.set(decos, true);
      }
    },
    { decorations: (v) => v.decorations }
  );
}
