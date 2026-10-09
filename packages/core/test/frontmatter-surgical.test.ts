import { describe, it, expect } from "vitest";
import {
  upsertFrontmatterKeys,
  setFrontmatterPath,
  deleteFrontmatterPath,
  renameFrontmatterKey,
  renameFrontmatterTag,
  renameFrontmatterWikiLinks,
  ensureOkfFrontmatter,
  frontmatterKeys,
  readFrontmatterPath,
  FrontmatterSurgicalError
} from "../src/frontmatter-surgical.js";
import { getPlainvaMeta } from "../src/metadata.js";
import { parse as parseYaml } from "yaml";

const DOC_WITH_COMMENTS = `---
title: "Golden Note"
# taxonomy block
tags:
  - alpha
  - beta
custom: 123
---

# Heading

Body with [[Wikilink]] stays byte-identical.
`;

function frontmatterOf(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("no frontmatter");
  return parseYaml(match[1]) as Record<string, unknown>;
}

function bodyOf(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("no frontmatter");
  return content.slice(match[0].length);
}

describe("upsertFrontmatterKeys", () => {
  it("touches only the given keys and preserves comments, order and body", () => {
    const result = upsertFrontmatterKeys(DOC_WITH_COMMENTS, { type: "Note" });

    expect(result).toContain("# taxonomy block");
    expect(bodyOf(result)).toBe(bodyOf(DOC_WITH_COMMENTS));
    const fm = frontmatterOf(result);
    expect(fm.type).toBe("Note");
    expect(fm.title).toBe("Golden Note");
    expect(fm.custom).toBe(123);
    // Original quoting of untouched scalars stays intact.
    expect(result).toContain('title: "Golden Note"');
    // Untouched keys keep their original order (title first).
    expect(result.indexOf("title:")).toBeLessThan(result.indexOf("tags:"));
  });

  it("creates a frontmatter block when none exists", () => {
    const result = upsertFrontmatterKeys("# Just a heading\n", { type: "Note" });
    expect(result.startsWith("---\n")).toBe(true);
    expect(frontmatterOf(result).type).toBe("Note");
    expect(result.endsWith("# Just a heading\n")).toBe(true);
  });

  it("preserves CRLF line endings", () => {
    const crlf = "---\r\ntitle: X\r\n---\r\nBody\r\n";
    const result = upsertFrontmatterKeys(crlf, { type: "Note" });
    expect(result).toContain("type: Note\r\n");
    expect(result.endsWith("Body\r\n")).toBe(true);
    expect(result.includes("\n---\n")).toBe(false);
  });

  it("quotes version-like strings so they survive as strings", () => {
    const result = upsertFrontmatterKeys("Body\n", { okf_version: "0.1" });
    expect(frontmatterOf(result).okf_version).toBe("0.1");
    expect(typeof frontmatterOf(result).okf_version).toBe("string");
  });

  it("throws on unparseable frontmatter", () => {
    const broken = "---\ntitle: [unclosed\n---\nBody\n";
    expect(() => upsertFrontmatterKeys(broken, { type: "Note" })).toThrow(
      FrontmatterSurgicalError
    );
  });

  it("throws on non-map frontmatter", () => {
    const listFm = "---\n- just\n- a list\n---\nBody\n";
    expect(() => upsertFrontmatterKeys(listFm, { type: "Note" })).toThrow(
      FrontmatterSurgicalError
    );
  });
});

describe("setFrontmatterPath / deleteFrontmatterPath", () => {
  it("creates the plainva namespace and keeps siblings on second write", () => {
    const withIcon = setFrontmatterPath(DOC_WITH_COMMENTS, ["plainva", "icon"], "🚀");
    const withBoth = setFrontmatterPath(withIcon, ["plainva", "header_color"], "#2f6f6f");

    const meta = getPlainvaMeta(frontmatterOf(withBoth));
    expect(meta.icon).toBe("🚀");
    expect(meta.headerColor).toBe("#2f6f6f");
    expect(withBoth).toContain("# taxonomy block");
    expect(bodyOf(withBoth)).toBe(bodyOf(DOC_WITH_COMMENTS));
  });

  it("removes an emptied namespace map entirely", () => {
    const withIcon = setFrontmatterPath(DOC_WITH_COMMENTS, ["plainva", "icon"], "🚀");
    const removed = deleteFrontmatterPath(withIcon, ["plainva", "icon"]);
    expect(frontmatterOf(removed).plainva).toBeUndefined();
    expect(removed).not.toContain("plainva");
    expect(bodyOf(removed)).toBe(bodyOf(DOC_WITH_COMMENTS));
  });

  it("keeps the namespace when siblings remain", () => {
    let content = setFrontmatterPath(DOC_WITH_COMMENTS, ["plainva", "icon"], "🚀");
    content = setFrontmatterPath(content, ["plainva", "header_color"], "#aabbcc");
    const removed = deleteFrontmatterPath(content, ["plainva", "icon"]);
    const meta = getPlainvaMeta(frontmatterOf(removed));
    expect(meta.icon).toBeUndefined();
    expect(meta.headerColor).toBe("#aabbcc");
  });

  it("is a no-op when the path does not exist", () => {
    expect(deleteFrontmatterPath(DOC_WITH_COMMENTS, ["plainva", "icon"])).toBe(
      DOC_WITH_COMMENTS
    );
    expect(deleteFrontmatterPath("no frontmatter\n", ["plainva"])).toBe("no frontmatter\n");
  });

  it("removes the block with its last key: the text is the note", () => {
    const single = "---\nonly: value\n---\nBody\n";
    const removed = deleteFrontmatterPath(single, ["only"]);
    expect(removed).toBe("Body\n");
  });
});

/**
 * `---` directly on `---` (finding 2026-10-07): what the writers left behind
 * when a block lost its last entry, and what no reader took for a block. The
 * next write put a second block on top; the two old fences became rules.
 */
describe("a properties block without entries", () => {
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("delete the only property, then set one: exactly one block (%s)", (_name, eol) => {
    const note = ["---", "stage: open", "---", "# Single", ""].join(eol);
    const emptied = deleteFrontmatterPath(note, ["stage"]);
    expect(emptied).toBe(["# Single", ""].join(eol));

    const again = setFrontmatterPath(emptied, ["owner"], "Anna");
    expect(again).toBe(["---", "owner: Anna", "---", "# Single", ""].join(eol));
    expect(again.split(eol).filter((line) => line === "---")).toHaveLength(2);
  });

  it("set and removed again, a property leaves the note as it was", () => {
    for (const note of ["# Note\n", "\n# Note\n\nText\n", "# Note\r\n\r\nText\r\n", "Text without a line break at the end"]) {
      const withIcon = setFrontmatterPath(note, ["plainva", "icon"], "🚀");
      expect(frontmatterKeys(withIcon)).toEqual(["plainva"]);
      expect(deleteFrontmatterPath(withIcon, ["plainva", "icon"])).toBe(note);
    }
    // A note without any text got a line to write on behind its block; the line stays.
    expect(deleteFrontmatterPath(setFrontmatterPath("", ["plainva", "icon"], "🚀"), ["plainva", "icon"])).toBe("\n");
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("reads a note that already carries the empty block as a note without properties (%s)", (_name, eol) => {
    const note = ["---", "---", "# Single", ""].join(eol);
    expect(frontmatterKeys(note)).toEqual([]);
    expect(readFrontmatterPath(note, ["owner"])).toBeUndefined();
    expect(readFrontmatterPath(note, ["plainva", "icon"])).toBeUndefined();
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("writes into the empty block a note already carries, instead of a second one on top (%s)", (_name, eol) => {
    const note = ["---", "---", "# Single", ""].join(eol);
    const expected = ["---", "owner: Anna", "---", "# Single", ""].join(eol);
    expect(setFrontmatterPath(note, ["owner"], "Anna")).toBe(expected);
    expect(upsertFrontmatterKeys(note, { owner: "Anna" })).toBe(expected);
    expect(ensureOkfFrontmatter(note, { type: "Note" }).content).toBe(["---", "type: Note", "---", "# Single", ""].join(eol));
    // Nothing to do on a block that has nothing: the note stays untouched.
    expect(deleteFrontmatterPath(note, ["owner"])).toBe(note);
    expect(renameFrontmatterKey(note, "owner", "lead")).toBe(note);
    expect(renameFrontmatterTag(note, "old", "new")).toEqual({ content: note, changed: false });
    expect(renameFrontmatterWikiLinks(note, [{ key: "owner", oldTarget: "A", newTarget: "B" }])).toEqual({ content: note, renamed: 0 });
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("does not read the text behind an empty block as YAML up to the next rule (%s)", (_name, eol) => {
    // The lazy pattern ran from the opening fence across the text to the
    // thematic break; `title: ...` in that text came back as a property.
    const body = ["title: not a property", "", "Text.", "", "---", "", "More text.", ""].join(eol);
    const note = ["---", "---", body].join(eol);
    expect(frontmatterKeys(note)).toEqual([]);
    expect(readFrontmatterPath(note, ["title"])).toBeUndefined();

    const written = setFrontmatterPath(note, ["owner"], "Anna");
    expect(written).toBe(["---", "owner: Anna", "---", body].join(eol));
    // And back: the text has not moved a byte, rule included.
    expect(deleteFrontmatterPath(written, ["owner"])).toBe(body);
  });

  it("keeps the empty fences where the text itself opens with a `---` line", () => {
    // Without them the text's rule would open a block at the top of the file
    // and "Intro" would be read as its YAML.
    const note = "---\nonly: value\n---\n---\nIntro\n---\nRest\n";
    const emptied = deleteFrontmatterPath(note, ["only"]);
    expect(emptied).toBe("---\n---\n---\nIntro\n---\nRest\n");
    expect(frontmatterKeys(emptied)).toEqual([]);
    expect(setFrontmatterPath(emptied, ["only"], "value")).toBe(note);
  });

  it("makes no block for no entry, and tidies none away in passing", () => {
    expect(upsertFrontmatterKeys("# Note\n", {})).toBe("# Note\n");
    expect(upsertFrontmatterKeys("", {})).toBe("");
    expect(upsertFrontmatterKeys("---\n---\n# Note\n", {})).toBe("---\n---\n# Note\n");
    expect(upsertFrontmatterKeys("---\r\n\r\n---\r\n# Note\r\n", {})).toBe("---\r\n\r\n---\r\n# Note\r\n");
  });

  it("keeps a byte order mark at the very start of the file", () => {
    // In front of the block it used to hide the block from the writers; in
    // front of the text it ended up behind the new block, in the first line.
    expect(setFrontmatterPath("\uFEFF# Note\n", ["a"], 1)).toBe("\uFEFF---\na: 1\n---\n# Note\n");
    expect(setFrontmatterPath("\uFEFF---\na: 1\n---\n# Note\n", ["b"], 2)).toBe("\uFEFF---\na: 1\nb: 2\n---\n# Note\n");
    expect(deleteFrontmatterPath("\uFEFF---\na: 1\n---\n# Note\n", ["a"])).toBe("\uFEFF# Note\n");
    expect(readFrontmatterPath("\uFEFF---\na: 1\n---\n# Note\n", ["a"])).toBe(1);
  });

  it("edits a block whose fences carry blanks in place", () => {
    // The Markdown parser takes it for a block, so the index shows its
    // properties; the writers must find the same block.
    const note = "--- \na: 1\n---  \n# Note\n";
    expect(frontmatterKeys(note)).toEqual(["a"]);
    expect(setFrontmatterPath(note, ["b"], 2)).toBe("---\na: 1\nb: 2\n---\n# Note\n");
  });
});

describe("renameFrontmatterKey", () => {
  it("renames in place, keeping value, position and body", () => {
    const content = "---\ntitle: X\ntype: Persönliche Kategorie\nrank: 3\n---\nBody\n";
    const renamed = renameFrontmatterKey(content, "type", "type_original");
    const fm = frontmatterOf(renamed);
    expect(fm.type).toBeUndefined();
    expect(fm.type_original).toBe("Persönliche Kategorie");
    // Position preserved: between title and rank.
    expect(renamed.indexOf("title:")).toBeLessThan(renamed.indexOf("type_original:"));
    expect(renamed.indexOf("type_original:")).toBeLessThan(renamed.indexOf("rank:"));
    expect(bodyOf(renamed)).toBe("Body\n");
  });

  it("is a no-op when the source key is absent", () => {
    expect(renameFrontmatterKey(DOC_WITH_COMMENTS, "type", "type_original")).toBe(
      DOC_WITH_COMMENTS
    );
  });

  it("throws when the target key already exists", () => {
    const content = "---\ntype: A\ntype_original: B\n---\n";
    expect(() => renameFrontmatterKey(content, "type", "type_original")).toThrow(
      FrontmatterSurgicalError
    );
  });

  it("renames non-string values (lists) intact", () => {
    const content = "---\ntype:\n  - projekt\n  - privat\n---\nBody\n";
    const renamed = renameFrontmatterKey(content, "type", "type_original");
    expect(frontmatterOf(renamed).type_original).toEqual(["projekt", "privat"]);
  });
});

describe("ensureOkfFrontmatter", () => {
  it("builds a type-only block for empty content", () => {
    const result = ensureOkfFrontmatter("", { type: "Note" });
    expect(result.changed).toBe(true);
    expect(result.setType).toBe(true);
    const fm = frontmatterOf(result.content);
    expect(fm.type).toBe("Note");
    expect(fm.okf_version).toBeUndefined();
  });

  it("keeps an existing non-blank type and changes nothing else", () => {
    const content = "---\ntype: Report\n---\nBody\n";
    const result = ensureOkfFrontmatter(content, { type: "Note" });
    expect(result.setType).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
    expect(frontmatterOf(result.content).type).toBe("Report");
  });

  it("never adds okf_version (OKF v0.2: the bundle declaration lives in the root index.md only)", () => {
    // A note Plainva writes must not carry the bundle version: the spec never
    // placed it on notes, and nothing in Plainva reads the per-note copy.
    const result = ensureOkfFrontmatter("---\ntitle: X\n---\nBody\n", { type: "Note" });
    expect(result.changed).toBe(true);
    expect(result.content).not.toContain("okf_version");
    expect(frontmatterOf(result.content).okf_version).toBeUndefined();
  });

  it("replaces a blank type", () => {
    const content = "---\ntype: '   '\n---\nBody\n";
    const result = ensureOkfFrontmatter(content, { type: "Note" });
    expect(result.setType).toBe(true);
    expect(frontmatterOf(result.content).type).toBe("Note");
  });

  it("does not touch a non-string type (handled by explicit conversion)", () => {
    const content = "---\ntype:\n  - list\n---\nBody\n";
    const result = ensureOkfFrontmatter(content, { type: "Note" });
    expect(result.setType).toBe(false);
    expect(frontmatterOf(result.content).type).toEqual(["list"]);
  });

  it("returns content unchanged (same reference semantics) when nothing to do", () => {
    const content = '---\ntype: Note\nokf_version: "0.1"\n---\nBody\n';
    const result = ensureOkfFrontmatter(content, { type: "Ignored" });
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it("keeps an existing okf_version untouched, whatever it says", () => {
    const content = '---\ntype: Note\nokf_version: "9.9"\n---\nBody\n';
    const result = ensureOkfFrontmatter(content, { type: "Note" });
    expect(result.changed).toBe(false);
    expect(frontmatterOf(result.content).okf_version).toBe("9.9");
  });
});

describe("getPlainvaMeta", () => {
  it("returns empty meta for missing/malformed namespaces", () => {
    expect(getPlainvaMeta(null)).toEqual({});
    expect(getPlainvaMeta({})).toEqual({});
    expect(getPlainvaMeta({ plainva: "not-an-object" })).toEqual({});
    expect(getPlainvaMeta({ plainva: ["list"] })).toEqual({});
  });

  it("ignores invalid colors and blank icons", () => {
    expect(getPlainvaMeta({ plainva: { icon: "  ", header_color: "red" } })).toEqual({});
    expect(getPlainvaMeta({ plainva: { header_color: "#12345" } })).toEqual({});
  });

  it("accepts 3-, 6- and 8-digit hex colors and trims values", () => {
    expect(getPlainvaMeta({ plainva: { header_color: " #abc " } }).headerColor).toBe("#abc");
    expect(getPlainvaMeta({ plainva: { header_color: "#a1b2c3" } }).headerColor).toBe("#a1b2c3");
    expect(getPlainvaMeta({ plainva: { header_color: "#a1b2c3dd" } }).headerColor).toBe(
      "#a1b2c3dd"
    );
    expect(getPlainvaMeta({ plainva: { icon: " 🚀 " } }).icon).toBe("🚀");
  });

  it("reads an icon tint (icon_color) with the same hex validation", () => {
    const meta = getPlainvaMeta({
      plainva: { icon: "lucide:rocket", icon_color: "#c94f4f" },
    });
    expect(meta.icon).toBe("lucide:rocket");
    expect(meta.iconColor).toBe("#c94f4f");
    expect(getPlainvaMeta({ plainva: { icon_color: "red" } }).iconColor).toBeUndefined();
  });
});

describe("renameFrontmatterWikiLinks", () => {
  it("rewrites a scalar whole-value link, keeping quoting style and body bytes", () => {
    const content = '---\n# kommentar\nprojekt: "[[Alt]]"\nstatus: offen\n---\nBody [[Alt]] bleibt.\n';
    const res = renameFrontmatterWikiLinks(content, [
      { key: "projekt", oldTarget: "Alt", newTarget: "Neu" },
    ]);
    expect(res.renamed).toBe(1);
    expect(res.content).toContain('projekt: "[[Neu]]"');
    expect(res.content).toContain("# kommentar");
    expect(res.content).toContain("status: offen");
    // Only the listed key is touched — the body link stays.
    expect(res.content).toContain("Body [[Alt]] bleibt.");
  });

  it("rewrites matching list items and leaves others alone", () => {
    const content = '---\nrefs:\n  - "[[Alt]]"\n  - "[[Bleibt]]"\n  - 42\n---\n';
    const res = renameFrontmatterWikiLinks(content, [
      { key: "refs", oldTarget: "Alt", newTarget: "Neu" },
    ]);
    expect(res.renamed).toBe(1);
    expect(res.content).toContain('- "[[Neu]]"');
    expect(res.content).toContain('- "[[Bleibt]]"');
    expect(res.content).toContain("- 42");
  });

  it("preserves anchors and aliases", () => {
    const content = '---\nrel: "[[Alt#Abschnitt|Anzeige]]"\n---\n';
    const res = renameFrontmatterWikiLinks(content, [
      { key: "rel", oldTarget: "Alt", newTarget: "Pfad/Neu" },
    ]);
    expect(res.renamed).toBe(1);
    expect(res.content).toContain('rel: "[[Pfad/Neu#Abschnitt|Anzeige]]"');
  });

  it("returns the content unchanged when nothing matches (missing key, other target, embedded text)", () => {
    const content = '---\nprojekt: "[[Anders]]"\nnotiz: "siehe [[Alt]] hier"\n---\n';
    const res = renameFrontmatterWikiLinks(content, [
      { key: "projekt", oldTarget: "Alt", newTarget: "Neu" },
      { key: "fehlt", oldTarget: "Alt", newTarget: "Neu" },
      { key: "notiz", oldTarget: "Alt", newTarget: "Neu" },
    ]);
    expect(res.renamed).toBe(0);
    expect(res.content).toBe(content);
  });

  it("is a no-op without frontmatter and throws on malformed frontmatter", () => {
    expect(renameFrontmatterWikiLinks("Nur Body [[Alt]]\n", [
      { key: "x", oldTarget: "Alt", newTarget: "Neu" },
    ])).toEqual({ content: "Nur Body [[Alt]]\n", renamed: 0 });

    expect(() =>
      renameFrontmatterWikiLinks('---\n{ kaputt: [\n---\n', [
        { key: "x", oldTarget: "Alt", newTarget: "Neu" },
      ])
    ).toThrow(FrontmatterSurgicalError);
  });
});

describe("readFrontmatterPath", () => {
  const DOC = `---
type: task
plainva:
  tasks: false
  pim:
    uid: remote-1
  blocks:
    - uid: a
      account: acc1
    - uid: b
---

# Body
`;

  it("reads scalars at a nested path", () => {
    expect(readFrontmatterPath(DOC, ["type"])).toBe("task");
    expect(readFrontmatterPath(DOC, ["plainva", "tasks"])).toBe(false);
    expect(readFrontmatterPath(DOC, ["plainva", "pim", "uid"])).toBe("remote-1");
  });

  it("returns collections as PLAIN values, not yaml nodes", () => {
    // The trap this pins: getIn hands back a YAMLSeq for a list, so a caller
    // doing Array.isArray(...) used to get false and silently see nothing.
    const blocks = readFrontmatterPath(DOC, ["plainva", "blocks"]);
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks).toEqual([{ uid: "a", account: "acc1" }, { uid: "b" }]);
    expect(readFrontmatterPath(DOC, ["plainva"])).toEqual({
      tasks: false,
      pim: { uid: "remote-1" },
      blocks: [{ uid: "a", account: "acc1" }, { uid: "b" }],
    });
  });

  const BROKEN = ["---", "{ kaputt: [", "---", ""].join("\n");

  it("is total: missing keys, no frontmatter and malformed yaml all yield undefined", () => {
    expect(readFrontmatterPath(DOC, ["nope"])).toBeUndefined();
    expect(readFrontmatterPath(DOC, [])).toBeUndefined();
    expect(readFrontmatterPath("# no frontmatter", ["type"])).toBeUndefined();
    expect(readFrontmatterPath(BROKEN, ["type"])).toBeUndefined();
  });
});
