import { describe, expect, it } from "vitest";
import { contextCard } from "./context/cards.js";
import { outlineOf } from "./context/sections.js";
import { answerStatements } from "./coverage.js";
import { chunkNote } from "./embeddings/chunks.js";
import { addMemoryEntry, parseMemory } from "./memory/memoryFile.js";
import { measureStyle } from "./writingStyle.js";
import { linkedNoteTargets } from "./writes/links.js";

/**
 * Every scanner of the assistant that has to know whether a line is code
 * reads it by the one fence rule of the task scanners (`markdownFence.ts`,
 * brought in with the merge of main of 27 Oct 2026): a fence closes only on a
 * run of its character at least as long as the one that opened it, "```x```"
 * at the start of a line is a code span and opens none, and a fence inside a
 * quote or a callout is code and ends with the quote. Each of them carried a
 * pattern of its own, and most of those closed a fence on any run of three —
 * after which the rest of a note could read as code.
 */

// "```" does not close "````": the lines up to the second "````" are code.
const LONG = (inside: string, after: string) => ["````", "```", inside, "````", after].join("\n");
// A fence shown inside a code block, indented four: that block's text, which its own run ends.
const NESTED = (after: string) => ["```markdown", "1. Install:", "", "    ```bash", "    npm i", "    ```", "```", "", after].join("\n");
const NBSP = String.fromCharCode(0xa0);

describe("the one fence rule", () => {
  it("a context card keeps the code whole, a # line in it included", () => {
    expect(contextCard(LONG("One. Two.", ""), "").lines).toContain("One. Two.");
    // And it closes: the words behind it are text again, which a card keeps only as its first sentence.
    expect(contextCard(LONG("One. Two.", "Plain words here."), "").lines).not.toContain("Plain words here.");
    expect(contextCard(["Intro sentence here.", "```sh", "# install the tools", "npm i", "```"].join("\n"), "").lines).toContain("# install the tools");
  });

  it("the outline has no heading from inside a fence", () => {
    expect(outlineOf(LONG("# Not a heading", "# Real")).map((heading) => heading.text)).toEqual(["Real"]);
    expect(outlineOf(NESTED("## Real heading")).map((heading) => heading.text)).toEqual(["Real heading"]);
  });

  it("an answer's statements leave out what stands in code", () => {
    expect(answerStatements(LONG("This line stands inside the code block.", "This is the statement the answer makes."))).toEqual(["This is the statement the answer makes."]);
  });

  it("a note's chunks open no section at a heading in code", () => {
    const chains = chunkNote("Note", LONG("# Not a section", "# Section\n\nThe body of the section.")).map((chunk) => chunk.chain);
    expect(chains).toContain("Section");
    expect(chains.some((chain) => chain.includes("Not a section"))).toBe(false);
  });

  it("the memory has no entry from inside a fence", () => {
    expect(parseMemory(`# Memory\n${LONG("- in code", "- One.")}`, "long").entries.map((entry) => entry.text)).toEqual(["One."]);
  });

  it("the writing style counts no word of code, and a fence inside a comment opens nothing", () => {
    expect(measureStyle([LONG("one two three four five", "six seven")]).words).toBe(2);
    expect(measureStyle([["<!--", "```", "-->", "Alpha beta gamma delta."].join("\n")]).words).toBe(4);
  });

  it("the links of a text leave out a link in a callout's code", () => {
    expect(linkedNoteTargets(["> [!example]", "> ```", "> [[Example]]", "> ```", "", "[[Real]]"].join("\n"))).toEqual(["Real"]);
    expect(linkedNoteTargets(NESTED("[[After]]"))).toEqual(["After"]);
  });

  it("the links of a text are checked behind a run that only might open a fence: a check reads less as code, never more", () => {
    // Indented four, it is an indented code block's line; a no-break space is no indentation; a quote marker behind
    // four spaces is code text. The renderer shows the link after each.
    expect(linkedNoteTargets(["    ```", "[[Shown]]"].join("\n"))).toEqual(["Shown"]);
    expect(linkedNoteTargets([`${NBSP}\`\`\``, "[[Shown]]"].join("\n"))).toEqual(["Shown"]);
    expect(linkedNoteTargets(["    > ```", "> [[Shown]]"].join("\n"))).toEqual(["Shown"]);
    // A fence in a quote ends with the quote; a run behind it that only might open one opens none.
    expect(linkedNoteTargets(["> ```", "> x", "    ```", "[[Shown]]"].join("\n"))).toEqual(["Shown"]);
    // A fence where CommonMark is sure still hides what is in it.
    expect(linkedNoteTargets(["   ```", "[[Code]]", "```", "[[Shown]]"].join("\n"))).toEqual(["Shown"]);
  });

  it("the memory keeps a new entry where it is read: behind a properties block that never closes, which is none", () => {
    const first = addMemoryEntry("---\ntitle: x\n", "long", "One.", {});
    if (!first.ok) throw new Error(first.problem);
    expect(parseMemory(first.text, "long").entries.map((entry) => entry.text)).toEqual(["One."]);
    // The next one is told it is there, and stands behind it: no copy nobody reads.
    expect(addMemoryEntry(first.text, "long", "One.", {})).toEqual({ ok: false, problem: "duplicate" });
  });

  it("the memory keeps a new entry where it is read: what an entry's own lines hold is not a fence for it", () => {
    const file = "# Memory\n\n- <!--\n  ```\n  -->\n";
    const added = addMemoryEntry(file, "long", "One.", {});
    if (!added.ok) throw new Error(added.problem);
    expect(added.text.startsWith("# Memory\n\n- <!--\n  ```\n  -->\n")).toBe(true);
    expect(parseMemory(added.text, "long").entries.map((entry) => entry.text)).toEqual(["One."]);
  });

  it("the memory keeps a new entry where it is read: before the callout a fence that never closes stands in", () => {
    // Without a line break at its end the file ends inside the callout's fence.
    const added = addMemoryEntry("# Memory\n\n> [!note]\n> ```\n> code", "long", "One.", {});
    if (!added.ok) throw new Error(added.problem);
    expect(parseMemory(added.text, "long").entries.map((entry) => entry.text)).toEqual(["One."]);
    const lines = added.text.split("\n");
    expect(lines.slice(lines.findIndex((line) => line.startsWith("- One.")) + 2)).toEqual(["> [!note]", "> ```", "> code"]);
  });

  it("the memory keeps a new entry where it is read: a byte order mark stays at the very front", () => {
    const mark = String.fromCharCode(0xfeff);
    const added = addMemoryEntry(`${mark}\`\`\`\`\n\`\`\`\n`, "long", "One.", {});
    if (!added.ok) throw new Error(added.problem);
    expect([added.text.charCodeAt(0), added.text.indexOf(mark, 1)]).toEqual([0xfeff, -1]);
    expect(parseMemory(added.text, "long").entries.map((entry) => entry.text)).toEqual(["One."]);
  });

  it("the memory keeps a new entry where it is read: before a fence that never closes, not inside it", () => {
    const added = addMemoryEntry("# Memory\n\n````\n```\nsome code\n", "long", "One.", {});
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(parseMemory(added.text, "long").entries.map((entry) => entry.text)).toEqual(["One."]);
    // Nothing else of the file changed: without the entry and the blank line behind it, it is what it was.
    const lines = added.text.split("\n");
    lines.splice(lines.findIndex((line) => line.startsWith("- One.")), 2);
    expect(lines.join("\n")).toBe("# Memory\n\n````\n```\nsome code\n");
  });
});
