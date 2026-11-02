import { describe, expect, it } from "vitest";
import { extractFrontmatter } from "../src/metadata-extractor.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { deleteFrontmatterPath, frontmatterKeys, propertiesBlockRefused, readFrontmatterPath, renameFrontmatterTag, setFrontmatterPath } from "../src/frontmatter-surgical.js";
import { updateFrontmatterString } from "../src/frontmatter-string-updater.js";
import { projectPublishedMarkdown } from "../src/workspace/publishedSlices.js";

/**
 * The properties' small forms of the bug-clearing plan (package P13b): the
 * reader and the writers answer one block alike, and a write changes the
 * entry it is asked to change and nothing else — also where the block holds
 * an alias, a list of maps or a number among its keys.
 */
const read = (text: string) => extractFrontmatter(parseMarkdownAst(text));

describe("the reader asks the writers' rule (open-items plan 3.144 no. 1, E15)", () => {
  it("refuses a block of prose, a number, a set, an ordered map and a list — as every write does", () => {
    for (const block of ["just prose", "42", "!!set\n? secret", "!!omap\n- a: 1", "- a\n- b", "null"]) {
      const note = `---\n${block}\n---\nbody`;
      expect(read(note).success, block).toBe(false);
      expect(propertiesBlockRefused(note), block).toBe(true);
    }
  });

  it("reads a block without entries as one without properties", () => {
    for (const block of ["", "# only a comment", "\n\n"]) {
      const result = read(`---\n${block}\n---\nbody`);
      expect(result.success, JSON.stringify(block)).toBe(true);
      if (result.success) expect(result.data, JSON.stringify(block)).toEqual({});
    }
  });

  it("refuses to write into a !!set block (3.128 no. 4) — the sanitizer refuses it as well", () => {
    expect(() => setFrontmatterPath("---\n!!set\n? secret\n---\nbody", ["a"], 1)).toThrow(/not a YAML map/);
    expect(() => projectPublishedMarkdown({ markdown: "---\n!!set\n? secret\n---\nbody\n", includedPaths: [] })).toThrow();
  });
});

describe("a block with an alias (3.144 no. 7 and no. 9)", () => {
  it("writes another entry beside a value that leads back to itself", () => {
    const note = "---\na: &x [*x]\nb: 1\n---\n";
    expect(setFrontmatterPath(note, ["b"], 2)).toBe("---\na: &x [*x]\nb: 2\n---\n");
    // The panel hands back what the reader read for `a`.
    expect(updateFrontmatterString(note, { a: "[*x]", b: 2 })).toBe("---\na: &x [*x]\nb: 2\n---\n");
  });

  it("finds a key that is an alias under the name it stands for: delete, change and read", () => {
    const note = "---\nx: &k owner\n*k : Anna\n---\n";
    expect(updateFrontmatterString(note, { x: "owner" })).toBe("---\nx: &k owner\n---\n");
    expect(updateFrontmatterString(note, { x: "owner", owner: "Bob" })).toBe("---\nx: &k owner\n*k : Bob\n---\n");
    expect(deleteFrontmatterPath(note, ["owner"])).toBe("---\nx: &k owner\n---\n");
    expect(frontmatterKeys(note)).toEqual(["x", "owner"]);
    expect(readFrontmatterPath(note, ["owner"])).toBe("Anna");
  });
});

describe("the two readers find a key by the name the index gives it (3.72 no. 3)", () => {
  it("lists and reads a number key", () => {
    const note = "---\n2024: goals\nb: {c: 3}\nplainva:\n  tasks: false\n---\n";
    expect(frontmatterKeys(note)).toEqual(["2024", "b", "plainva"]);
    expect(readFrontmatterPath(note, ["2024"])).toBe("goals");
    expect(readFrontmatterPath(note, ["b"])).toEqual({ c: 3 });
    expect(readFrontmatterPath(note, ["plainva", "tasks"])).toBe(false);
    expect(readFrontmatterPath(note, ["missing"])).toBeUndefined();
  });
});

describe("`tag:` in the singular is no tag (3.144 no. 4)", () => {
  it("is left alone by a rename of a tag, as the index never lists it under the tag", () => {
    expect(renameFrontmatterTag("---\ntag: a\ntags: [a]\n---\n", "a", "c")).toEqual({ content: "---\ntag: a\ntags: [c]\n---\n", changed: true });
    expect(renameFrontmatterTag("---\ntag: a\n---\n", "a", "c").changed).toBe(false);
  });
});

describe("a rename handed over as a set changes only the name (3.144 no. 8)", () => {
  it("keeps the value as it is written", () => {
    expect(updateFrontmatterString("---\ntags: a, b\ntitle: 2024\n---\n", { labels: ["a", "b"], title: "2024" })).toBe("---\nlabels: a, b\ntitle: 2024\n---\n");
  });
});

describe("small forms (3.72 no. 8 and no. 9)", () => {
  it("changes a field of a map in a list where it stands — the other field and its comment stay", () => {
    const note = "---\nsources:\n  - uid: 007   # keep\n    name: x\n  - uid: 2\n---\n";
    expect(setFrontmatterPath(note, ["sources"], [{ uid: 7, name: "y" }, { uid: 2 }])).toBe("---\nsources:\n  - uid: 007   # keep\n    name: y\n  - uid: 2\n---\n");
    expect(setFrontmatterPath("---\nsources:\n  - uid: 007   # keep\n---\n", ["sources"], [{ uid: 7, name: "z" }])).toBe("---\nsources:\n  - uid: 007   # keep\n    name: z\n---\n");
    expect(setFrontmatterPath("---\nsources:\n  - uid: 007   # keep\n    name: x\n---\n", ["sources"], [{ name: "x" }])).toBe("---\nsources:\n  - name: x\n---\n");
  });

  it("keeps the characters of a number key between braces", () => {
    expect(setFrontmatterPath("---\nm: {2024: 007, b: 1}\n---\n", ["m"], { "2024": 8, b: 1 })).toBe("---\nm: {2024: 8, b: 1}\n---\n");
  });

  it("takes an indented comment behind a list along with the list", () => {
    expect(deleteFrontmatterPath("---\ntags:\n  - a\n  # note\nnext: 1\n---\n", ["tags"])).toBe("---\nnext: 1\n---\n");
    // One that stands as far in as the next key is the next entry's.
    expect(deleteFrontmatterPath("---\ntags:\n  - a\n# about next\nnext: 1\n---\n", ["tags"])).toBe("---\n# about next\nnext: 1\n---\n");
  });

  it("writes an item with a tag of its own anew, alone, when it takes another kind", () => {
    expect(setFrontmatterPath("---\nl:\n  - !!str 5\n  - 0x1F\n---\n", ["l"], [6, 31])).toBe("---\nl:\n  - 6\n  - 0x1F\n---\n");
  });
});

describe("the published copy keeps the note's characters (3.72 no. 2)", () => {
  it("goes out with the values as written, without the withheld entries and without any comment", () => {
    const out = projectPublishedMarkdown({
      markdown: "---\ntitle: T # secret\nplz: 01067\nsecret: x\n# a whole comment\ntags: [a, b] # c\nid: 12345678901234567890\n---\nbody\n",
      includedPaths: [],
      propertyAllowlist: ["title", "plz", "tags", "id"],
    });
    expect(out.markdown).toBe("---\ntitle: T\nplz: 01067\ntags: [a, b]\nid: 12345678901234567890\n---\nbody\n");
    expect(out.report.removedProperties).toContain("secret");
  });

  it("keeps a `#` that stands in a text", () => {
    const out = projectPublishedMarkdown({ markdown: "---\ntitle: \"a # b\"\nsecret: x\n---\nbody\n", includedPaths: [], propertyAllowlist: ["title"] });
    expect(out.markdown).toBe("---\ntitle: \"a # b\"\n---\nbody\n");
  });
});

describe("review follow-ups", () => {
  it("readFrontmatterPath still steps into a list by the place of an item", () => {
    const note = "---\nplainva:\n  blocks:\n    - uid: ev-1\n    - uid: ev-2\n---\n";
    expect(readFrontmatterPath(note, ["plainva", "blocks", "1", "uid"])).toBe("ev-2");
    expect(readFrontmatterPath(note, ["plainva", "blocks", "2", "uid"])).toBeUndefined();
    expect(readFrontmatterPath(note, ["plainva", "blocks", "x"])).toBeUndefined();
  });

  it("publishes a value that leads back to itself as it is written, never as a mark", () => {
    const out = projectPublishedMarkdown({ markdown: "---\na: &x [*x]\nsecret: 1\n---\nbody\n", includedPaths: [], propertyAllowlist: ["a"] });
    expect(out.markdown).toBe("---\na: &x [*x]\n---\nbody\n");
  });

  it("writes a one-entry map of a list anew when it keeps none of its keys", () => {
    expect(setFrontmatterPath("---\nl:\n  - uid: 1\n---\n", ["l"], [{ id: 2 }])).toBe("---\nl:\n  - id: 2\n---\n");
  });
});
