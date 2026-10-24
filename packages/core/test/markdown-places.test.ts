import { describe, expect, it } from "vitest";
import { parseCommonMarkTree, parseMarkdownAst, parseMarkdownTree, type MarkdownTreeNode } from "../src/markdown-parser.js";
import { rewriteJexLinks } from "../src/import/adapters/jex.js";
import { extractLinksAndTags } from "../src/ast-scanner.js";
import { findSearchOccurrences } from "../src/vault/searchOccurrences.js";

/**
 * A place taken from a parsed tree is a place in the text that was parsed
 * (finding 2026-10-09).
 *
 * The Markdown parser skips a byte order mark at the start of what it is given
 * and counts from behind it. A file's text is its bytes decoded WITH the mark,
 * so for every file that starts with one each offset was one short — and three
 * readers laid those offsets on the text again: the note source (journal,
 * outline, embeds, reading view), the import from Joplin, and whoever would
 * read an offset from `parseMarkdownAst` next. They parse in one place now
 * (`markdown-parser.ts`), and that place counts in the text it was given.
 */

// Built at run time: the character is not typed into this file.
const MARK = String.fromCharCode(0xfeff);

const NOTES = [
  "---\ntitle: x\n---\n# Start\n\nText [link](a.md) and [[Wiki]] ^block\n\n## Über\nÄ 😀\n- item\n  more\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
  "# Start\r\n\r\nText ^block\r\n\r\n## Über\r\nÄ 😀\r\n### Detail\r\nBody\r\n",
  // The first line is where a column moves as well.
  "[[First]] and [second](b.md) in line one, #tag\nand [[Third|alias]] in line two\n",
  "# Only a heading",
  "- [ ] a task first\n\n# Then a heading\n",
  "[ref]: target.md\n\nSee [the other][ref].\n",
  "",
];

const PARSERS: Array<[string, (text: string) => MarkdownTreeNode]> = [
  ["parseMarkdownAst", (text) => parseMarkdownAst(text) as unknown as MarkdownTreeNode],
  ["parseMarkdownAst, Obsidian syntax kept", (text) => parseMarkdownAst(text, { preserveObsidianSyntax: true }) as unknown as MarkdownTreeNode],
  ["parseMarkdownTree", parseMarkdownTree],
  ["parseCommonMarkTree", parseCommonMarkTree],
];

const flat = (node: MarkdownTreeNode, out: MarkdownTreeNode[] = []): MarkdownTreeNode[] => {
  out.push(node);
  for (const child of node.children ?? []) flat(child, out);
  return out;
};

describe("places in a text that starts with a byte order mark", () => {
  for (const [name, parse] of PARSERS) {
    it(`${name} counts them in the text it was given`, () => {
      for (const note of NOTES) {
        const marked = MARK + note;
        const plain = flat(parse(note)), read = flat(parse(marked));
        expect(read.map((node) => node.type), note).toEqual(plain.map((node) => node.type));
        for (const [i, node] of read.entries()) {
          const was = plain[i].position, is = node.position;
          expect(is === undefined, `${node.type} in ${note}`).toBe(was === undefined);
          if (!was || !is) continue;
          // One character further, in the same line; in the first line the
          // column is one further too. They used to be the places of the note
          // without its mark: each block began one character early.
          expect([is.start.offset, is.end.offset], `${node.type} in ${note}`).toEqual([was.start.offset + 1, was.end.offset + 1]);
          expect([is.start.line, is.end.line], `${node.type} in ${note}`).toEqual([was.start.line, was.end.line]);
          expect([is.start.column, is.end.column], `${node.type} in ${note}`).toEqual([
            was.start.column + (was.start.line === 1 ? 1 : 0),
            was.end.column + (was.end.line === 1 ? 1 : 0),
          ]);
          // What the place is good for: it cuts the node's source out of the text.
          expect(marked.slice(is.start.offset, is.end.offset), `${node.type} in ${note}`).toBe(note.slice(was.start.offset, was.end.offset));
        }
      }
    });

    it(`${name} leaves a text without a mark as the parser counts it`, () => {
      const text = "# A\n\ntext\n";
      const [root, heading] = flat(parse(text));
      expect(root.position?.start).toEqual({ line: 1, column: 1, offset: 0 });
      expect(text.slice(heading.position!.start.offset, heading.position!.end.offset)).toBe("# A");
    });
  }

  it("adds back the one mark the parser skips: a second one is a character of the text", () => {
    // An editor holds a file without its first mark, and a second one behind
    // it as a character. So does the parse: the first line is a paragraph that
    // begins with that character, not a heading — and it stands where it is.
    const text = MARK + MARK + "# A\n\ntext\n";
    for (const [name, parse] of PARSERS) {
      const [first, second] = parse(text).children ?? [];
      expect([first.type, second.type], name).toEqual(["paragraph", "paragraph"]);
      expect(first.position?.start, name).toEqual({ line: 1, column: 2, offset: 1 });
      expect(text.slice(first.position!.start.offset, first.position!.end.offset), name).toBe(MARK + "# A");
      expect(text.slice(second.position!.start.offset, second.position!.end.offset), name).toBe("text");
    }
  });

  // Right before and after, and held so: the index reads a link's LINE, and a mark adds none.
  it("reads the same links, tags and lines for the index", () => {
    for (const note of NOTES) {
      const read = (text: string) => extractLinksAndTags(parseMarkdownAst(text, { preserveObsidianSyntax: true }));
      expect(read(MARK + note), note).toEqual(read(note));
    }
  });
});

describe("the readers that lay a parsed place on the text", () => {
  // The headings above a hit come from the note source. Their starts were one
  // short for a note with a mark, which no hit could show — a hit never starts
  // on the line break in front of a heading. Held so that it stays right.
  it("finds a search hit under the same headings, in the same line, one character further", () => {
    const note = "---\ntitle: x\n---\n# Start\n\nneedle one\n\n## Über\n\nneedle two\n\n### Detail\n\nneedle three\n";
    for (const text of [note, note.replace(/\n/g, "\r\n")]) {
      const plain = findSearchOccurrences(text, "needle"), read = findSearchOccurrences(MARK + text, "needle");
      expect(read.map((hit) => hit.occurrence.headings)).toEqual([["Start"], ["Start", "Über"], ["Start", "Über", "Detail"]]);
      expect(read.map((hit) => [hit.occurrence.line, hit.occurrence.headings, hit.occurrence.quote, hit.occurrence.from, hit.occurrence.to]))
        .toEqual(plain.map((hit) => [hit.occurrence.line, hit.occurrence.headings, hit.occurrence.quote, hit.occurrence.from + 1, hit.occurrence.to + 1]));
      for (const hit of read) expect((MARK + text).slice(hit.occurrence.from, hit.occurrence.to)).toBe("needle");
    }
  });

  it("rewrites the links of a note from Joplin whose body starts with a mark", () => {
    const id = "0123456789abcdef0123456789abcdef";
    const paths = new Map([[id, "Folder/Other.md"]]);
    for (const body of [
      // These three came out right before as well: their place is looked up
      // again inside the stretch the parser named, and the stretch, one
      // character early, still held it.
      `See [the other](:/${id}) note.\n`,
      `![picture](:/${id})`,
      `<a href=":/${id}">x</a>\n`,
      // A definition was the one that stayed: its place began one character
      // early, so it no longer began where a definition begins.
      `[ref]: :/${id}\n\nSee [the other][ref].\n`,
      `[ref]: :/${id}`,
      `text\r\n\r\n[ref]: :/${id}\r\n`,
    ]) {
      const plain = rewriteJexLinks(body, "Folder/Here.md", paths);
      const read = rewriteJexLinks(MARK + body, "Folder/Here.md", paths);
      expect(plain.missing, body).toBe(0);
      expect(plain.content, body).not.toContain(":/");
      expect(read, body).toEqual({ content: MARK + plain.content, missing: 0 });
    }
  });
});
