import { describe, expect, it } from "vitest";
import { parse as parseYaml, parseDocument } from "yaml";
import {
  FrontmatterSurgicalError,
  deleteFrontmatterPath,
  ensureOkfFrontmatter,
  frontmatterKeys,
  readFrontmatterPath,
  renameFrontmatterKey,
  renameFrontmatterTag,
  setFrontmatterPath,
  upsertFrontmatterKeys,
} from "../src/frontmatter-surgical.js";
import { updateFrontmatterString } from "../src/frontmatter-string-updater.js";
import { contentHasTag, renameTagInText } from "../src/vault/renameTag.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { extractFrontmatter } from "../src/metadata-extractor.js";
import { BLOCK, LAST_ENTRY, MARK, READ, SHAPES, noteOf, withLine, withLinesBehind, withoutLines } from "./helpers/propertyBlock.js";

/**
 * Setting, removing or renaming ONE property changes that entry and nothing
 * else in the note — byte for byte (finding 2026-10-11).
 *
 * Every writer of a property printed the whole block through the YAML
 * library. The block of `helpers/propertyBlock.ts` holds what came back
 * changed from any write: numbers written anew from the value they were read
 * as (`plz: 01067` as `1067`), a long line folded at 80 characters, a bracket
 * list padded, a list indented, blank lines collapsed. Here every writer runs
 * over that block, in each shape a note lies on disk in, and what comes back
 * is compared as a whole: the same lines, with the one change that was asked
 * for. The shells' own write paths run over the same block: the desktop's
 * properties panel and database cell
 * (`apps/desktop/src/components/PropertiesSection.entryBytes.test.tsx`,
 * `apps/desktop/src/components/base/useBaseCells.entryBytes.test.tsx`) and
 * the phone's cell and selection over its adapter chain
 * (`apps/mobile/src/services/propertyEntryBytes.test.ts`).
 */

const set = setFrontmatterPath;
const remove = deleteFrontmatterPath;
const rename = renameFrontmatterKey;
const lf = (lines: readonly string[], text = "Text\n") => ["---", ...lines, "---", text].join("\n");

describe("the block of these tests", () => {
  it("is one the YAML library writes its own way, line for line", () => {
    const printed = new Set(parseDocument(BLOCK.join("\n")).toString().split("\n"));
    const changed = BLOCK.filter((line) => !printed.has(line));
    // What every writer of a property did to this block until 2026-10-12.
    expect(changed).toEqual([
      "plz: 01067",
      "phone: +4915112345678",
      "id: 12345678901234567890",
      "half: .5",
      "big: 1e3",
      "hex: 0x1F",
      "tags: [a, b]",
      BLOCK.find((line) => line.startsWith("long: ")),
      BLOCK.find((line) => line.startsWith("address: ")),
      BLOCK.find((line) => line.startsWith("source: ")),
      '  d0x4zgNMFc7lu&index=16"',
      "- one",
      "- two",
      "title:    Spaced",
      "status: open   # the state",
      "  a folded",
      "  text",
      "    icon: x",
      "    pim: {uid: 007, list: [1, 2]}",
      "  - {{alias}}",
      "  - '[[Ben]]'   # since May",
    ]);
    for (const written of ["plz: 1067", "phone: 4915112345678", "id: 12345678901234567000", "half: 0.5", "big: 1e+3", "hex: 0x1f", "tags: [ a, b ]", "  - { ? { alias } }"]) {
      expect(printed.has(written), written).toBe(true);
    }
  });

  it("is read by the index's reader as the set the shells start from", () => {
    expect(extractFrontmatter(parseMarkdownAst(noteOf(BLOCK)))).toEqual({ success: true, data: READ });
  });
});

/** A writer, and the block it has to leave: the same lines with one change. */
type Case = [name: string, write: (note: string) => string, expected: (block: readonly string[]) => string[]];

const SET: Case[] = [
  ["a value: its characters, and the comment behind it stays", (n) => set(n, ["status"], "done"), (b) => withLine(b, "status: open   # the state", "status: done   # the state")],
  ["a value in quotes keeps its quotes", (n) => set(n, ["single"], "that's it"), (b) => withLine(b, "single: 'it''s'", "single: 'that''s it'")],
  ["a text that reads as a number is written as a text", (n) => set(n, ["plz"], "01069"), (b) => withLine(b, "plz: 01067", 'plz: "01069"')],
  ["a value behind many blanks keeps them", (n) => set(n, ["title"], "Other"), (b) => withLine(b, "title:    Spaced", "title:    Other")],
  ["a key the index names by its text", (n) => set(n, ["2024"], "plans"), (b) => withLine(b, "2024: goals", "2024: plans")],
  ["a line somebody folded becomes the one line of its new value", (n) => set(n, ["source"], "https://example.com/x"), (b) => withoutLines(withLine(b, b[11], 'source: "https://example.com/x"'), '  d0x4zgNMFc7lu&index=16"')],
  ["a reference gets a value of its own", (n) => set(n, ["alias"], "own"), (b) => withLine(b, "alias: *anchor", "alias: own")],
  ["a block scalar stays one", (n) => set(n, ["text"], "one line"), (b) => withoutLines(withLine(b, "text: |", "text: |-", "  one line"), "  line one", "  line two")],
  ["a folded scalar stays one", (n) => set(n, ["folded"], "new"), (b) => withoutLines(withLine(b, "folded: >-", "folded: >-", "  new"), "  a folded", "  text")],
  ["a new key: a line behind the last entry", (n) => set(n, ["owner"], "Anna"), (b) => withLinesBehind(b, LAST_ENTRY, "owner: Anna")],
  ["a new key with a map: its lines behind the last entry", (n) => set(n, ["other", "deep", "key"], true), (b) => withLinesBehind(b, LAST_ENTRY, "other:", "  deep:", "    key: true")],
  ["a list in brackets gets an item between its brackets", (n) => set(n, ["tags"], ["a", "b", "c"]), (b) => withLine(b, "tags: [a, b]", "tags: [a, b, c]")],
  ["a list in brackets loses an item", (n) => set(n, ["tags"], ["b"]), (b) => withLine(b, "tags: [a, b]", "tags: [b]")],
  ["a list at the margin gets a line at the margin", (n) => set(n, ["list"], ["one", "two", "three"]), (b) => withLinesBehind(b, "- two", "- three")],
  ["a list gets its first item", (n) => set(n, ["list"], ["zero", "one", "two"]), (b) => withLinesBehind(b, "list:", "- zero")],
  ["a list loses a line", (n) => set(n, ["list"], ["two"]), (b) => withoutLines(b, "- one")],
  ["a list of links gets one, written as a new one is", (n) => set(n, ["people"], ["[[Anna]]", "[[Ben]]", "[[Cleo]]"]), (b) => withLinesBehind(b, "  - '[[Ben]]'   # since May", '  - "[[Cleo]]"')],
  ["an item changes in its quotes, and its comment stays", (n) => set(n, ["people"], ["[[Anna]]", "[[Bea]]"]), (b) => withLine(b, "  - '[[Ben]]'   # since May", "  - '[[Bea]]'   # since May")],
  ["a nested value, indented by four", (n) => set(n, ["plainva", "icon"], "y"), (b) => withLine(b, "    icon: x", "    icon: y")],
  ["a new nested key: a line indented as its neighbours are", (n) => set(n, ["plainva", "header_color"], "#2f6f6f"), (b) => withLinesBehind(b, "    pim: {uid: 007, list: [1, 2]}", '    header_color: "#2f6f6f"')],
  ["a value in a map in braces", (n) => set(n, ["plainva", "pim", "uid"], "u-2"), (b) => withLine(b, "    pim: {uid: 007, list: [1, 2]}", "    pim: {uid: u-2, list: [1, 2]}")],
  ["a new key in a map in braces", (n) => set(n, ["plainva", "pim", "account"], "acc"), (b) => withLine(b, "    pim: {uid: 007, list: [1, 2]}", "    pim: {uid: 007, list: [1, 2], account: acc}")],
  ["an item in a list in a map in braces", (n) => set(n, ["plainva", "pim", "list"], [1, 2, 3]), (b) => withLine(b, "    pim: {uid: 007, list: [1, 2]}", "    pim: {uid: 007, list: [1, 2, 3]}")],
  // Only an entry whose value changes its shape is written anew — from its colon on.
  ["a text that becomes a list is written anew, behind its key", (n) => set(n, ["title"], ["x", "y"]), (b) => withLine(b, "title:    Spaced", "title:", "  - x", "  - y")],
  ["a list that becomes a text is written anew, behind its key", (n) => set(n, ["list"], "text"), (b) => withoutLines(withLine(b, "list:", "list: text"), "- one", "- two")],
  ["a list that becomes empty is written anew, behind its key", (n) => set(n, ["tags"], []), (b) => withLine(b, "tags: [a, b]", "tags: []")],
];

const REMOVE: Case[] = [
  ["an entry of one line: that line", (n) => remove(n, ["status"]), (b) => withoutLines(b, "status: open   # the state")],
  ["a list: its key and its items", (n) => remove(n, ["list"]), (b) => withoutLines(b, "list:", "- two")],
  ["a block scalar: its key and its lines", (n) => remove(n, ["text"]), (b) => withoutLines(b, "text: |", "  line two")],
  ["a folded line: both of its lines", (n) => remove(n, ["source"]), (b) => withoutLines(b, b[11], '  d0x4zgNMFc7lu&index=16"')],
  ["a key the index names by its text", (n) => remove(n, ["2024"]), (b) => withoutLines(b, "2024: goals")],
  ["a nested entry: its line", (n) => remove(n, ["plainva", "icon"]), (b) => withoutLines(b, "    icon: x")],
  ["an entry of a map in braces, with its comma", (n) => remove(n, ["plainva", "pim", "uid"]), (b) => withLine(b, "    pim: {uid: 007, list: [1, 2]}", "    pim: {list: [1, 2]}")],
  ["a map with all its lines", (n) => remove(n, ["plainva"]), (b) => withoutLines(b, "plainva:", "    pim: {uid: 007, list: [1, 2]}")],
  ["the last entries of a map, one after the other: the map goes with the last", (n) => remove(remove(n, ["plainva", "icon"]), ["plainva", "pim"]), (b) => withoutLines(b, "plainva:", "    pim: {uid: 007, list: [1, 2]}")],
];

const RENAME: Case[] = [
  ["a key: its characters, and the entry stays where it is", (n) => rename(n, "status", "state"), (b) => withLine(b, "status: open   # the state", "state: open   # the state")],
  ["a key that needs quotes gets them", (n) => rename(n, "title", "my: title"), (b) => withLine(b, "title:    Spaced", '"my: title":    Spaced')],
  ["a key the index names by its text", (n) => rename(n, "2024", "year"), (b) => withLine(b, "2024: goals", "year: goals")],
  ["the key of a list: the line of the key", (n) => rename(n, "list", "items"), (b) => withLine(b, "list:", "items:")],
  ["a tag in the properties: its characters between the brackets", (n) => renameFrontmatterTag(n, "a", "c").content, (b) => withLine(b, "tags: [a, b]", "tags: [c, b]")],
];

const OTHER: Case[] = [
  ["the type a note has to have: a line behind the last entry", (n) => ensureOkfFrontmatter(n, { type: "Note" }).content, (b) => withLinesBehind(b, LAST_ENTRY, "type: Note")],
  ["several keys at once: each where it stands", (n) => upsertFrontmatterKeys(n, { status: "done", owner: "Anna" }), (b) => withLinesBehind(withLine(b, "status: open   # the state", "status: done   # the state"), LAST_ENTRY, "owner: Anna")],
  ["a map handed over whole changes entry by entry", (n) => upsertFrontmatterKeys(n, { plainva: { icon: "y", pim: { uid: 7, list: [1, 2] } } }), (b) => withLine(b, "    icon: x", "    icon: y")],
];

/** The whole set, as the properties panel and a database cell hand it back: what the reader read, with one change. */
const WHOLE_SET: Case[] = [
  ["one value changed", (n) => updateFrontmatterString(n, { ...READ, status: "done" }), (b) => withLine(b, "status: open   # the state", "status: done   # the state")],
  ["one key no longer named", (n) => updateFrontmatterString(n, Object.fromEntries(Object.entries(READ).filter(([key]) => key !== "status"))), (b) => withoutLines(b, "status: open   # the state")],
  ["one key new", (n) => updateFrontmatterString(n, { ...READ, owner: "Anna" }), (b) => withLinesBehind(b, LAST_ENTRY, "owner: Anna")],
  ["one key under another name: the entry stays where it is", (n) => updateFrontmatterString(n, Object.fromEntries(Object.entries(READ).map(([key, value]) => [key === "status" ? "state" : key, value]))), (b) => withLine(b, "status: open   # the state", "state: open   # the state")],
  ["one item more in a list", (n) => updateFrontmatterString(n, { ...READ, tags: ["a", "b", "c"] }), (b) => withLine(b, "tags: [a, b]", "tags: [a, b, c]")],
  ["the key the index names by its text", (n) => updateFrontmatterString(n, { ...READ, "2024": "plans" }), (b) => withLine(b, "2024: goals", "2024: plans")],
];

/** Writes that have nothing to write. */
const NOTHING: Array<[string, (note: string) => string]> = [
  ["the value that stands there", (n) => set(n, ["status"], "open")],
  ["the number a value reads as", (n) => set(n, ["plz"], 1067)],
  ["the list that stands there", (n) => set(n, ["tags"], ["a", "b"])],
  ["the map that stands there", (n) => set(n, ["plainva"], { icon: "x", pim: { uid: 7, list: [1, 2] } })],
  ["a key that is not there, removed", (n) => remove(n, ["missing"])],
  ["a nested key that is not there, removed", (n) => remove(n, ["plainva", "missing"])],
  ["a key under a value that is no map, removed", (n) => remove(n, ["status", "inner"])],
  ["a key that is not there, renamed", (n) => rename(n, "missing", "other")],
  ["a tag that is not there, renamed", (n) => renameFrontmatterTag(n, "none", "other").content],
  ["no keys to set", (n) => upsertFrontmatterKeys(n, {})],
  ["the set the reader read, handed back as it is", (n) => updateFrontmatterString(n, { ...READ })],
];

describe.each(SHAPES)("one entry changes, and no other byte — a note with %s", (_shape, shape) => {
  const note = noteOf(BLOCK, shape);
  const check = (_name: string, write: (note: string) => string, expected: (block: readonly string[]) => string[]) => {
    expect(write(note)).toBe(noteOf(expected(BLOCK), shape));
  };

  describe("setting", () => {
    it.each(SET)("%s", check);
  });
  describe("removing", () => {
    it.each(REMOVE)("%s", check);
  });
  describe("renaming", () => {
    it.each(RENAME)("%s", check);
  });
  describe("the other writers", () => {
    it.each(OTHER)("%s", check);
  });
  describe("the whole set, written as its difference", () => {
    it.each(WHOLE_SET)("%s", check);
  });
  describe("nothing to write gives the note back untouched", () => {
    it.each(NOTHING)("%s", (_name, write) => {
      expect(write(note)).toBe(note);
    });
  });

  it("the type is left alone where the note has one", () => {
    const typed = noteOf(withLinesBehind(BLOCK, LAST_ENTRY, "type: Report"), shape);
    expect(ensureOkfFrontmatter(typed, { type: "Note" })).toEqual({ content: typed, changed: false, setType: false });
  });

  it("set and removed again, a property leaves the note as it was", () => {
    expect(remove(set(note, ["owner"], "Anna"), ["owner"])).toBe(note);
    expect(remove(set(note, ["plainva", "header_color"], "#2f6f6f"), ["plainva", "header_color"])).toBe(note);
    expect(remove(set(note, ["other", "deep", "key"], 1), ["other", "deep", "key"])).toBe(note);
    expect(rename(rename(note, "status", "state"), "state", "status")).toBe(note);
  });

  it("what is written reads back as what was asked for, and as nothing else", () => {
    const blockOf = (text: string) => parseYaml(text.slice(text.indexOf("---") + 3, text.indexOf(`${shape.eol}---${shape.eol}# A note`))) as Record<string, unknown>;
    expect(blockOf(note)).toEqual(READ);
    expect(blockOf(set(note, ["status"], "done"))).toEqual({ ...READ, status: "done" });
    expect(blockOf(set(note, ["plainva", "pim", "uid"], "u-2"))).toEqual({ ...READ, plainva: { icon: "x", pim: { uid: "u-2", list: [1, 2] } } });
    expect(blockOf(remove(note, ["list"]))).toEqual(Object.fromEntries(Object.entries(READ).filter(([key]) => key !== "list")));
  });
});

describe("a change that cannot be made without changing another entry is refused", () => {
  const note = noteOf(BLOCK);

  it("a value another entry refers to is not removed from under it", () => {
    // `alias: *anchor` would lead nowhere.
    expect(() => remove(note, ["anchored"])).toThrow(FrontmatterSurgicalError);
  });

  it("a value another entry refers to is not changed for both", () => {
    // In its place the new value would be `alias`'s too; written anew it would lose the anchor `alias` needs.
    expect(() => set(note, ["anchored"], "other")).toThrow(FrontmatterSurgicalError);
    expect(() => set(note, ["anchored"], ["a", "list"])).toThrow(FrontmatterSurgicalError);
  });

  it("says so the way a block that is no map is refused: the sentence the user is shown begins there", () => {
    for (const write of [() => remove(note, ["anchored"]), () => set(note, ["status", "inner"], 1), () => set(note, ["tags", "inner"], 1)]) {
      let message = "";
      try {
        write();
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/^Frontmatter is not a YAML map/);
      // The name of the entry, and nothing of the note's text.
      expect(message).not.toMatch(/open|kept|goals/);
    }
  });

  it("a key on the way that holds something other than a map is refused, not written over", () => {
    expect(() => set(lf(["plainva: text"]), ["plainva", "icon"], "x")).toThrow(/^Frontmatter is not a YAML map under 'plainva'/);
    expect(() => set(lf(["plainva: [a]"]), ["plainva", "icon"], "x")).toThrow(FrontmatterSurgicalError);
    expect(() => set(lf(["plainva:", "  pim: 5"]), ["plainva", "pim", "uid"], "x")).toThrow(/under 'pim'/);
  });

  it("a renamed key must not meet one that is there", () => {
    expect(() => rename(note, "status", "title")).toThrow(/target key already exists/);
    expect(() => rename(note, "status", "2024")).toThrow(/target key already exists/);
  });
});

describe("a key the index names by its text", () => {
  // The index reads the block as data, where every key is a text. Asked for
  // by that text, the writers found no `2024:` — a write put `"2024":` beside
  // it, and removing or renaming did nothing and said nothing.
  it.each([
    ["a number", "2024: goals", "2024"],
    ["a decimal", "1.5: goals", "1.5"],
    ["a boolean", "true: goals", "true"],
    ["no name", "~: goals", ""],
  ])("%s", (_name, line, name) => {
    const note = lf(["a: 1", line, "b: 2"]);
    expect(Object.keys(parseYaml(["a: 1", line, "b: 2"].join("\n")) as object)).toContain(name);
    expect(set(note, [name], "plans")).toBe(lf(["a: 1", line.replace("goals", "plans"), "b: 2"]));
    expect(remove(note, [name])).toBe(lf(["a: 1", "b: 2"]));
    expect(rename(note, name, "renamed")).toBe(lf(["a: 1", "renamed: goals", "b: 2"]));
    expect(updateFrontmatterString(note, { a: 1, [name]: "goals", b: 2 })).toBe(note);
  });

  it("where two keys have one name, the one the block says under that name is the one that changes", () => {
    // Read as data, the later of the two stands under "2024".
    const note = lf(['"2024": text', "2024.0: number"]);
    expect(parseYaml('"2024": text\n2024.0: number')).toEqual({ "2024": "number" });
    expect(set(note, ["2024"], "x")).toBe(lf(['"2024": text', "2024.0: x"]));
    // Removed, the other one would stand under the name: the entry cannot go without changing what the block says elsewhere.
    expect(() => remove(note, ["2024"])).toThrow(FrontmatterSurgicalError);
  });

  it("a key the reader does not hand out is not one a set dropped", () => {
    // The panel and a cell hand back the set the index's reader gave them. That reader has no `__proto__`.
    const note = lf(["__proto__: x", "constructor: y", "a: 1"]);
    expect(extractFrontmatter(parseMarkdownAst(note))).toEqual({ success: true, data: { constructor: "y", a: 1 } });
    expect(updateFrontmatterString(note, { constructor: "y", a: 2 })).toBe(lf(["__proto__: x", "constructor: y", "a: 2"]));
    // Asked for by its name, it is an entry like any other.
    expect(remove(note, ["__proto__"])).toBe(lf(["constructor: y", "a: 1"]));
    expect(set(note, ["__proto__"], "z")).toBe(lf(["__proto__: z", "constructor: y", "a: 1"]));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("lists, item by item", () => {
  it.each([
    ["an item more, indented as the others are", ["tags:", "    - a", "    - b", "x: 1"], ["a", "b", "c"], ["tags:", "    - a", "    - b", "    - c", "x: 1"]],
    ["an item in the middle goes with its comment", ["tags:", "  - a", "  - b   # why", "  - c"], ["a", "c"], ["tags:", "  - a", "  - c"]],
    ["a comment between two items stays where it is", ["tags:", "  - a", "  # about b", "  - b", "", "  - c"], ["a", "c", "d"], ["tags:", "  - a", "  # about b", "", "  - c", "  - d"]],
    ["one item changes: its characters, in its quotes", ["tags:", '  - "a"', "  - 'b'", "  - c"], ["a", "B", "c"], ["tags:", '  - "a"', "  - 'B'", "  - c"]],
    ["numbers that are handed back as read keep what they are written with", ["codes:", "  - 007", "  - 01067"], [7, 1067, 5], ["codes:", "  - 007", "  - 01067", "  - 5"]],
    ["every item another one: each in its place", ["tags:", "  - a", "  - b"], ["x", "y", "z"], ["tags:", "  - x", "  - y", "  - z"]],
    ["an item without a value gets one", ["tags:", "  -", "  - b"], ["a", "b"], ["tags:", "  - a", "  - b"]],
    ["an item that is a map: a new one in the list's form", ["verified:", "  - by: human:Anna", "    at: 2026-10-01T10:00:00Z"], [{ by: "human:Anna", at: "2026-10-01T10:00:00Z" }, { by: "human:Ben", at: "2026-10-12T10:00:00Z" }], ["verified:", "  - by: human:Anna", "    at: 2026-10-01T10:00:00Z", "  - by: human:Ben", "    at: 2026-10-12T10:00:00Z"]],
    ["an item that is a map and changes is written anew, the others stay", ["blocks:", "  - uid: 007", "    account: x", "  - uid: 008   # kept"], [{ uid: 7, account: "y" }, { uid: 8 }], ["blocks:", "  - uid: 7", "    account: y", "  - uid: 008   # kept"]],
    ["a placeholder as a template holds one stays as it is written", ["aliases:", "  - {{alias}}", "tags:", "  - x"], undefined, ["aliases:", "  - {{alias}}", "tags:", "  - x", "  - y"]],
    ["in brackets with blanks inside", ["tags: [ a, b ]"], ["a", "b", "c"], ["tags: [ a, b, c ]"]],
    ["in brackets without blanks", ["tags: [a,b]"], ["b", "c"], ["tags: [b,c]"]],
    ["in brackets, empty", ["tags: []"], ["a"], ["tags: [a]"]],
    ["in brackets over several lines", ["tags: [", "  a,", "  b", "]", "x: 1"], ["a", "b", "c"], ["tags: [", "  a,", "  b,", "  c", "]", "x: 1"]],
    ["links in brackets", ['refs: ["[[A]]", "[[B]]"]'], ["[[A]]", "[[C]]", "[[B]]"], ['refs: ["[[A]]", "[[C]]", "[[B]]"]']],
    // Not to be changed between its brackets: written anew, behind its key.
    ["in brackets with a comment inside: written anew", ["tags: [a, # first", "  b]", "x: 1"], ["a", "b", "c"], ["tags:", "  - a", "  - b", "  - c", "x: 1"]],
    ["in brackets with a comma behind the last: written anew", ["tags: [a, b,]"], ["a", "b", "c"], ["tags:", "  - a", "  - b", "  - c"]],
  ] as Array<[string, string[], unknown[] | undefined, string[]]>)("%s", (_name, before, items, after) => {
    const key = before.find((line) => /^(tags|codes|verified|blocks|refs)\b/.test(line))!.split(":")[0];
    expect(set(lf(before), [key], items ?? ["x", "y"])).toBe(lf(after));
  });

  it("a long list with one change costs one walk", () => {
    const items = Array.from({ length: 20_000 }, (_, i) => `tag-${i}`);
    const note = `---\ntitle: x\ntags:\n${items.map((tag) => `  - ${tag}\n`).join("")}status: open\n---\nBody\n`;
    const started = performance.now();
    expect(set(note, ["tags"], [...items, "new"])).toBe(note.replace("status: open", "  - new\nstatus: open"));
    expect(set(note, ["tags"], items.filter((_, i) => i !== 10_000))).toBe(note.replace("  - tag-10000\n", ""));
    expect(set(note, ["status"], "done")).toBe(note.replace("status: open", "status: done"));
    expect(renameFrontmatterTag(note, "tag-777", "renamed").content).toBe(note.replace("  - tag-777\n", "  - renamed\n"));
    // Reading the block twice dominates; searched pair by pair, twenty thousand items would take minutes.
    expect(performance.now() - started).toBeLessThan(20_000);
  });

  it("an item that only moves keeps its characters, in a list of any length", () => {
    const numbers = Array.from({ length: 600 }, (_, i) => i);
    const lines = numbers.map((n) => `  - ${String(n).padStart(5, "0")}`);
    const note = lf(["codes:", ...lines, "status: open"]);
    // Changed at both ends, such a list is too long to be searched for what stays in it; every item was then
    // written from its value, `00017` as `17`.
    expect(set(note, ["codes"], [...numbers.slice(1), 99999])).toBe(lf(["codes:", ...lines.slice(1), "  - 99999", "status: open"]));
    expect(set(note, ["codes"], [599, ...numbers.slice(0, 599)])).toBe(lf(["codes:", lines[599], ...lines.slice(0, 599), "status: open"]));
    expect(set(note, ["codes"], [...numbers].reverse())).toBe(lf(["codes:", ...[...lines].reverse(), "status: open"]));
    // A short one in another order, with what stands behind an item; and the same between brackets.
    expect(set(lf(["ids:", "  - 007   # bond", "  - 0x1F", "  - 1e3"]), ["ids"], [1000, 31, 7])).toBe(lf(["ids:", "  - 1e3", "  - 0x1F", "  - 007   # bond"]));
    expect(set(lf(["ids: [007, 0x1F, 1e3]"]), ["ids"], [1000, 7, 31])).toBe(lf(["ids: [1e3, 007, 0x1F]"]));
    // A value the list holds twice, written two ways: the first of them is the one that is written again.
    expect(set(lf(["ids:", "  - 01", "  - 1", "  - 2"]), ["ids"], [2, 1])).toBe(lf(["ids:", "  - 2", "  - 01"]));
  });
});

describe("maps, entry by entry", () => {
  it("a block written as one map in braces is changed between its braces", () => {
    const json = lf(['{"a": 1, "b": [1, 2]}']);
    expect(set(json, ["c"], 3)).toBe(lf(['{"a": 1, "b": [1, 2], c: 3}']));
    expect(set(json, ["a"], "x")).toBe(lf(['{"a": x, "b": [1, 2]}']));
    expect(set(json, ["b"], [1, 2, 3])).toBe(lf(['{"a": 1, "b": [1, 2, 3]}']));
    expect(remove(json, ["a"])).toBe(lf(['{"b": [1, 2]}']));
    expect(remove(json, ["b"])).toBe(lf(['{"a": 1}']));
    expect(rename(json, "a", "c d")).toBe(lf(['{c d: 1, "b": [1, 2]}']));
    // Its last entry gone, the block goes like any other.
    expect(remove(lf(['{"a": 1}']), ["a"])).toBe("Text\n");
  });

  it("and over several lines, in the form it has", () => {
    const json = lf(["{", '  "title": "x",', '  "tags": ["a", "b"]', "}"]);
    expect(set(json, ["status"], "open")).toBe(lf(["{", '  "title": "x",', '  "tags": ["a", "b"],', "  status: open", "}"]));
    expect(remove(json, ["title"])).toBe(lf(["{", '  "tags": ["a", "b"]', "}"]));
  });

  it("a map this leaves empty goes with its last entry — up to the block", () => {
    expect(remove(lf(["a: 1", "plainva:", "  icon: x", "b: 2"]), ["plainva", "icon"])).toBe(lf(["a: 1", "b: 2"]));
    expect(remove(lf(["a: 1", "plainva:", "  pim:", "    uid: u"]), ["plainva", "pim", "uid"])).toBe(lf(["a: 1"]));
    expect(remove(lf(["a: 1", "plainva:", "  tasks: false", "  pim:", "    uid: u"]), ["plainva", "pim", "uid"])).toBe(lf(["a: 1", "plainva:", "  tasks: false"]));
    expect(remove(lf(["plainva:", "  icon: x"]), ["plainva", "icon"])).toBe("Text\n");
    expect(remove(lf(["plainva: {icon: x}", "b: 2"]), ["plainva", "icon"])).toBe(lf(["b: 2"]));
  });

  it("a key that holds nothing yet gets its map", () => {
    expect(set(lf(["plainva:", "b: 1"]), ["plainva", "icon"], "x")).toBe(lf(["plainva:", "  icon: x", "b: 1"]));
    expect(set(lf(["plainva: {}"]), ["plainva", "icon"], "x")).toBe(lf(["plainva: {icon: x}"]));
    expect(set(lf(["a: 1"]), ["plainva", "icon"], "x")).toBe(lf(["a: 1", "plainva:", "  icon: x"]));
  });

  it("a map handed over whole keeps the entries that say the same, removes and adds the others", () => {
    const note = lf(["plainva:", "  icon: x", "  pim:", "    uid: 007", "    list: l", "b: 2"]);
    expect(set(note, ["plainva", "pim"], { uid: 7, list: "m", account: "acc" })).toBe(lf(["plainva:", "  icon: x", "  pim:", "    uid: 007", "    list: m", "    account: acc", "b: 2"]));
    expect(set(note, ["plainva"], { icon: "x" })).toBe(lf(["plainva:", "  icon: x", "b: 2"]));
    expect(set(note, ["plainva"], {})).toBe(lf(["plainva: {}", "b: 2"]));
    expect(set(lf(["pim: {uid: 007, list: [1, 2]}"]), ["pim"], { uid: 7, account: "a" })).toBe(lf(["pim: {uid: 007, account: a}"]));
  });

  it("a block that is indented as a whole gets a line indented like the others", () => {
    expect(set(lf(["  a: 1", "  b: 2"]), ["c"], 3)).toBe(lf(["  a: 1", "  b: 2", "  c: 3"]));
    expect(remove(lf(["  a: 1", "  b: 2"]), ["a"])).toBe(lf(["  b: 2"]));
  });
});

describe("values", () => {
  it("a key without a value gets one behind its colon, in front of whatever follows", () => {
    expect(set(lf(["a:", "b: 1"]), ["a"], "x")).toBe(lf(["a: x", "b: 1"]));
    expect(set(lf(["a: # the comment"]), ["a"], true)).toBe(lf(["a: true # the comment"]));
    expect(set(lf(["a:", "b: 1"]), ["a"], ["x", "y"])).toBe(lf(["a:", "  - x", "  - y", "b: 1"]));
    // Nothing is what stands there.
    expect(set(lf(["a:"]), ["a"], null)).toBe(lf(["a:"]));
    expect(set(lf(["a:"]), ["a"], undefined)).toBe(lf(["a:"]));
  });

  it("nothing is written as `null`", () => {
    expect(set(lf(["a: 1"]), ["a"], null)).toBe(lf(["a: null"]));
    expect(set(lf(["a: 1"]), ["b"], undefined)).toBe(lf(["a: 1", "b: null"]));
    expect(upsertFrontmatterKeys(lf(["a: 1"]), { b: null })).toBe(lf(["a: 1", "b: null"]));
    // Also a place of a list that holds nothing, and an entry of a map without a value is left out.
    const sparse: unknown[] = new Array(2);
    sparse[1] = "x";
    expect(set(lf(["a: 1"]), ["list"], sparse)).toBe(lf(["a: 1", "list:", "  - null", "  - x"]));
    expect(set(lf(["list:", "  - null", "  - x"]), ["list"], sparse)).toBe(lf(["list:", "  - null", "  - x"]));
    expect(set(lf(["list:", "  - y", "  - x"]), ["list"], sparse)).toBe(lf(["list:", "  - null", "  - x"]));
    expect(set(lf(["a: 1"]), ["map"], { kept: 1, dropped: undefined })).toBe(lf(["a: 1", "map:", "  kept: 1"]));
  });

  it("quotes are kept where the new value can stand in them", () => {
    expect(set(lf(['a: "old"', "b: 'old'"]), ["a"], "new")).toBe(lf(['a: "new"', "b: 'old'"]));
    expect(set(lf(['a: "old"']), ["a"], 5)).toBe(lf(["a: 5"]));
    expect(set(lf(["a: old"]), ["a"], "5")).toBe(lf(['a: "5"']));
    expect(set(lf(["a: old"]), ["a"], "a: b")).toBe(lf(['a: "a: b"']));
  });

  it("a scalar over several lines is replaced as a whole", () => {
    expect(set(lf(["a: one", "  two", "b: 1"]), ["a"], "x")).toBe(lf(["a: x", "b: 1"]));
    expect(set(lf(['a: "one', '  two"   # c', "b: 1"]), ["a"], "x")).toBe(lf(['a: "x"   # c', "b: 1"]));
    expect(set(lf(["a: |+", "  one", "", "", "b: 1"]), ["a"], "x")).toBe(lf(["a: |-", "  x", "b: 1"]));
    expect(set(lf(["b: 1", "a: |", "  one", "  two"]), ["a"], "x\ny")).toBe(lf(["b: 1", "a: |-", "  x", "  y"]));
  });

  it("a value of several lines does not take a comment into itself: the entry is written anew", () => {
    expect(set(lf(["a: old   # c", "b: 1"]), ["a"], "x\ny")).toBe(lf(["a: |-", "  x", "  y", "b: 1"]));
  });

  it("a line that is new is not folded", () => {
    const long = `https://example.com/${"x".repeat(120)} and more words that used to be folded at eighty characters`;
    expect(set(lf(["a: 1"]), ["source"], long)).toBe(lf(["a: 1", `source: ${long}`]));
    expect(upsertFrontmatterKeys("Text\n", { subject: `re: ${long}` })).toBe(`---\nsubject: "re: ${long}"\n---\nText\n`);
  });

  it("a text is written as it was handed: one that begins with a blank, one with a byte order mark in it", () => {
    // Such a text used to be measured by writing it at the root of a document and reading it back. There the
    // library reads it differently from how it wrote it — and the text it read was taken for the one to write.
    const code = lf(["code: |1", "   def f():", "     pass", "status: open"]);
    expect(updateFrontmatterString(code, { code: "  def f():\n    pass\n", status: "done" })).toBe(lf(["code: |1", "   def f():", "     pass", "status: done"]));
    const quoted = lf(['quote: " indented first line\\n"', "status: open"]);
    expect(updateFrontmatterString(quoted, { quote: " indented first line\n", status: "done" })).toBe(lf(['quote: " indented first line\\n"', "status: done"]));
    const marked = lf([`title: ${MARK}Report`, "status: open"]);
    expect(updateFrontmatterString(marked, { title: `${MARK}Report`, status: "done" })).toBe(lf([`title: ${MARK}Report`, "status: done"]));
    const indicator = lf(["desc: |2", "    indented first line", "  second", "status: open"]);
    expect(updateFrontmatterString(indicator, { desc: "  indented first line\nsecond\n", status: "open" })).toBe(indicator);

    const texts = [" indented first line\n", " lead\nmore", "  two blanks\n\n  and more\n", `${MARK}marked`, "trailing blank \n", "\ttab first\nsecond", "a\r\nb\rc", "  ", "text\n\n\n"];
    for (const text of texts) {
      const label = JSON.stringify(text);
      // As a new entry in the middle of what is there, over an entry of each kind, as the last entry, in a new block.
      const block = ["plain: old", 'quoted: "old"', "literal: |", "  old", "last: 1"];
      for (const key of ["plain", "quoted", "literal", "last", "fresh"]) {
        const note = set(lf(block), [key], text);
        expect(readFrontmatterPath(note, [key]), `${key} ${label}`).toBe(text);
        for (const other of ["plain", "quoted", "literal", "last"]) {
          if (other !== key) expect(readFrontmatterPath(note, [other]), `${other} beside ${key} ${label}`).toEqual(readFrontmatterPath(lf(block), [other]));
        }
      }
      expect(readFrontmatterPath(set("# Note\n", ["fresh"], text), ["fresh"]), `new block ${label}`).toBe(text);
      expect(readFrontmatterPath(set(lf(["tags: [a, b]"]), ["tags"], ["a", text]), ["tags"]), `in brackets ${label}`).toEqual(["a", text]);
      expect(readFrontmatterPath(set(lf(["tags:", "  - a", "  - b"]), ["tags"], ["a", text, "b"]), ["tags"]), `in a list ${label}`).toEqual(["a", text, "b"]);
    }
  });

  it("a text that ends in empty lines is said between double quotes where it is the last entry", () => {
    // Behind the last entry stands the block's own line end: a text that keeps its empty lines would be read
    // there without the last of them.
    expect(set(lf(["b: 1", "a: x"]), ["a"], "text\n\n")).toBe(lf(["b: 1", 'a: "text\\n\\n"']));
    expect(set(lf(["b: 1"]), ["c"], "text\n\n")).toBe(lf(["b: 1", 'c: "text\\n\\n"']));
    expect(set("---\n---\nBody\n", ["c"], "text\n\n")).toBe('---\nc: "text\\n\\n"\n---\nBody\n');
    expect(set("Body\n", ["c"], "text\n\n")).toBe('---\nc: "text\\n\\n"\n---\nBody\n');
    // Only that entry: the ones in front of it are written the usual way.
    expect(upsertFrontmatterKeys("Body\n", { title: "Imported", tags: ["a"], c: "text\n\n" })).toBe('---\ntitle: Imported\ntags:\n  - a\nc: "text\\n\\n"\n---\nBody\n');
  });

  it("where a text cannot stand in the library's form, only that text stands between quotes: what is beside it keeps its characters", () => {
    // Under a key, in a list, as a new entry: the entry at the top of the path is not written anew for it.
    const map = lf(["first: 0", "e:", "  keep: 007 # c", "  in: old", "", "# about next", "next: 1"]);
    expect(set(map, ["e", "in"], "t\n\n")).toBe(lf(["first: 0", "e:", "  keep: 007 # c", '  in: "t\\n\\n"', "", "# about next", "next: 1"]));
    const last = lf(["first: 0", "e:", "  keep: 007 # c"]);
    expect(set(last, ["e", "in"], "t\n\n")).toBe(lf(["first: 0", "e:", "  keep: 007 # c", '  in: "t\\n\\n"']));
    const list = lf(["first: 0", "e:", "  - 007 # c", "  - old", "", "# about next", "next: 1"]);
    expect(set(list, ["e"], [7, "t\n\n"])).toBe(lf(["first: 0", "e:", "  - 007 # c", '  - "t\\n\\n"', "", "# about next", "next: 1"]));
    const text = lf(["first: 0", "e:", "  keep: 007 # c", "  in: |", "    old", "next: 1"]);
    expect(set(text, ["e", "in"], " ")).toBe(lf(["first: 0", "e:", "  keep: 007 # c", '  in: " "', "next: 1"]));
    // Between brackets and braces a text of two lines stands between quotes, on one line.
    expect(set(lf(["e: [007, old] # c", "next: 1"]), ["e"], [7, "a\nb"])).toBe(lf(['e: [007, "a\\nb"] # c', "next: 1"]));
    expect(set(lf(["e: {keep: 007, in: old} # c", "next: 1"]), ["e", "in"], "a\nb")).toBe(lf(['e: {keep: 007, in: "a\\nb"} # c', "next: 1"]));
    // One item of a list, in front of an empty line: the item behind it keeps its characters, and the line stays.
    const spaced = lf(["a: 007", "k:", "  - old", "    more # c", "", "  - 008 # z", "z: 1"]);
    expect(set(spaced, ["k"], ["t\n\n", 8])).toBe(lf(["a: 007", "k:", '  - "t\\n\\n" # c', "", "  - 008 # z", "z: 1"]));
    // A new item that holds such texts: the items that are there stay as they are written.
    const items = lf(["e:", "  - a", "  - b", "last: 9"]);
    expect(set(items, ["e"], ["a", { a: ["t\n\n", { b: " \n" }] }])).toBe(lf(["e:", "  - a", "  - a:", '      - "t\\n\\n"', '      - b: " \\n"', "last: 9"]));
  });

  it("a comment behind the sign of a block text stays", () => {
    expect(set(lf(["text: | # why", "  one", "b: 1"]), ["text"], "x")).toBe(lf(["text: |- # why", "  x", "b: 1"]));
    expect(set(lf(["text: >- # why", "  one", "b: 1"]), ["text"], "x\ny")).toBe(lf(["text: >- # why", "  x", "", "  y", "b: 1"]));
  });

  it("a date the YAML reads as a date stays as it is written when it is handed back", () => {
    const note = lf(["when: !!timestamp 2026-01-01", "status: open"]);
    const when = new Date("2026-01-01T00:00:00.000Z");
    expect(updateFrontmatterString(note, { when, status: "open" })).toBe(note);
    expect(updateFrontmatterString(note, { when, status: "done" })).toBe(lf(["when: !!timestamp 2026-01-01", "status: done"]));
    expect(set(note, ["when"], when)).toBe(note);
    // Another day is another value, written as its text.
    expect(set(note, ["when"], new Date("2026-02-01T00:00:00.000Z"))).toBe(lf(["when: 2026-02-01T00:00:00.000Z", "status: open"]));
  });

  it("a key written the long way is found, and its value stands where it stood", () => {
    const note = lf(["? complex", ": value", "b: 1"]);
    expect(set(note, ["complex"], "x")).toBe(lf(["? complex", ": x", "b: 1"]));
    expect(rename(note, "complex", "simple")).toBe(lf(["? simple", ": value", "b: 1"]));
    expect(remove(note, ["complex"])).toBe(lf(["b: 1"]));
  });
});

describe("the block itself", () => {
  it("a note without one gets one in front of its untouched text", () => {
    expect(set("# Note\n", ["plainva", "icon"], "x")).toBe("---\nplainva:\n  icon: x\n---\n# Note\n");
    expect(set(`${MARK}# Note\r\nText\r\n`, ["a"], 1)).toBe(`${MARK}---\r\na: 1\r\n---\r\n# Note\r\nText\r\n`);
    expect(updateFrontmatterString("# Just a note\n[[link]]", { title: "Test" })).toBe("---\ntitle: Test\n---\n# Just a note\n[[link]]");
  });

  it("the first entry goes into the block that is there, behind whatever it holds", () => {
    expect(set("---\n---\nBody", ["a"], 1)).toBe("---\na: 1\n---\nBody");
    expect(set("---\r\n---\r\nBody", ["a"], 1)).toBe("---\r\na: 1\r\n---\r\nBody");
    expect(set("---\n\n---\nBody", ["a"], 1)).toBe("---\n\na: 1\n---\nBody");
    expect(set("---\n# just a comment\n---\nBody", ["a"], 1)).toBe("---\n# just a comment\na: 1\n---\nBody");
  });

  it("the fences stay as they are written", () => {
    expect(set("--- \na: 1\n---  \n# Note\n", ["b"], 2)).toBe("--- \na: 1\nb: 2\n---  \n# Note\n");
    expect(remove("--- \na: 1\nb: 2\n---  \n# Note\n", ["b"])).toBe("--- \na: 1\n---  \n# Note\n");
    // A note that ends on its closing fence gets no line end behind it.
    expect(set("---\na: 1\n---", ["b"], 2)).toBe("---\na: 1\nb: 2\n---");
  });

  it("goes with its last entry, where nothing else is left in it", () => {
    expect(remove("---\nonly: 1\n---\nBody\n", ["only"])).toBe("Body\n");
    expect(remove("---\n\nonly: 1\n\n---\nBody\n", ["only"])).toBe("Body\n");
    expect(remove(`${MARK}---\r\nonly: 1\r\n---\r\nBody\r\n`, ["only"])).toBe(`${MARK}Body\r\n`);
    expect(updateFrontmatterString("---\nstage: open\ntags:\n  - a\n---\n# Single\n", {})).toBe("# Single\n");
  });

  it("stays where a line is left in it that says something: a comment is not removed with the last entry", () => {
    expect(remove("---\n# c\nonly: 1\n---\nBody\n", ["only"])).toBe("---\n# c\n---\nBody\n");
    expect(remove("---\nonly: 1\n# tail\n---\nBody\n", ["only"])).toBe("---\n# tail\n---\nBody\n");
    expect(frontmatterKeys("---\n# c\n---\nBody\n")).toEqual([]);
    // And the next entry goes into it.
    expect(set("---\n# c\n---\nBody\n", ["a"], 1)).toBe("---\n# c\na: 1\n---\nBody\n");
  });

  it("an entry goes with its own lines: what stands above and below it stays", () => {
    const note = lf(["a: 1", "", "# about b — or a line somebody commented out", "b: 2 # behind it", "", "c: 3", "# at the end"]);
    expect(remove(note, ["b"])).toBe(lf(["a: 1", "", "# about b — or a line somebody commented out", "", "c: 3", "# at the end"]));
    expect(remove(note, ["a"])).toBe(lf(["", "# about b — or a line somebody commented out", "b: 2 # behind it", "", "c: 3", "# at the end"]));
    // A new entry goes behind the last one, in front of what stands at the end.
    expect(set(note, ["d"], 4)).toBe(lf(["a: 1", "", "# about b — or a line somebody commented out", "b: 2 # behind it", "", "c: 3", "d: 4", "# at the end"]));
  });

  it("an entry ends with its last line that says something: a comment above the next entry is not its own", () => {
    // The library counts the empty lines and comments behind a last entry without a value to that entry,
    // and says the map or list ends behind them.
    const map = lf(["plainva:", "  icon:", "", "# about status", "status: open"]);
    expect(remove(map, ["plainva"])).toBe(lf(["", "# about status", "status: open"]));
    expect(set(map, ["plainva"], "text")).toBe(lf(["plainva: text", "", "# about status", "status: open"]));
    expect(set(map, ["plainva", "color"], "red")).toBe(lf(["plainva:", "  icon:", "  color: red", "", "# about status", "status: open"]));
    expect(rename(map, "plainva", "app")).toBe(lf(["app:", "  icon:", "", "# about status", "status: open"]));
    const list = lf(["tags:", "  - a", "  -", "", "# about status", "status: open"]);
    expect(remove(list, ["tags"])).toBe(lf(["", "# about status", "status: open"]));
    expect(set(list, ["tags"], ["a", null, "b"])).toBe(lf(["tags:", "  - a", "  -", "  - b", "", "# about status", "status: open"]));
    expect(set(list, ["tags"], ["a"])).toBe(lf(["tags:", "  - a", "", "# about status", "status: open"]));
    const deep = lf(["outer:", "  inner:", "    leaf:", "", "  # about other", "  other: 1", "last: 2"]);
    expect(remove(deep, ["outer", "inner"])).toBe(lf(["outer:", "", "  # about other", "  other: 1", "last: 2"]));
    const maps = lf(["people:", "  - name: Anna", "    role:", "", "# about status", "status: open"]);
    expect(remove(maps, ["people"])).toBe(lf(["", "# about status", "status: open"]));
    expect(set(maps, ["people"], [{ name: "Anna", role: null }, { name: "Ben" }])).toBe(lf(["people:", "  - name: Anna", "    role:", "  - name: Ben", "", "# about status", "status: open"]));
  });

  it("a block with a reference that leads nowhere is not written, and a tag rename passes it by", () => {
    // `*Draft*` is a reference for YAML, not emphasis. The index reads no property from such a block.
    const note = "---\ntitle: *Draft*\ntags: [a]\n---\nBody #a\n";
    expect(() => set(note, ["status"], "x")).toThrow(FrontmatterSurgicalError);
    expect(() => remove(note, ["tags"])).toThrow(FrontmatterSurgicalError);
    expect(() => rename(note, "tags", "labels")).toThrow(FrontmatterSurgicalError);
    expect(() => updateFrontmatterString(note, { status: "x" })).toThrow(FrontmatterSurgicalError);
    // Said the way the UI knows: the block cannot be read as properties.
    expect(() => upsertFrontmatterKeys(note, { status: "x" })).toThrow(/^Frontmatter is not a YAML map/);
    expect(remove(note, ["absent"])).toBe(note);
    // The vault-wide rename runs over every note. This one keeps its block, and the run goes on.
    expect(renameFrontmatterTag(note, "a", "c")).toEqual({ content: note, changed: false });
    expect(renameTagInText(note, "a", "c")).toEqual({ content: "---\ntitle: *Draft*\ntags: [a]\n---\nBody #c\n", changed: true });
    expect(contentHasTag(note, "a")).toBe(true);
    expect(contentHasTag("---\ntitle: *Draft*\n---\nBody\n", "a")).toBe(false);
  });

  it("several keys for a note without a block are written in one go, and say what was handed", () => {
    const updates = { title: "Imported", tags: ["a", "b"], plz: "01067", count: 3, done: false, nested: { a: [1, 2] }, note: " lead\nmore", long: `re: ${"word ".repeat(40)}end` };
    const note = upsertFrontmatterKeys("# Imported\n\nText\n", updates);
    expect(note.endsWith("\n---\n# Imported\n\nText\n")).toBe(true);
    for (const [key, value] of Object.entries(updates)) expect(readFrontmatterPath(note, [key]), key).toEqual(value);
    expect(frontmatterKeys(note)).toEqual(Object.keys(updates));
    // The same note as from one key after the other.
    let one = "# Imported\n\nText\n";
    for (const [key, value] of Object.entries(updates)) one = set(one, [key], value);
    expect(note).toBe(one);
    expect(upsertFrontmatterKeys("# Imported\n", {})).toBe("# Imported\n");
  });

  it("a text that keeps its empty lines keeps them when the entry behind it goes", () => {
    // `|+` reads the empty lines up to the next entry as its own. With that entry gone, the empty lines
    // behind it would be read into the text as well: they go with the entry.
    const said = (note: string) => readFrontmatterPath(note, ["keep"]);
    const between = lf(["keep: |+", "  one", "", "plain: value", "", "last: 1"]);
    expect(remove(between, ["plain"])).toBe(lf(["keep: |+", "  one", "", "last: 1"]));
    expect(said(between)).toBe("one\n\n");
    expect(said(remove(between, ["plain"]))).toBe("one\n\n");
    const two = lf(["keep: |+", "  one", "", "", "plain: value", "", "", "last: 1"]);
    expect(remove(two, ["plain"])).toBe(lf(["keep: |+", "  one", "", "", "last: 1"]));
    expect(said(remove(two, ["plain"]))).toBe(said(two));
    const comment = lf(["keep: |+", "  one", "", "plain: value", "", "# why", "last: 1"]);
    expect(remove(comment, ["plain"])).toBe(lf(["keep: |+", "  one", "", "# why", "last: 1"]));
    expect(said(remove(comment, ["plain"]))).toBe(said(comment));
    // At the end of the block the last line end belongs to the block, not to the text: one empty line stands where the entry stood.
    const last = lf(["keep: |+", "  one", "", "plain: value"]);
    expect(remove(last, ["plain"])).toBe(lf(["keep: |+", "  one", "", ""]));
    expect(said(last)).toBe("one\n\n");
    expect(said(remove(last, ["plain"]))).toBe("one\n\n");
    // The text itself goes with every line it reads.
    expect(remove(lf(["a: 1", "keep: |+", "  one", "", "last: 1"]), ["keep"])).toBe(lf(["a: 1", "last: 1"]));
    // And an entry directly behind its last line goes as any other.
    expect(remove(lf(["keep: |+", "  one", "plain: value", "last: 1"]), ["plain"])).toBe(lf(["keep: |+", "  one", "last: 1"]));
  });
});

describe("line ends", () => {
  it("a line that is new ends in the note's line end; the lines that are there keep theirs", () => {
    // A block with `\r\n` in a note whose text has `\n`: the note's line end is what most of its lines have.
    expect(set("---\r\na: 1\r\n---\r\nx\ny\nz\nw\n", ["b"], 2)).toBe("---\r\na: 1\r\nb: 2\n---\r\nx\ny\nz\nw\n");
    expect(set("---\na: 1\n---\nx\r\ny\r\nz\r\nw\r\n", ["b"], 2)).toBe("---\na: 1\nb: 2\r\n---\nx\r\ny\r\nz\r\nw\r\n");
  });

  it("a carriage return of its own is kept where it stands, and none is set", () => {
    const text = "# T\rText\r";
    const classic = `---\rstage: open\r# a comment\rtags:\r  - a\r  - b\r---\r${text}`;
    expect(set(classic, ["stage"], "done")).toBe(classic.replace("open", "done"));
    expect(remove(classic, ["tags"])).toBe(`---\rstage: open\r# a comment\r---\r${text}`);
    expect(rename(classic, "stage", "state")).toBe(classic.replace("stage", "state"));
    expect(renameFrontmatterTag(classic, "a", "c").content).toBe(classic.replace("- a", "- c"));
    // A line that is new ends in `\n`: the line end a new file gets.
    expect(set(classic, ["owner"], "Anna")).toBe(`---\rstage: open\r# a comment\rtags:\r  - a\r  - b\rowner: Anna\n---\r${text}`);
    expect(set(classic, ["tags"], ["a", "b", "c"])).toBe(`---\rstage: open\r# a comment\rtags:\r  - a\r  - b\r  - c\n---\r${text}`);
    expect(set(`---\r---\r${text}`, ["owner"], "Anna")).toBe(`---\rowner: Anna\n---\r${text}`);
    // A stray one among other line ends.
    expect(set("---\na: 1\rb: 2\n---\n# Note\n", ["c"], 3)).toBe("---\na: 1\rb: 2\nc: 3\n---\n# Note\n");
    expect(remove("---\na: 1\rb: 2\n---\n# Note\n", ["a"])).toBe("---\nb: 2\n---\n# Note\n");
  });

  it("`\\r\\r\\n` ends one line of an entry: a new line goes behind all three", () => {
    // What a file from Windows has after its line ends were converted twice.
    const text = "\r\n# Note\r\r\nText\r\r\n";
    const note = `---\r\r\nstage: open\r\r\ntags:\r\r\n  - a\r\r\n  - b\r\r\n---\r${text}`;
    expect(set(note, ["owner"], "Anna")).toBe(`---\r\r\nstage: open\r\r\ntags:\r\r\n  - a\r\r\n  - b\r\r\nowner: Anna\r\n---\r${text}`);
    expect(set(note, ["tags"], ["a", "b", "c"])).toBe(`---\r\r\nstage: open\r\r\ntags:\r\r\n  - a\r\r\n  - b\r\r\n  - c\r\n---\r${text}`);
    expect(remove(note, ["stage"])).toBe(`---\r\r\ntags:\r\r\n  - a\r\r\n  - b\r\r\n---\r${text}`);
    expect(remove(note, ["tags"])).toBe(`---\r\r\nstage: open\r\r\n---\r${text}`);
    expect(set(note, ["stage"], "done")).toBe(note.replace("open", "done"));
    expect(remove(remove(note, ["tags"]), ["stage"])).toBe(text);
  });
});

/**
 * Blocks put together from entries of every form, a change to one of them,
 * and the whole note compared: every other entry, every comment and every
 * blank line has to stand where it stood. The forms say themselves what a new
 * value does to them — nothing here asks the code under test where an entry
 * is.
 */
describe("generated blocks", () => {
  const LONG = "word ".repeat(30).trim();
  /** An entry: the lines it is written with, and the lines it has once its value is the text `changed`. */
  const FORMS: Array<{ key: string; lines: string[]; changed: string[] }> = [
    { key: "plain", lines: ["plain: value"], changed: ["plain: changed"] },
    { key: "zip", lines: ["zip: 01067"], changed: ["zip: changed"] },
    { key: "hex", lines: ["hex: 0x1F"], changed: ["hex: changed"] },
    { key: "spaced", lines: ["spaced:    wide   # with a comment"], changed: ["spaced:    changed   # with a comment"] },
    { key: "quoted", lines: ['quoted: "a: b"'], changed: ['quoted: "changed"'] },
    { key: "single", lines: ["single: 'it''s'"], changed: ["single: 'changed'"] },
    { key: "empty", lines: ["empty:"], changed: ["empty: changed"] },
    { key: "long", lines: [`long: ${LONG}`], changed: ["long: changed"] },
    { key: "multi", lines: ["multi: first", "  second"], changed: ["multi: changed"] },
    { key: "literal", lines: ["literal: |", "  one", "  two"], changed: ["literal: |-", "  changed"] },
    { key: "brackets", lines: ["brackets: [a, b,c]"], changed: ["brackets: changed"] },
    { key: "braces", lines: ["braces: {x: 1, y: [1, 2]}"], changed: ["braces: changed"] },
    { key: "margin", lines: ["margin:", "- one", "- two"], changed: ["margin: changed"] },
    { key: "deep", lines: ["deep:", "    - one", "    - two   # why"], changed: ["deep: changed"] },
    { key: "nested", lines: ["nested:", "  a: 1", "  b:", "    c: 007"], changed: ["nested: changed"] },
    { key: "placeholder", lines: ["placeholder:", "  - {{name}}"], changed: ["placeholder: changed"] },
    // A last entry and a last item without a value: the library counts the lines that follow to them.
    { key: "open", lines: ["open:", "  icon:"], changed: ["open: changed"] },
    { key: "dangling", lines: ["dangling:", "  - one", "  -"], changed: ["dangling: changed"] },
    { key: "people", lines: ["people:", "  - name: Anna", "    role:"], changed: ["people: changed"] },
    { key: "2024", lines: ["2024: year"], changed: ["2024: changed"] },
  ];
  const ABOVE = [[], [], ["# a comment"], [""], ["", "# a comment", ""]];

  /** A small generator with a seed: the same blocks on every run. */
  function random(seed: number) {
    let state = seed >>> 0;
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { below: (n: number) => Math.floor(next() * n), pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)] };
  }

  it("a change to one entry leaves every other line of 3000 notes where it was", () => {
    const rng = random(20261012);
    for (let round = 0; round < 3000; round++) {
      const forms = [...FORMS].sort(() => rng.below(3) - 1).slice(0, 2 + rng.below(7));
      const entries = forms.map((form) => ({ form, above: rng.pick(ABOVE) }));
      const end = rng.pick(ABOVE);
      const shape = rng.pick(SHAPES)[1];
      const target = rng.below(entries.length);
      const build = (changed: (index: number, form: (typeof FORMS)[number]) => string[] | null, added: string[] = []) => {
        const lines: string[] = [];
        entries.forEach(({ form, above }, index) => lines.push(...above, ...(changed(index, form) ?? [])));
        return shape.mark + ["---", ...lines, ...added, ...end, "---", "# Text", "", "---", "more"].join(shape.eol);
      };
      const note = build((_i, form) => form.lines);
      const key = forms[target].key;
      const label = `round ${round}: ${JSON.stringify(note)}`;

      expect(set(note, [key], "changed"), `set ${key} — ${label}`).toBe(build((i, form) => (i === target ? form.changed : form.lines)));
      expect(remove(note, [key]), `remove ${key} — ${label}`).toBe(build((i, form) => (i === target ? null : form.lines)));
      expect(rename(note, key, "renamed"), `rename ${key} — ${label}`).toBe(build((i, form) => (i === target ? [form.lines[0].replace(/^[^:]+/, "renamed"), ...form.lines.slice(1)] : form.lines)));
      expect(set(note, ["fresh"], "new"), `add — ${label}`).toBe(build((_i, form) => form.lines, ["fresh: new"]));
      // Handed back as the index reads it, a value is no change.
      const read = parseYaml(entries.flatMap(({ form }) => form.lines).join("\n")) as Record<string, unknown>;
      expect(set(note, [key], read[key]), `the same value — ${label}`).toBe(note);
      expect(updateFrontmatterString(note, read), `the same set — ${label}`).toBe(note);
    }
  });
});
