import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { extractLinksAndTags } from "../src/ast-scanner.js";
import { initializeSchema } from "../src/db/Schema.js";
import { markNotesForWikiLinkReading, wikiLinkReadingMayDiffer } from "../src/db/wikiLinkReadingMigration.js";
import { wikiLinks } from "../src/linkScan.js";
import type { MarkdownAst } from "../src/markdown-ast.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { findInlineTags } from "../src/tagRule.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * Index format 6: a note whose links the reading up to format 5 listed
 * differently is read once more by the next full scan, and only such a note
 * (finding 2026-10-11; `wikiLinkReadingMigration.ts`).
 *
 * The selection is held against that reading itself, kept here as it was: the
 * parse without the wiki link construct, `[[…]]` looked for in each text value
 * (what `remark-obsidian-preserve.ts` did), the text between the brackets cut
 * at its first `|` and its first `#` or `^` (what `ast-scanner.ts` did). Every
 * note the two readings list different links for has to be selected.
 */

// Built at run time: these characters are not typed into this file.
const MARK = String.fromCharCode(0xfeff);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const TICK = "`";
const BS = "\\";

const oldParser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);

/** `parseLinkTarget` of ast-scanner.ts as it was. */
function oldTarget(raw: string): { target: string; anchor?: string } {
  const trimmed = raw.trim();
  const hash = trimmed.indexOf("#");
  const caret = trimmed.indexOf("^");
  const at = hash < 0 ? caret : caret < 0 ? hash : Math.min(hash, caret);
  return at < 0 ? { target: trimmed } : { target: trimmed.slice(0, at).trim(), anchor: trimmed.slice(at).trim() };
}

/** The link and tag rows the reading up to format 5 gave a note (its properties aside, which no reading changed). */
function oldRows(text: string): string[] {
  const tree = oldParser.parse(text) as unknown as { type: string; value?: string; children?: unknown[] };
  const rows: string[] = [];
  const walk = (node: { type: string; value?: string; children?: unknown[] }) => {
    if (node.type === "text" && typeof node.value === "string") {
      const value = node.value;
      let last = 0;
      for (const token of wikiLinks(value, { bang: true, anyInLine: true })) {
        for (const tag of findInlineTags(value.slice(last, token.index))) rows.push(`tag ${tag.name}`);
        const [targetRaw] = token.inner.split("|");
        const { target, anchor } = oldTarget(targetRaw);
        rows.push([token.bang ? "embed" : "wikilink", target, targetRaw.trim(), anchor ?? ""].join("\t"));
        last = token.end;
      }
      for (const tag of findInlineTags(value.slice(last))) rows.push(`tag ${tag.name}`);
    }
    for (const child of (node.children ?? []) as Array<{ type: string; value?: string; children?: unknown[] }>) walk(child);
  };
  walk(tree);
  // A Markdown link was read the same way then as now.
  for (const link of extractLinksAndTags(tree as unknown as MarkdownAst).links) {
    if (link.type === "markdown-link") rows.push([link.type, link.target, link.rawTarget, link.anchor ?? ""].join("\t"));
  }
  return rows.sort();
}

/** The same rows as the index reads them now. */
function newRows(text: string): string[] {
  const read = extractLinksAndTags(parseMarkdownAst(text, { preserveObsidianSyntax: true }));
  return [
    ...read.links.map((link) => [link.type, link.target, link.rawTarget, link.anchor ?? ""].join("\t")),
    ...read.tags.filter((tag) => tag.source === "inline").map((tag) => `tag ${tag.name}`),
  ].sort();
}

/** A small generator with a seed, over the fragments Markdown and wiki links contend for. */
function notes(seed: number, count: number, dense: boolean): string[] {
  let state = seed;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const plainNames = ["Note", "Alpha", "Beta Gamma", "Folder/Note", "Note#Heading", "Note^block", "#Heading", "a_b_c", "snake_case_name", "Über uns", "2026-10-21", "R&D", "A & B", "x #t", "[t", "a]b", "Q4 (draft)"];
  const markedNames = ["_x", "y_", "__init__", "*d*", "~~o~~", "Tom &amp; Jerry", "Q&#38;A", `My${BS}_N`, `n${BS}`, `a${TICK}b`, "<b>", "x<y", "<1=@x>", "<#@x>", "www.e.com", "https://e.com/p", "a@b.co", `a${LINE_SEPARATOR}b`, "a*b", "^1", "ref", "[Note", "a [b"];
  const names = dense ? [...plainNames, ...markedNames] : [...plainNames, ...plainNames, ...plainNames, ...markedNames.slice(0, 6)];
  const aliases = ["", "", "", "|al", "|*the* al", `|a ${TICK}c${TICK}`, "|x|y", `${BS}|al`, "|a]b", `|e${BS}`, "|[x](y)", "|#t"];
  const link = () => (next() < 0.15 ? "!" : "") + "[[" + pick(names) + pick(aliases) + "]]";
  const glueDense = [" ", " ", "", " and ", ", ", "(https://e.com)", "(x)", "[ref]", "[]", ": ", "!", " #tag ", " *e* ", " _u_ ", " **", "** ", ` ${TICK}`, `${TICK} `, " <b>", "</b> ", " <https://e.com/", "> ", " https://e.com/", " www.e.com ", "www.e.com/", BS, BS + BS, "&#91;", "&#93;", "&lsqb;", "[", "]", "[[", "]]", BS + "!", "&excl;", "&#10;", " ~~", "~~ ", " | ", " [l](u) ", " ![i](u) ", "[^1]", " x@y.zz ", " word ", "(", "](u) ", "] x](https://e.com) ", " <a:", "<https:", "<mailto:x", " http://localhost:8080/ ", " see http://localhost/ ", "![", "[x "];
  const glueMild = [" ", " ", " ", " and ", ", ", ". ", " see ", " - ", "; ", " #tag ", " word ", " (note) ", " 2026 "];
  const glue = dense ? glueDense : glueMild;
  const lineOf = () => {
    let out = "";
    const n = 1 + Math.floor(next() * 5);
    for (let i = 0; i < n; i++) out += (next() < 0.6 ? link() : pick(names)) + pick(glue);
    return out;
  };
  const prefixes = ["", "", "", "> ", "- ", "* ", "1. ", "- [ ] ", "# ", "    ", "| ", "\t"];
  const blocks = [
    () => pick(prefixes) + lineOf(),
    () => pick(prefixes) + lineOf() + "\n" + lineOf(),
    () => "| h | k |\n|---|---|\n| " + lineOf() + " | " + lineOf() + " |",
    () => "```\n" + lineOf() + "\n```",
    () => "<div>\n" + lineOf() + "\n</div>",
    () => (dense ? "[ref]: https://e.com/r" : lineOf()),
    () => (dense ? "[^1]: " + lineOf() : lineOf()),
    () => "> " + lineOf() + "\n> " + lineOf(),
    () => lineOf() + "  \n" + lineOf(),
  ];
  const out: string[] = [];
  for (let n = 0; n < count; n++) {
    const parts: string[] = [];
    const k = 1 + Math.floor(next() * 4);
    for (let i = 0; i < k; i++) parts.push(pick(blocks)());
    let text = parts.join("\n\n") + (next() < 0.5 ? "\n" : "");
    if (next() < 0.15) text = text.replace(/\n/g, "\r\n");
    if (next() < 0.1) text = "---\ntitle: T\ntags: [a]\n---\n" + text;
    if (next() < 0.05) text = MARK + text;
    out.push(text);
  }
  return out;
}

describe("which notes the format step hands to the next full scan", () => {
  it.each([
    ["notes full of what Markdown reads something into", 11, 1_200, true],
    ["notes as they mostly are", 12, 1_200, false],
  ] as Array<[string, number, number, boolean]>)("selects every note the two readings differ on: %s", (_what, seed, count, dense) => {
    let differ = 0;
    let selected = 0;
    for (const text of notes(seed, count, dense)) {
      const may = wikiLinkReadingMayDiffer(text);
      if (may) selected++;
      if (oldRows(text).join("\n") === newRows(text).join("\n")) continue;
      differ++;
      expect(may, JSON.stringify(text)).toBe(true);
    }
    // The generator does what it is for: both kinds of note occur.
    expect(differ).toBeGreaterThan(count / 20);
    expect(selected).toBeLessThan(count);
  });

  it("leaves a note alone whose links are plain names, and selects one whose names Markdown reads into", () => {
    for (const plain of ["See [[Alpha]], [[Beta Gamma|the beta]] and ![[Pic.png|300]].", "[[a_b_c]] [[snake_case_name]] [[Note#Part]] [[Note^b]]", "**Bold** text with *emphasis*, then [[Link]] and `code` after it.", "No link at all, but *stars* and _underscores_.", "- [ ] a task with [[Project]]\n- [x] done"]) {
      expect(wikiLinkReadingMayDiffer(plain), plain).toBe(false);
    }
    for (const marked of ["[[_private_]]", "[[__init__]]", "[[*Draft*]]", "[[~~old~~]]", "[[Note|*the* alias]]", `[[Note|a ${TICK}code${TICK}]]`, "[[Tom &amp; Jerry]]", `[[My${BS}_Note]]`, `${BS}[[Escaped]]`, "&#91;[Ref]]", "[[1]](https://example.com)", "[[link]]\n\n[link]: https://e.com", "x www.example.com/[[Old]]", `[[a${LINE_SEPARATOR}b]]`]) {
      expect(wikiLinkReadingMayDiffer(marked), JSON.stringify(marked)).toBe(true);
    }
    // A bracket the link takes in, which the old reading paired with a `](…)`
    // further on or left open in front of an address; an address in angle
    // brackets without `//`; a mail address in angle brackets.
    for (const marked of ["[[[Note]]](https://example.com)", "[[[Note]] x](url)", "[[a [b]] c](url)", "![[[Note]] x](img.png)", "[[[Note]] and more\nstill the label](https://example.com)", "[[[Note]] see http://localhost:8080/", "[x [[a]b]] see http://localhost/", "<https:[[Note]]>", "<mailto:x[[Note]]>", "<ab:[[Note]]>", "[[<1=@x>]]", "[[Note|<1=@x>]]"]) {
      expect(oldRows(marked).join("\n") === newRows(marked).join("\n"), JSON.stringify(marked)).toBe(false);
      expect(wikiLinkReadingMayDiffer(marked), JSON.stringify(marked)).toBe(true);
    }
    // In a word, `_` marks nothing.
    expect(wikiLinkReadingMayDiffer("[[my_note_2026]]")).toBe(false);
    expect(wikiLinkReadingMayDiffer("[[my_note_]]")).toBe(true);
    // The bar of a table cell reads the same both ways.
    expect(wikiLinkReadingMayDiffer(`| a |\n|---|\n| [[Note${BS}|alias]] |`)).toBe(false);
  });

  it("reads a note once, also a long line of links without a blank between them", () => {
    // What stands glued in front of each link is followed as the line is read,
    // not looked for again from every link back to the line's start — which
    // took seconds for these lines, each just under the indexer's limit.
    const note = `${"[[a]]".repeat(1_900)}\n`.repeat(500);
    const started = performance.now();
    expect(wikiLinkReadingMayDiffer(note)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1_000);
    // A note with a line the indexer reads no link from has no rows in either reading.
    expect(wikiLinkReadingMayDiffer(`[[_x_]] ${"y".repeat(10_001)}`)).toBe(false);
    expect(wikiLinkReadingMayDiffer(`[[_x_]] ${"y".repeat(9_000)}`)).toBe(true);
  });
});

describe("index format 6 on an index of format 5", () => {
  const NOTES: Record<string, string> = {
    "Plain.md": "See [[Alpha]] and [[Beta|the beta]].\n",
    "Private.md": "See [[_private_]] and [[Note|*the* alias]].\n",
    "Reference.md": `${MARK}One [[Tom &amp; Jerry]]\r\ntwo ${BS}[[Not a link]]\r\n`,
    "Code.md": "`[[Code]]` and [[Alpha]]\n",
    "_private_.md": "# Private\n",
    "Tom &amp; Jerry.md": "# A name with a reference in it\n",
    "Alpha.md": "# Alpha\n",
  };
  const rowsOf = async (db: Awaited<ReturnType<typeof realSqlite>>, path: string) =>
    (await db.query<{ target_path: string; target_raw: string; link_type: string }>(
      `SELECT l.target_path, l.target_raw, l.link_type FROM links l JOIN files f ON f.id = l.source_id WHERE f.path = ? AND l.property_key IS NULL ORDER BY l.target_path`,
      [path]
    )).map((row) => `${row.link_type} ${row.target_path}`);

  it("reads the notes concerned once more, puts their rows right, and leaves the others alone", async () => {
    const db = await realSqlite();
    const files = new MemoryVaultAdapter(1_000);
    for (const [path, text] of Object.entries(NOTES)) await files.writeTextFile(path, text);
    const indexer = new VaultIndexer(files, db);
    await indexer.indexVaultFull();

    // The index as format 5 left it: each note's link rows from the old reading.
    for (const [path, text] of Object.entries(NOTES)) {
      const id = (await db.queryOne<{ id: string }>(`SELECT id FROM files WHERE path = ?`, [path]))!.id;
      await db.execute(`DELETE FROM links WHERE source_id = ?`, [id]);
      for (const row of oldRows(text).filter((row) => !row.startsWith("tag "))) {
        const [type, target, raw, anchor] = row.split("\t");
        await db.execute(`INSERT INTO links (source_id, target_path, target_raw, link_type, anchor, property_key, line_number) VALUES (?, ?, ?, ?, ?, NULL, NULL)`, [id, target, raw, type, anchor || null]);
      }
    }
    await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('index_format_version', '5')`);
    expect(await rowsOf(db, "Private.md")).toEqual([]);
    expect(await rowsOf(db, "Reference.md")).toEqual(["wikilink Not a link", "wikilink Tom & Jerry"]);
    const mtimes = async () => new Map((await db.query<{ path: string; mtime_local: number }>(`SELECT path, mtime_local FROM files`)).map((row) => [row.path, Number(row.mtime_local)]));
    const before = await mtimes();

    await initializeSchema(db);

    expect((await db.queryOne<{ value: string }>(`SELECT value FROM meta WHERE key = 'index_format_version'`))?.value).toBe("7");
    const after = await mtimes();
    const reread = [...after].filter(([path, mtime]) => mtime === 0 && before.get(path) !== 0).map(([path]) => path).sort();
    expect(reread).toEqual(["Private.md", "Reference.md"]);

    // The next full scan reads them, and their rows are the ones the line says.
    await indexer.indexVaultFull();
    expect(await rowsOf(db, "Private.md")).toEqual(["wikilink Note", "wikilink _private_"]);
    expect(await rowsOf(db, "Reference.md")).toEqual(["wikilink Tom &amp; Jerry"]);
    expect(await rowsOf(db, "Plain.md")).toEqual(["wikilink Alpha", "wikilink Beta"]);
    const query = new VaultQueryService(db);
    expect((await query.getBacklinks("_private_.md")).map((row) => row.source_path)).toEqual(["Private.md"]);
    expect((await query.getBacklinks("Tom &amp; Jerry.md")).map((row) => row.source_path)).toEqual(["Reference.md"]);

    // A second start does nothing more.
    const settled = await mtimes();
    await initializeSchema(db);
    expect(await mtimes()).toEqual(settled);
    await db.close();
  });

  it("goes through an index in pieces, and finds a note behind the first two hundred", async () => {
    const db = await realSqlite();
    for (let n = 0; n < 450; n++) {
      const path = `n${n}.md`;
      const text = n === 437 ? "a [[_hidden_]] link\n" : `plain [[Note ${n}]]\n`;
      await db.execute(`INSERT INTO files (id, path, title, mtime_local) VALUES (?, ?, ?, ?)`, [path, path, path, 5]);
      await db.execute(`INSERT INTO fts_notes (content, title, path) VALUES (?, ?, ?)`, [text, path, path]);
    }
    expect(await markNotesForWikiLinkReading(db)).toBe(1);
    expect((await db.query<{ path: string }>(`SELECT path FROM files WHERE mtime_local = 0`)).map((row) => row.path)).toEqual(["n437.md"]);
    await db.close();
  });
});
