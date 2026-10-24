import { describe, expect, it } from "vitest";
import { prepareReaderSource } from "@plainva/core";
import { shippedSources, sourceFile } from "./test-sourceTree";

/**
 * Markdown is parsed in one place (finding 2026-10-09).
 *
 * The Markdown parser skips a byte order mark at the start of what it is given
 * and counts from behind it. A file's text is its bytes decoded WITH the mark,
 * so in a file that starts with one every offset the parser hands out is one
 * short of the place it means. Three readers laid such offsets on the text
 * again, each from a parser of its own: the note source — for a note with a
 * mark the journal read no entry and refused every write, an outline led one
 * line above each heading, an embedded section began in front of its heading,
 * the reading view kept a rest of the properties block —, the import from
 * Joplin, which left a link definition unresolved, and `parseMarkdownAst`,
 * whose offsets were one short as well (the index reads lines only; the link
 * rewriter cuts the mark off itself before it parses).
 *
 * The parse is `packages/core/src/markdown-parser.ts` now, for all of them, and
 * it counts every place in the text it was given. A reader of places takes its
 * tree there (`parseMarkdownTree`, `parseCommonMarkTree`, `parseMarkdownAst`)
 * and has nothing to remember about a mark.
 *
 * This guard fails on a shipped file that brings a Markdown parser of its own
 * again. It reads the packages a parse needs; it cannot know another.
 */

/** The packages that turn Markdown into a tree with places, where a file imports one: without one of them no file can. */
const PARSES_MARKDOWN = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'](?:remark-parse|react-markdown|mdast-util-from-markdown|micromark|marked|markdown-it|@lezer\/markdown)["']/;

const parsesMarkdownItself = (text: string) => PARSES_MARKDOWN.test(text);

/** Files that may, each with its reason. */
const ALLOWED = new Map<string, string>([
  ["packages/core/src/markdown-parser.ts", "the parse itself: every place counted in the text it was given"],
  // Held below: what it hands its renderer has no mark, and its headings are looked up by the line the source map names.
  ["apps/desktop/src/components/MarkdownReader.tsx", "the reading view's renderer, fed with the text prepareReaderSource() prepared"],
]);

describe("Markdown is parsed in one place, which counts in the text it was given", () => {
  it("no shipped file brings a Markdown parser of its own", () => {
    const offenders = shippedSources()
      .filter(({ rel, text }) => !ALLOWED.has(rel) && parsesMarkdownItself(text))
      .map(({ rel }) => `${rel}: take the tree from parseMarkdownTree(), parseCommonMarkTree() or parseMarkdownAst() in @plainva/core — their places are places in the text you hand in, also behind a byte order mark`);
    expect(offenders).toEqual([]);
  });

  it("every exemption still names a file that needs it", () => {
    const sources = new Map(shippedSources().map(({ rel, text }) => [rel, text]));
    for (const rel of ALLOWED.keys()) {
      const text = sources.get(rel);
      expect(text, `${rel} is gone — remove the exemption`).toBeDefined();
      expect(parsesMarkdownItself(text!), `${rel} no longer parses Markdown itself — remove the exemption`).toBe(true);
    }
  });

  it("recognises the shapes that bring a parser, and leaves the readers of a tree alone", () => {
    for (const copy of [
      String.raw`import remarkParse from "remark-parse";`,
      String.raw`import remarkParse from 'remark-parse';`,
      String.raw`import ReactMarkdown from 'react-markdown';`,
      String.raw`import { fromMarkdown } from "mdast-util-from-markdown";`,
      String.raw`const { micromark } = await import("micromark");`,
      String.raw`import { marked } from "marked";`,
      String.raw`import { parser } from "@lezer/markdown";`,
    ]) {
      expect(parsesMarkdownItself(copy), copy).toBe(true);
    }
    for (const fine of [
      String.raw`import { parseMarkdownTree } from "./markdown-parser.js";`,
      String.raw`import { parseCommonMarkTree } from '../../markdown-parser.js';`,
      String.raw`const ast = parseMarkdownAst(content, { preserveObsidianSyntax: true });`,
      String.raw`import remarkGfm from 'remark-gfm';`,
      String.raw`import remarkStringify from "remark-stringify";`,
      String.raw`import { visit } from "unist-util-visit";`,
      String.raw`import { markdown } from "@codemirror/lang-markdown";`,
      String.raw`// the reading view (react-markdown) renders the prepared text`,
    ]) {
      expect(parsesMarkdownItself(fine), fine).toBe(false);
    }
  });
});

describe("the reading view's own parse never meets a mark", () => {
  // Built at run time: the character is not typed into this file.
  const MARK = String.fromCharCode(0xfeff);

  it("is handed the prepared text, and the prepared text of a file has no mark", () => {
    for (const note of [
      "---\ntitle: x\n---\n# A\n\ntext [[Link]] ^block\n",
      "# A\r\n\r\ntext\r\n",
      "- [ ] task in the first line\n",
      "[[Link]] in the first line",
      "",
    ]) {
      const prepared = prepareReaderSource(MARK + note);
      expect(prepared.text.includes(MARK), JSON.stringify(note)).toBe(false);
      expect(prepared.text, JSON.stringify(note)).toBe(prepareReaderSource(note).text);
      // However many stand at the start: the renderer's parser would skip one of them and count from behind it.
      expect(prepareReaderSource(MARK + MARK + MARK + note).text.charCodeAt(0), JSON.stringify(note)).not.toBe(0xfeff);
    }
  });

  it("is wired so: the renderer gets that text, and a heading its id by the line the source map names", () => {
    const reader = sourceFile("apps/desktop/src/components/MarkdownReader.tsx");
    expect(reader).toContain("const source = useMemo(() => prepareReaderSource(content, {");
    expect(reader).toContain("const processedContent = source.text;");
    expect(reader).toMatch(/\{processedContent\}\s+<\/ReactMarkdown>/);
    // The only text a ReactMarkdown of this file is ever handed.
    expect(reader.match(/<ReactMarkdown\b/g)).toHaveLength(1);
    expect(reader).toContain("rehypeReaderSource(source, content)");
    expect(reader).toContain("new Map(parseHeadings(content).map((h) => [h.line, h.slug] as const))");
    // An embedded note is the file's text, mark included; it goes the same way.
    expect(reader).toMatch(/const text = await vaultAdapter\.readTextFile\(resolved\.path\);[\s\S]{0,120}selectNoteFragment\(text, resolved\.anchor\)/);
  });
});
