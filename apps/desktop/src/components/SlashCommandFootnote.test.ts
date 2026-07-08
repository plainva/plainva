// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getSlashCommands } from "./SlashCommandPlugin";

type ApplyFn = (view: EditorView, completion: unknown, from: number, to: number) => void;

function applySlash(type: string, doc: string, from: number, to: number): { text: string; caret: number } {
  const view = new EditorView({ state: EditorState.create({ doc }) });
  const completion = getSlashCommands().find((c) => c.type === type)!;
  (completion.apply as ApplyFn)(view, completion, from, to);
  const result = { text: view.state.doc.toString(), caret: view.state.selection.main.head };
  view.destroy();
  return result;
}
const applyFootnote = (doc: string, from: number, to: number) => applySlash("footnote", doc, from, to);

describe("slash footnote (P3.6)", () => {
  it("inserts the next free number and appends the definition at the end", () => {
    // "/fn" typed at the end of the first line -> replace chars 5..8.
    const doc = "Text /fn\n\nMehr Text mit [^1] Bestand.\n\n[^1]: Alte Notiz";
    const { text, caret } = applyFootnote(doc, 5, 8);
    expect(text).toBe("Text [^2]\n\nMehr Text mit [^1] Bestand.\n\n[^1]: Alte Notiz\n\n[^2]: ");
    expect(caret).toBe(text.length); // typing continues inside the definition
  });

  it("starts at [^1] in a note without footnotes and pads a trailing newline", () => {
    const { text, caret } = applyFootnote("Absatz /fn\n", 7, 10);
    expect(text).toBe("Absatz [^1]\n\n[^1]: ");
    expect(caret).toBe(text.length);
  });

  it("ignores non-numeric labels when picking the next number", () => {
    const { text } = applyFootnote("A /fn und [^note] bleibt\n\n[^note]: x", 2, 5);
    expect(text.startsWith("A [^1] und")).toBe(true);
    expect(text.endsWith("[^1]: ")).toBe(true);
  });
});

describe("slash math + mermaid inserts (Part 2)", () => {
  it("inserts a $$ block and parks the caret on the empty middle line", () => {
    // "/katex" typed at line start -> replace chars 0..6.
    const { text, caret } = applySlash("math", "/katex", 0, 6);
    expect(text).toBe("$$\n\n$$");
    expect(caret).toBe(3); // right after "$$\n": the empty middle line
  });

  it("inserts a mermaid fence and parks the caret inside the empty body", () => {
    const { text, caret } = applySlash("mermaid", "/mermaid", 0, 8);
    expect(text).toBe("```mermaid\n\n```");
    expect(caret).toBe(11); // right after "```mermaid\n"
  });
});
