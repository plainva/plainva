// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { writeFileSync } from "node:fs";
import { Compartment, EditorSelection, EditorState, type Extension, type SelectionRange, type Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages as codeLanguages } from "@codemirror/language-data";
import { tableField, tableDecorationsFromScratch } from "../../../../packages/ui/src/components/LivePreviewPlugin";
import { mathMermaidBlockField, mathMermaidDecorationsFromScratch } from "../../../../packages/ui/src/components/mathMermaidLive";
import { tasksQueryBlockField, tasksQueryDecorationsFromScratch } from "../../../../packages/ui/src/components/tasksQueryLive";
import { blockFieldDecorations } from "../../../../packages/ui/src/components/incrementalBlocks";
import { anchorHighlightExtension, setAnchorHighlights } from "../../../../packages/ui/src/components/anchorHighlight";
import { textDirectionExtension } from "../../../../packages/ui/src/components/textDirectionExtension";
import { anchorAwareHtmlBlock } from "../../../../packages/ui/src/components/anchorBlockParser";
import { frontmatterBlock } from "../../../../packages/ui/src/components/frontmatterBlockParser";
import { boundedInlineSyntax } from "../../../../packages/ui/src/lib/boundedMarkdown";
import { wikiLinkInlineSyntax } from "../../../../packages/ui/src/components/wikiLinkInline";
import { parseMarkdownTable } from "../../../../packages/ui/src/components/tableModel";

/**
 * Performance plan L6: the block fields (tables, Mermaid and `$$`, ```tasks)
 * follow the text instead of searching the note again on every caret move and
 * keystroke. What they draw must not change: after every transaction of a long
 * random run - typing, deleting, pasting blocks, opening and closing fences
 * and comments, moving and widening the selection, several cursors, undoing,
 * steps of the background parse, switching to read mode and back, new comment
 * frames - each field must equal the same field built from scratch on that
 * state, and that must equal the search the fields made before L6 (copied
 * below as it was).
 */

const texts = { loading: "loading", error: "error" };
const host = () => ({ mount: () => () => {} }) as never;

let markdownExt: Extension;
beforeAll(async () => {
  // A few code languages ready at once, so fences carry mounted trees (the
  // search for tables walks into them like Tree.iterate does).
  await Promise.all(codeLanguages.filter((l) => ["JavaScript", "Markdown", "Python"].includes(l.name)).map((l) => l.load()));
  markdownExt = markdown({ base: markdownLanguage, codeLanguages, extensions: [frontmatterBlock, anchorAwareHtmlBlock, boundedInlineSyntax, wikiLinkInlineSyntax] });
});

// ---- The searches as they were before L6 (reference) ----------------------

function legacyActiveLines(state: EditorState, reveal: boolean): Set<number> {
  const set = new Set<number>();
  if (!reveal) return set;
  for (const r of state.selection.ranges) {
    const s = state.doc.lineAt(r.from).number;
    const e = state.doc.lineAt(r.to).number;
    for (let i = s; i <= e; i++) set.add(i);
  }
  return set;
}

const interactive = (s: EditorState) => s.facet(EditorView.editable) && !s.readOnly;

function legacyTables(state: EditorState): string[] {
  const out: string[] = [];
  const active = legacyActiveLines(state, interactive(state));
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Table") return;
      const startLine = state.doc.lineAt(node.from).number;
      let endLine = state.doc.lineAt(Math.min(node.to, state.doc.length)).number;
      while (endLine > startLine + 1 && !state.doc.line(endLine).text.includes("|")) endLine--;
      for (let i = startLine; i <= endLine; i++) if (active.has(i)) return false;
      const from = state.doc.line(startLine).from;
      const to = state.doc.line(endLine).to;
      const model = parseMarkdownTable(state.sliceDoc(from, to));
      if (model) out.push(`${from}-${to}:${JSON.stringify(model)}`);
      return false;
    },
  });
  return out;
}

function legacyMath(state: EditorState): string[] {
  const out: string[] = [];
  const doc = state.doc;
  const active = legacyActiveLines(state, interactive(state));
  const fences: Array<{ from: number; to: number }> = [];
  syntaxTree(state).iterate({ enter: (node) => { if (node.name !== "FencedCode") return; fences.push({ from: node.from, to: node.to }); return false; } });
  const overlaps = (a: number, b: number) => fences.some((r) => a < r.to && b > r.from);
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const t = line.text.trim();
    if (!t.startsWith("$$") || (t.length > 2 && t.endsWith("$$"))) continue;
    if (overlaps(line.from, line.to)) continue;
    let closing = -1;
    for (let m = n + 1; m <= doc.lines; m++) if (doc.line(m).text.trim().endsWith("$$")) { closing = m; break; }
    if (closing === -1) break;
    let focused = false;
    for (let i = n; i <= closing; i++) if (active.has(i)) { focused = true; break; }
    if (!focused) {
      const raw = doc.sliceString(line.from, doc.line(closing).to);
      const expr = raw.replace(/^\s*\$\$/, "").replace(/\$\$\s*$/, "").trim();
      if (expr) out.push(`${line.from}-${doc.line(closing).to}:${expr}`);
    }
    n = closing;
  }
  return out;
}

// ---- Comparing decoration sets --------------------------------------------

interface Item { from: number; to: number; widget: { eq(o: unknown): boolean; constructor: unknown } & Record<string, unknown>; block: boolean }

function items(set: DecorationSet, len: number): Item[] {
  const out: Item[] = [];
  set.between(0, len, (from, to, deco) => {
    out.push({ from, to, widget: deco.spec.widget, block: !!deco.spec.block });
  });
  return out;
}

function expectSame(actual: DecorationSet, expected: DecorationSet, state: EditorState, what: string) {
  const a = items(actual, state.doc.length);
  const b = items(expected, state.doc.length);
  const show = (list: Item[]) => list.map((i) => `${i.from}-${i.to}`).join(",");
  if (a.length !== b.length || a.some((x, i) => x.from !== b[i].from || x.to !== b[i].to || x.block !== b[i].block
    || x.widget.constructor !== b[i].widget.constructor || !x.widget.eq(b[i].widget) || !b[i].widget.eq(x.widget))) {
    throw new Error(`${what}: incremental [${show(a)}] != scratch [${show(b)}]`);
  }
}

function describeWidgets(set: DecorationSet, state: EditorState, kind: "table" | "math"): string[] {
  return items(set, state.doc.length)
    .filter((i) => (kind === "table" ? "model" in i.widget : "expr" in i.widget))
    .map((i) => `${i.from}-${i.to}:${kind === "table" ? JSON.stringify(i.widget.model) : String(i.widget.expr)}`);
}

// ---- The random run ---------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLOCKS = [
  "| a | b |\n|---|:-:|\n| 1 | **x** |\n| 2 | [[Link]] |",
  "| h |\n| --- |\n| r |",
  "> [!note] Title\n> | a | b |\n> |---|---|\n> | c | d |",
  "> quote\n> | q | r |\n> | - | - |\n> | s | t |",
  "- item\n  | a | b |\n  |---|---|\n  | 1 | 2 |",
  "```mermaid\ngraph TD; A-->B\n```",
  "> ```mermaid\n> graph LR; X-->Y\n> ```",
  "```tasks\nnot done\n```",
  "```js\nconst a = '| a | b |';\n```",
  "```md\n| a | b |\n|---|---|\n$$\n```",
  "~~~\n$$\nx\n$$\n~~~",
  "$$\nE = mc^2\n$$",
  "$$\n\n$$",
  "$$ a\nb $$",
  "<!--\n| a | b |\n|---|---|\n-->",
  "## Heading",
  "Some *text* with a [[Wiki]] link and `code`.",
  "- one\n- two\n  - three",
  "1. first\n2. second",
  "Paragraph line\n| x | y |\n|---|---|\n| 1 | 2 |\nfollowing line",
  "",
];

const SNIPPETS = ["\n", "\n\n", "|", " | z |", "\n|---|---|\n", "```", "```\n", "~~~", "$$", "\n$$\n", "<!--", "-->", "> ", "- ", "x", "abc", "  ", "-->\n", "```mermaid\n", "```tasks\n", "---\n"];

function randomDoc(rand: () => number, blocks: number): string {
  const parts: string[] = [];
  if (rand() < 0.2) parts.push("---\ntitle: x\n---");
  for (let i = 0; i < blocks; i++) parts.push(BLOCKS[Math.floor(rand() * BLOCKS.length)]);
  return parts.join(rand() < 0.8 ? "\n\n" : "\n");
}

function randomSelection(rand: () => number, len: number): EditorSelection {
  const count = rand() < 0.15 ? 2 + Math.floor(rand() * 2) : 1;
  const ranges: SelectionRange[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.floor(rand() * (len + 1));
    const b = rand() < 0.7 ? a : Math.min(len, a + Math.floor(rand() * 200));
    ranges.push(EditorSelection.range(a, b));
  }
  return EditorSelection.create(ranges);
}

function runSeed(seed: number, steps: number, blocks: number) {
  const rand = rng(seed);
  const mode = new Compartment();
  const fields = { table: tableField(true), math: mathMermaidBlockField(texts), tasks: tasksQueryBlockField(host) };
  const readMode = [EditorState.readOnly.of(true)];
  let state = EditorState.create({
    doc: randomDoc(rand, blocks),
    extensions: [markdownExt, textDirectionExtension(), anchorHighlightExtension(() => {}), mode.of([]), fields.table, fields.math, fields.tasks],
  });
  const history: Transaction[] = [];
  let reading = false;

  const check = (label: string) => {
    expectSame(blockFieldDecorations(state, fields.table), tableDecorationsFromScratch(state), state, `${label} table`);
    expectSame(blockFieldDecorations(state, fields.math), mathMermaidDecorationsFromScratch(state, texts), state, `${label} math`);
    expectSame(blockFieldDecorations(state, fields.tasks), tasksQueryDecorationsFromScratch(state, host), state, `${label} tasks`);
    expect(describeWidgets(blockFieldDecorations(state, fields.table), state, "table")).toEqual(legacyTables(state));
    expect(describeWidgets(blockFieldDecorations(state, fields.math), state, "math")).toEqual(legacyMath(state));
  };
  check(`seed ${seed} start`);

  for (let step = 0; step < steps; step++) {
    const len = state.doc.length;
    const r = rand();
    let spec: TransactionSpec;
    if (r < 0.3) {
      const pos = Math.floor(rand() * (len + 1));
      const insert = rand() < 0.6 ? SNIPPETS[Math.floor(rand() * SNIPPETS.length)] : `\n${BLOCKS[Math.floor(rand() * BLOCKS.length)]}\n`;
      spec = { changes: { from: pos, insert }, selection: EditorSelection.cursor(pos + insert.length), userEvent: "input.type" };
    } else if (r < 0.45) {
      const from = Math.floor(rand() * (len + 1));
      const to = Math.min(len, from + Math.floor(rand() * (rand() < 0.8 ? 5 : 300)));
      spec = { changes: { from, to }, userEvent: "delete" };
    } else if (r < 0.5) {
      // Two edits in one transaction, as several cursors type.
      const a = Math.floor(rand() * (len + 1));
      const b = Math.floor(rand() * (len + 1));
      const [p, q] = a <= b ? [a, b] : [b, a];
      spec = { changes: [{ from: p, insert: "|" }, { from: q, to: Math.min(len, q + (q > p ? 1 : 0)), insert: "\n" }] };
    } else if (r < 0.58 && history.length) {
      // Undo an earlier edit (its inverse, mapped onto today's text).
      const tr = history.splice(Math.floor(rand() * history.length), 1)[0];
      if (tr.state.doc.length !== len) continue;
      spec = { changes: tr.changes.invert(tr.startState.doc), userEvent: "undo" };
    } else if (r < 0.85) {
      spec = { selection: randomSelection(rand, len), userEvent: "select" };
    } else if (r < 0.9) {
      // A step of the background parse.
      ensureSyntaxTree(state, Math.floor(rand() * (len + 1)), 50);
      spec = {};
    } else if (r < 0.94) {
      reading = !reading;
      spec = { effects: mode.reconfigure(reading ? readMode : []) };
    } else {
      const highlights = Array.from({ length: Math.floor(rand() * 3) }, (_, i) => {
        const from = Math.floor(rand() * len);
        return { commentId: `c${i}`, from, to: Math.min(len, from + 20), active: rand() < 0.5, frame: { kind: "tableCell" as const, row: 0, column: 0 } };
      });
      spec = { effects: setAnchorHighlights.of(highlights) };
    }
    const tr = state.update(spec);
    if (tr.docChanged) history.push(tr);
    if (history.length > 20) history.shift();
    const previous = state;
    state = tr.state;
    try {
      check(`seed ${seed} step ${step}`);
    } catch (error) {
      if (process.env.PLAINVA_BLOCKS_DEBUG) {
        writeFileSync(process.env.PLAINVA_BLOCKS_DEBUG, JSON.stringify({
          error: String(error), before: previous.doc.toString(), after: state.doc.toString(),
          changes: tr.changes.toJSON(), selection: state.selection.toJSON(), oldTree: syntaxTree(previous).length, newTree: syntaxTree(state).length,
        }, null, 1));
      }
      throw error;
    }
  }
}

describe("block fields that follow the text (L6)", () => {
  it("equal a search from scratch after every random transaction (small notes)", () => {
    for (let seed = 1; seed <= 60; seed++) runSeed(seed, 250, 6 + (seed % 10));
  }, 300_000);

  it("equal a search from scratch in long notes, also while the parse is incomplete", () => {
    // Long enough that the first parse stops early and the tree grows in steps.
    for (let seed = 101; seed <= 106; seed++) runSeed(seed, 200, 400);
  }, 300_000);

  it("keeps the same decorations object when a caret move touches no block", () => {
    const field = tableField(true);
    let state = EditorState.create({ doc: "para one\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\npara two\n\npara three", extensions: [markdownExt, field] });
    state = state.update({}).state;
    ensureSyntaxTree(state, state.doc.length, 5000);
    state = state.update({}).state;
    const before = blockFieldDecorations(state, field);
    expect(items(before, state.doc.length)).toHaveLength(1);
    state = state.update({ selection: EditorSelection.cursor(state.doc.length - 3) }).state;
    expect(blockFieldDecorations(state, field)).toBe(before);
    // Entering the table shows its source.
    state = state.update({ selection: EditorSelection.cursor(12) }).state;
    expect(items(blockFieldDecorations(state, field), state.doc.length)).toHaveLength(0);
  });
});
