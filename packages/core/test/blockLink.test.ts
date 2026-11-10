import { describe, expect, it } from "vitest";
import { newBlockId, planBlockLink, selectNoteFragment, type BlockLinkPlan } from "../src/noteSource.js";

/** A fixed sequence of "random" numbers, so ids are known in advance. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}
const zeros = () => 0; // -> "aaaaaa"

const offsetOf = (text: string, needle: string) => {
  const at = text.indexOf(needle);
  if (at < 0) throw new Error(`missing ${needle}`);
  return at;
};

function apply(text: string, plan: BlockLinkPlan): string {
  if (plan.kind !== "block" || !plan.insert) return text;
  return text.slice(0, plan.insert.at) + plan.insert.text + text.slice(plan.insert.at);
}

describe("a new block id", () => {
  it("is six letters and digits, never one the note already uses (in any case)", () => {
    expect(newBlockId([], zeros)).toBe("aaaaaa");
    expect(newBlockId(["AAAAAA"], sequence(0, 0, 0, 0, 0, 0, 0.99, 0, 0, 0, 0, 0))).toBe("9aaaaa");
    expect(newBlockId(["x"])).toMatch(/^[a-z0-9]{6}$/);
  });
});

describe("Copy block link at a line", () => {
  it("appends the id to a paragraph and the note then leads to that paragraph", () => {
    const text = "# Title\n\nFirst line\nsecond line\n\nOther";
    const plan = planBlockLink(text, offsetOf(text, "second"), zeros);
    expect(plan).toEqual({ kind: "block", id: "aaaaaa", insert: { at: offsetOf(text, "\n\nOther"), text: " ^aaaaaa" } });
    const written = apply(text, plan);
    expect(written).toBe("# Title\n\nFirst line\nsecond line ^aaaaaa\n\nOther");
    expect(selectNoteFragment(written, "^aaaaaa")).toMatchObject({ status: "found", text: "First line\nsecond line ^aaaaaa" });
  });

  it("reuses the id a block already carries — on its line or on a line of its own — and writes nothing", () => {
    const text = "Para ^keep\n\n| A |\n| - |\n| B |\n\n^tab\n";
    expect(planBlockLink(text, 0, zeros)).toEqual({ kind: "block", id: "keep", insert: null });
    expect(planBlockLink(text, offsetOf(text, "| B"), zeros)).toEqual({ kind: "block", id: "tab", insert: null });
    expect(planBlockLink(text, offsetOf(text, "^tab"), zeros)).toEqual({ kind: "block", id: "tab", insert: null });
  });

  it("links one list item, a nested item on its own, and never the whole list", () => {
    const text = "- one\n- two\n  - nested\n- three\n";
    const two = planBlockLink(text, offsetOf(text, "- two"), zeros);
    const written = apply(text, two);
    expect(written).toBe("- one\n- two ^aaaaaa\n  - nested\n- three\n");
    expect(selectNoteFragment(written, "^aaaaaa")).toMatchObject({ status: "found", text: "- two ^aaaaaa\n  - nested" });
    const nested = planBlockLink(written, offsetOf(written, "- nested"), sequence(0.5));
    const both = apply(written, nested);
    expect(both).toContain("  - nested ^");
    if (nested.kind === "block") expect(selectNoteFragment(both, `^${nested.id}`)).toMatchObject({ status: "found", text: `- nested ^${nested.id}` });
  });

  it("puts a task's id behind the task, so a link reaches the task line", () => {
    const text = "- [ ] Call Anna 📅 2026-11-12\n";
    const written = apply(text, planBlockLink(text, 0, zeros));
    expect(written).toBe("- [ ] Call Anna 📅 2026-11-12 ^aaaaaa\n");
  });

  it("writes a table's id on its own line behind it, with a blank line on each side", () => {
    const text = "| A |\n| - |\n| B |\n# Next\n";
    const plan = planBlockLink(text, offsetOf(text, "| B"), zeros);
    const written = apply(text, plan);
    expect(written).toBe("| A |\n| - |\n| B |\n\n^aaaaaa\n\n# Next\n");
    expect(selectNoteFragment(written, "^aaaaaa")).toMatchObject({ status: "found", text: "| A |\n| - |\n| B |" });
    const atEnd = "| A |\n| - |\n| B |";
    expect(apply(atEnd, planBlockLink(atEnd, 0, zeros))).toBe("| A |\n| - |\n| B |\n\n^aaaaaa");
    const blank = "| A |\n| - |\n\nAfter";
    expect(apply(blank, planBlockLink(blank, 0, zeros))).toBe("| A |\n| - |\n\n^aaaaaa\n\nAfter");
  });

  it("links a quote and a callout as one block, the id on a line of its own", () => {
    const text = "> [!note] Title\n> Body text\n";
    const written = apply(text, planBlockLink(text, offsetOf(text, "> Body"), zeros));
    expect(written).toBe("> [!note] Title\n> Body text\n\n^aaaaaa\n");
    expect(selectNoteFragment(written, "^aaaaaa").status).toBe("found");
  });

  it("answers a heading with the heading, not with an id", () => {
    const text = "intro\n\n## Goals for 2027\n\ntext";
    expect(planBlockLink(text, offsetOf(text, "## Goals"), zeros)).toEqual({ kind: "heading", text: "Goals for 2027" });
  });

  it("writes nothing into frontmatter, code, a formula, a comment or an empty line", () => {
    const text = "---\ntitle: x\n---\n\n```js\nconst a = 1;\n```\n\n$$\nx^2\n$$\n\n%% hidden %%\n\n<div>html</div>\n\n---\n";
    expect(planBlockLink(text, offsetOf(text, "title"), zeros)).toEqual({ kind: "refused", reason: "frontmatter" });
    expect(planBlockLink(text, offsetOf(text, "const"), zeros)).toEqual({ kind: "refused", reason: "code" });
    expect(planBlockLink(text, offsetOf(text, "x^2"), zeros)).toEqual({ kind: "refused", reason: "unsupported" });
    expect(planBlockLink(text, offsetOf(text, "%% hidden"), zeros)).toEqual({ kind: "refused", reason: "unsupported" });
    expect(planBlockLink(text, offsetOf(text, "<div>"), zeros)).toEqual({ kind: "refused", reason: "unsupported" });
    expect(planBlockLink(text, offsetOf(text, "\n\n```") + 1, zeros)).toEqual({ kind: "refused", reason: "empty" });
    expect(planBlockLink("", 0, zeros)).toEqual({ kind: "refused", reason: "empty" });
  });

  it("refuses a table inside a list, whose own line would need the list's indent", () => {
    const text = "- item\n\n  | A |\n  | - |\n";
    expect(planBlockLink(text, offsetOf(text, "| A"), zeros)).toEqual({ kind: "refused", reason: "unsupported" });
  });

  it("keeps the note's line ends", () => {
    const text = "| A |\r\n| - |\r\n# H\r\n";
    expect(apply(text, planBlockLink(text, 0, zeros))).toBe("| A |\r\n| - |\r\n\r\n^aaaaaa\r\n\r\n# H\r\n");
  });

  it("never gives a new block an id the note already has elsewhere", () => {
    const text = "one ^aaaaaa\n\ntwo";
    const plan = planBlockLink(text, offsetOf(text, "two"), sequence(0, 0, 0, 0, 0, 0, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1));
    expect(plan.kind === "block" && plan.id).toBe("dddddd");
  });

  it("clamps an offset outside the text", () => {
    expect(planBlockLink("text", 99, zeros)).toMatchObject({ kind: "block", insert: { at: 4 } });
    expect(planBlockLink("text", -5, zeros)).toMatchObject({ kind: "block" });
  });
});
