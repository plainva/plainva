import { describe, it, expect } from "vitest";
import { updateFrontmatterString } from "../src/frontmatter-string-updater.js";

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
    const original = `---\n---\nBody`;
    const result = updateFrontmatterString(original, { title: "Test" });
    expect(result.includes("title: Test")).toBe(true);
    expect(result.endsWith("\nBody")).toBe(true);
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
