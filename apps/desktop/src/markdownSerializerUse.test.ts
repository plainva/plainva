import { describe, expect, it } from "vitest";
import { shippedSources, sourceFile } from "./test-sourceTree";

/**
 * No note is written back from its parsed tree (finding 2026-10-09).
 *
 * A rename sent every note that links to the renamed one through the Markdown
 * serializer — parse the note, change the link in the tree, write the tree
 * back —, and so did preparing a note as the overview of its folder. The
 * serializer writes in its own form: `- ` for a list item whatever marker the
 * note uses, `_emphasis_`, a table rule as `| - | - |`, a blank line between
 * blocks, a line end at the end. For a vault kept in Git, renaming one note
 * was a diff across every note that links to it, and an aliased link in a
 * table cell came back without the backslash that keeps its `|` in the cell.
 *
 * The rule is that a note that is already there is changed where the change
 * stands — a link by `rewriteNoteLinks` and `renameNoteLinks`
 * (`packages/core/src/linkRewrite.ts`), a link in the properties by
 * `renameFrontmatterWikiLinks` — and never written from a tree. The serializer
 * stays in the core for NEW text: the one link the app writes with it
 * (`serializeMarkdownLink`), and tools outside the app that build a note from
 * a tree of their own.
 *
 * This guard fails on a shipped file that reaches for the serializer again. It
 * reads the shapes that reach for it; it cannot know another.
 */

/** The serializer by its name. */
const BY_NAME = /\bserializeMarkdownAst\b/;
/** The packages that write Markdown from a tree: without one of them a processor cannot. */
const BY_PACKAGE = /["'](?:remark-stringify|mdast-util-to-markdown)["']/;

const writesFromATree = (text: string) => BY_NAME.test(text) || BY_PACKAGE.test(text);

/** Files that may, each with its reason. */
const ALLOWED = new Map<string, string>([
  ["packages/core/src/markdown-serializer.ts", "the serializer itself, and the one new link the app writes with it"],
]);

describe("a note is never written back from its parsed tree", () => {
  it("no shipped file reaches for the Markdown serializer", () => {
    const offenders = shippedSources()
      .filter(({ rel, text }) => !ALLOWED.has(rel) && writesFromATree(text))
      .map(({ rel }) => `${rel}: change the note where the change stands — rewriteNoteLinks() or renameNoteLinks() from @plainva/core for a link, the line and property writers for the rest; serializeMarkdownLink() writes one new link`);
    expect(offenders).toEqual([]);
  });

  it("every exemption still names a file that needs it", () => {
    const sources = new Map(shippedSources().map(({ rel, text }) => [rel, text]));
    for (const rel of ALLOWED.keys()) {
      const text = sources.get(rel);
      expect(text, `${rel} is gone — remove the exemption`).toBeDefined();
      expect(writesFromATree(text!), `${rel} no longer writes from a tree — remove the exemption`).toBe(true);
    }
  });

  it("recognises the shapes that reach for it, and leaves the writers of a place alone", () => {
    for (const copy of [
      String.raw`if (bodyCount > 0) text = inShapeOf(text, serializeMarkdownAst(ast));`,
      String.raw`await adapter.writeTextFile(candidatePath, serializeMarkdownAst(ast));`,
      String.raw`import { parseMarkdownAst, serializeMarkdownAst } from "@plainva/core";`,
      String.raw`import remarkStringify from "remark-stringify";`,
      String.raw`import { toMarkdown } from 'mdast-util-to-markdown';`,
      String.raw`const { toMarkdown } = await import("mdast-util-to-markdown");`,
    ]) {
      expect(writesFromATree(copy), copy).toBe(true);
    }
    for (const fine of [
      String.raw`const res = renameNoteLinks(text, new Map(source.body.map(({ raw, target }) => [raw, target])));`,
      String.raw`return { replacement: serializeMarkdownLink(text, url, { inTable: link.inTable }) };`,
      String.raw`const ast = parseMarkdownAst(content, { preserveObsidianSyntax: true });`,
      String.raw`// Using "html" node type because remark-stringify outputs html nodes exactly as-is without escaping.`,
      String.raw`await adapter.writeTextFile(path, JSON.stringify(ast));`,
      String.raw`const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);`,
    ]) {
      expect(writesFromATree(fine), fine).toBe(false);
    }
  });
});

describe("where the two writers that went through it are wired", () => {
  it("a rename rewrites the links of a note where they stand, in its text and in its properties", () => {
    const rename = sourceFile("packages/ui/src/lib/renameNote.ts");
    const apply = rename.slice(rename.indexOf("export async function applyLinkUpdates"), rename.indexOf("export async function renameFileWithLinkUpdates"));
    expect(apply).toMatch(/renameNoteLinks\(text, new Map\(source\.body\.map\(/);
    expect(apply).toMatch(/renameFrontmatterWikiLinks\(text, source\.frontmatter\)/);
    // A link that could not be rewritten where it stands is said, not passed over.
    expect(apply).toMatch(/left \+= res\.unplaced;/);
    expect(apply).toMatch(/left \+= res\.skipped;/);
    expect(apply).toMatch(/if \(left > 0\) \{[\s\S]{0,200}?failed = true;/);
    expect(rename).not.toMatch(/parseMarkdownAst|inShapeOf/);
  });

  it("preparing an overview takes the block out by the writers' rule and converts each link in its place", () => {
    const index = sourceFile("packages/ui/src/lib/indexMd.ts");
    const adopt = index.slice(index.indexOf("export async function adoptFileAsIndex"));
    expect(adopt).toMatch(/convertWikilinksToMarkdownLinks\(noteWithoutProperties\(content\), /);
    expect(adopt).toMatch(/if \(prepared\.content !== content\) await adapter\.writeTextFile\(candidatePath, prepared\.content\);/);
    expect(index).not.toMatch(/parseMarkdownAst|inShapeOf/);
  });

  it("the properties block of a linking note is not written anew for a rename", () => {
    const surgical = sourceFile("packages/core/src/frontmatter-surgical.ts");
    const rename = surgical.slice(surgical.indexOf("export function renameFrontmatterWikiLinks"), surgical.indexOf("export interface EnsureOkfFrontmatterOptions"));
    expect(rename.length).toBeGreaterThan(500);
    expect(rename).not.toMatch(/joinDocument\(/);
  });
});
