import { describe, it, expect } from "vitest";
import { updateFrontmatterString } from "../src/frontmatter-string-updater.js";
import { FrontmatterSurgicalError } from "../src/frontmatter-surgical.js";

describe("updateFrontmatterString", () => {
  it("should preserve golden corpus exact markdown body including obsidian specific syntax", () => {
    const originalCorpus = `---
title: "Golden Corpus"
tags: 
  - mytag
  - othertag
# This is a comment
some_prop: 123
---

# Heading 1

This is a test of the Golden Corpus.
We have an embedded image ![[image.png]]
And a wiki link [[Another Note]]

> [!NOTE]
> This is a callout block.

* List item 1
* List item 2

1) Ordered 1
2) Ordered 2

_emphasis_ and **bold** and \`inline code\`.

---
This is a horizontal rule.
`;

    const newProps = {
      title: "Updated Title",
      tags: ["mytag", "othertag", "newtag"],
      some_prop: 456,
      new_prop: true
    };

    const result = updateFrontmatterString(originalCorpus, newProps);

    // Verify the body is completely byte-for-byte untouched
    const expectedBody = `
# Heading 1

This is a test of the Golden Corpus.
We have an embedded image ![[image.png]]
And a wiki link [[Another Note]]

> [!NOTE]
> This is a callout block.

* List item 1
* List item 2

1) Ordered 1
2) Ordered 2

_emphasis_ and **bold** and \`inline code\`.

---
This is a horizontal rule.
`;
    expect(result.includes(expectedBody)).toBe(true);

    // Verify the YAML part preserves comments (yaml stringifier might reformat a little bit but we specifically use yaml.parseDocument)
    // Actually the new `updateFrontmatterString` should parse the document and set values directly.
    expect(result.includes("# This is a comment")).toBe(true);
    expect(result.includes("title: \"Updated Title\"")).toBe(true);
    expect(result.includes("new_prop: true")).toBe(true);
    
    // Check that tags are preserved as array
    expect(result.includes("- newtag")).toBe(true);
  });

  it("should create frontmatter if it does not exist", () => {
    const original = `# Just a note\n[[link]]`;
    const result = updateFrontmatterString(original, { title: "Test" });
    
    expect(result.startsWith("---\ntitle: Test\n---\n")).toBe(true);
    expect(result.endsWith("# Just a note\n[[link]]")).toBe(true);
  });

  it("should correctly update empty frontmatter", () => {
    // Exactly: `includes` and `endsWith` held for the second block on top of
    // the two old fences as well (finding 2026-10-07).
    expect(updateFrontmatterString(`---\n---\nBody`, { title: "Test" })).toBe("---\ntitle: Test\n---\nBody");
    expect(updateFrontmatterString(`---\r\n---\r\nBody`, { title: "Test" })).toBe("---\r\ntitle: Test\r\n---\r\nBody");
    expect(updateFrontmatterString(`---\n\n---\nBody`, { title: "Test" })).toBe("---\ntitle: Test\n---\nBody");
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("all properties removed, then one added: exactly one block (%s)", (_name, eol) => {
    // The way the properties panel goes: the last property is removed, then a
    // new one is added.
    const note = ["---", "stage: open", "tags:", "  - a", "---", "# Single", ""].join(eol);
    const emptied = updateFrontmatterString(note, {});
    expect(emptied).toBe(["# Single", ""].join(eol));

    const again = updateFrontmatterString(emptied, { owner: "Anna" });
    expect(again).toBe(["---", "owner: Anna", "---", "# Single", ""].join(eol));
    expect(again.split(eol).filter((line) => line === "---")).toHaveLength(2);
  });

  it("does not take the text behind an empty block for YAML up to the next rule", () => {
    const body = "\ntext\n\n---\n\nmore\n";
    const written = updateFrontmatterString(`---\n---\n${body}`, { owner: "Anna" });
    expect(written).toBe(`---\nowner: Anna\n---\n${body}`);
    expect(updateFrontmatterString(written, {})).toBe(body);
  });

  it("makes no block for no property, and leaves an empty one a note carries alone", () => {
    // Clearing an already empty cell of a note without properties used to put
    // `---` on `---` in front of the note.
    expect(updateFrontmatterString("# Just a note\n", {})).toBe("# Just a note\n");
    expect(updateFrontmatterString("---\n---\n# Just a note\n", {})).toBe("---\n---\n# Just a note\n");
  });

  it("keeps the empty fences where the text itself opens with a `---` line", () => {
    expect(updateFrontmatterString("---\nstage: open\n---\n---\nIntro\n---\n", {})).toBe("---\n---\n---\nIntro\n---\n");
  });

  it("refuses a block that is not a map instead of rewriting the text in it", () => {
    // Two rules with text between them at the top of a note read as a block
    // whose YAML is that text. It used to come back re-serialised - lines
    // folded into one - and without the property that was to be written.
    const note = "---\nSome intro text\nover two lines\n---\nBody\n";
    expect(() => updateFrontmatterString(note, { owner: "Anna" })).toThrow(FrontmatterSurgicalError);
    expect(() => updateFrontmatterString("---\n- a\n- list\n---\nBody\n", { owner: "Anna" })).toThrow(FrontmatterSurgicalError);
    expect(() => updateFrontmatterString("---\ntitle: [unclosed\n---\nBody\n", { owner: "Anna" })).toThrow(FrontmatterSurgicalError);
  });

  it("should correctly handle deleting a property", () => {
    const original = `---\ntitle: test\ndelete_me: yes\n---\nBody`;
    // We pass undefined or we omit the key in newProps. Wait, if we pass the whole new properties object,
    // the updater should probably sync the keys. Wait, the PropertiesPanel does:
    // const newProps = { ...properties }; delete newProps[key]; handleUpdate(newProps);
    // So newProps doesn't have the deleted key.
    // That means `updateFrontmatterString` must remove keys that are in the YAML but not in `newProps`.
    const result = updateFrontmatterString(original, { title: "test" });
    expect(result.includes("delete_me")).toBe(false);
  });

  it("should preserve CRLF line endings if the original file used them", () => {
    const original = `---\r\ntitle: test\r\n---\r\n\r\nBody`;
    const result = updateFrontmatterString(original, { title: "updated" });
    
    // Line endings should be CRLF
    expect(result).toBe(`---\r\ntitle: updated\r\n---\r\n\r\nBody`);
  });
});
