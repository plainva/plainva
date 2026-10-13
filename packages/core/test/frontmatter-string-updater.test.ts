import { describe, it, expect } from "vitest";
import { updateFrontmatterString } from "../src/frontmatter-string-updater.js";
import { FrontmatterSurgicalError } from "../src/frontmatter-surgical.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { extractFrontmatter } from "../src/metadata-extractor.js";

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
    // A line the block holds — also a blank one — stays where it is (since 2026-10-13).
    expect(updateFrontmatterString(`---\n\n---\nBody`, { title: "Test" })).toBe("---\n\ntitle: Test\n---\nBody");
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

  /**
   * The set is written as its DIFFERENCE to what the note says (finding
   * 2026-10-11). The properties panel and a database cell read a note's
   * properties, change one and hand all of them back; every key of the set
   * was then written anew, from the value as it had been read — and the whole
   * block with it, in the YAML library's form.
   */
  describe("writes the difference, entry by entry", () => {
    const NOTE = [
      "---",
      "tags: a, b",
      "aliases: [x, y] # the other names",
      "2024: goals",
      "plz: 01067",
      "okf_version: 1",
      "# about the status",
      "status: open # for now",
      "---",
      "Text",
      "",
    ].join("\n");
    /** The set the panel and a cell start from. */
    const read = (): Record<string, unknown> => {
      const result = extractFrontmatter(parseMarkdownAst(NOTE));
      if (!result.success || !result.data) throw new Error("the reader refused the note");
      return { ...(result.data as Record<string, unknown>) };
    };

    it("the reader reads a text as a list and a number as a text — handed back, neither is a change", () => {
      expect(read()).toEqual({ tags: ["a", "b"], aliases: ["x", "y"], "2024": "goals", plz: 1067, okf_version: "1", status: "open" });
      expect(updateFrontmatterString(NOTE, read())).toBe(NOTE);
    });

    it("one value changed: its characters, and no other entry moves", () => {
      // `tags: a, b` came back as a list, the bracket list as a block list without its comment,
      // `plz: 01067` as `1067`, and beside `2024: goals` stood a second entry `"2024": goals`.
      expect(updateFrontmatterString(NOTE, { ...read(), status: "done" })).toBe(NOTE.replace("status: open # for now", "status: done # for now"));
      expect(updateFrontmatterString(NOTE, { ...read(), "2024": "plans" })).toBe(NOTE.replace("2024: goals", "2024: plans"));
      expect(updateFrontmatterString(NOTE, { ...read(), aliases: ["x", "y", "z"] })).toBe(NOTE.replace("[x, y]", "[x, y, z]"));
    });

    it("a key the set no longer names loses its lines, and the comment above it stays", () => {
      const set = read();
      delete set.status;
      expect(updateFrontmatterString(NOTE, set)).toBe(NOTE.replace("status: open # for now\n", ""));
      const without2024 = read();
      delete without2024["2024"];
      expect(updateFrontmatterString(NOTE, without2024)).toBe(NOTE.replace("2024: goals\n", ""));
    });

    it("a key that is new gets a line behind the last entry", () => {
      expect(updateFrontmatterString(NOTE, { ...read(), owner: "Anna" })).toBe(NOTE.replace("status: open # for now\n", "status: open # for now\nowner: Anna\n"));
    });

    it("one key gone and one new with the same value: the entry is renamed where it stands", () => {
      // The panel's rename. It used to remove the entry and put a new one at the end of the block.
      const renamed = Object.fromEntries(Object.entries(read()).map(([key, value]) => [key === "plz" ? "postcode" : key, value]));
      expect(updateFrontmatterString(NOTE, renamed)).toBe(NOTE.replace("plz: 01067", "postcode: 01067"));
      const status = Object.fromEntries(Object.entries(read()).map(([key, value]) => [key === "status" ? "state" : key, value]));
      expect(updateFrontmatterString(NOTE, status)).toBe(NOTE.replace("status: open # for now", "state: open # for now"));
      // A text the reader read as a list only because it stood under `tags`: under
      // another name the note has to say the list itself — where the entry stands.
      const list = Object.fromEntries(Object.entries(read()).map(([key, value]) => [key === "tags" ? "labels" : key, value]));
      expect(updateFrontmatterString(NOTE, list)).toBe(NOTE.replace("tags: a, b", "labels:\n  - a\n  - b"));
      // Another value under the new name is no rename: the old entry goes, the new one is new.
      const other = read();
      delete other.plz;
      expect(updateFrontmatterString(NOTE, { ...other, postcode: "D-01067" })).toBe(NOTE.replace("plz: 01067\n", "").replace("status: open # for now\n", "status: open # for now\npostcode: D-01067\n"));
    });

    it("a text the reader read as a list becomes one once the list changes", () => {
      expect(updateFrontmatterString(NOTE, { ...read(), tags: ["a", "b", "c"] })).toBe(NOTE.replace("tags: a, b", "tags:\n  - a\n  - b\n  - c"));
    });

    it("the same set gives the same note, however often it is asked", () => {
      // The chain calls a change more than once (ADR 0031): for the note, for a version of it, and to count.
      const set = { ...read(), status: "done", owner: "Anna" };
      const once = updateFrontmatterString(NOTE, set);
      expect(updateFrontmatterString(NOTE, set)).toBe(once);
      expect(updateFrontmatterString(once, set)).toBe(once);
    });
  });

  /**
   * A note whose lines end in a carriage return of its own (a file from a
   * classic Mac). Its block was a block for the Markdown parser and none for
   * this writer, which put a second one on top (2026-10-11).
   */
  describe("in a note whose lines end in a carriage return of its own", () => {
    const TEXT = "# Just a note\r[[link]]\r";

    it("changes the entries of the block that is there and leaves every other line its line end", () => {
      // Until 2026-10-12 the whole block came back with `\n`. A line that is new still ends in `\n`.
      expect(updateFrontmatterString(`---\rtitle: test\rdelete_me: yes\r---\r${TEXT}`, { title: "updated" })).toBe(`---\rtitle: updated\r---\r${TEXT}`);
      expect(updateFrontmatterString(`---\r---\r${TEXT}`, { title: "Test" })).toBe(`---\rtitle: Test\n---\r${TEXT}`);
      expect(updateFrontmatterString(TEXT, { title: "Test" })).toBe(`---\ntitle: Test\n---\n${TEXT}`);
    });

    it("removes the block with its last property, and makes none for none", () => {
      expect(updateFrontmatterString(`---\rtitle: test\r---\r${TEXT}`, {})).toBe(TEXT);
      expect(updateFrontmatterString(TEXT, {})).toBe(TEXT);
      expect(updateFrontmatterString(`---\r---\r${TEXT}`, {})).toBe(`---\r---\r${TEXT}`);
      expect(updateFrontmatterString("---\rstage: open\r---\r---\rIntro\r---\r", {})).toBe("---\n---\n---\rIntro\r---\r");
    });

    it("is handed the properties the index read, so it removes none of them", () => {
      // The properties panel and a database cell read a note through the
      // Markdown parser and write what they read, with their change, back as
      // the whole block: a key that is not handed over is deleted. The parser
      // found this block all along; the YAML library read its lines as one,
      // so the panel had nothing to show and nothing to start a write from.
      // Reader and writer read the same lines now.
      const note = `---\rtitle: Old Mac\rtags:\r  - a\r  - b\rdue: 2026-10-11\r---\r${TEXT}`;
      const read = extractFrontmatter(parseMarkdownAst(note));
      expect(read).toEqual({ success: true, data: { title: "Old Mac", tags: ["a", "b"], due: "2026-10-11" } });
      if (!read.success || !read.data) return;

      const written = updateFrontmatterString(note, { ...read.data, owner: "Anna" });
      expect(written).toBe(`---\rtitle: Old Mac\rtags:\r  - a\r  - b\rdue: 2026-10-11\rowner: Anna\n---\r${TEXT}`);
      // And the index reads the written block the same way.
      expect(extractFrontmatter(parseMarkdownAst(written))).toEqual({ success: true, data: { ...read.data, owner: "Anna" } });
    });

    it("refuses a block that is no map there as anywhere else", () => {
      expect(() => updateFrontmatterString("---\rSome intro text\rover two lines\r---\rBody\r", { owner: "Anna" })).toThrow(FrontmatterSurgicalError);
      expect(() => updateFrontmatterString("---\rtitle: [unclosed\r---\rBody\r", { owner: "Anna" })).toThrow(FrontmatterSurgicalError);
    });
  });
});
