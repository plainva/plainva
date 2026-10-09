import { describe, expect, it } from "vitest";
import { shippedSources } from "./test-sourceTree";

/**
 * One definition of a note's properties block (finding 2026-10-07).
 *
 * "The note starts with `---`, the block ends at the next `---`" had been
 * written down some thirty times — as a pattern, or as a search for the two
 * lines. Nearly every copy wanted a line between the fences, so none took
 * `---` directly on `---` for a block: the form the writers themselves left
 * behind when a block lost its last entry. The next write put a second block
 * on top; with a rule further down, the text up to it was read as YAML.
 *
 * The definition is `frontmatterSpan` in `packages/core/src/frontmatter-block.ts`
 * (exported from `@plainva/core`, with `noteBodyOf` for the text behind the
 * block). The editor holds lines instead of a string and reads the same rule on
 * them, in one place: `frontmatterLines` in
 * `packages/ui/src/components/editorFrontmatter.ts` (finding 2026-10-09 — five
 * scans of the editor's lines had stayed behind, each wanting a line that is
 * exactly `---`, so a fence with a blank behind it was a block for the index
 * and text for the editor).
 *
 * This guard fails on a file that spells the block out for itself again. It
 * reads the shapes the copies had; it cannot know another.
 */

/** A pattern anchored on the opening fence: `/^---\r?\n…`, with or without a byte order mark or blanks. */
const OWN_PATTERN = /\^(?:\\uFEFF\??)?---(?:\[ \\t\]\*)?(?:\\r\??)?\\n/;
/** A search for the fences by hand: `startsWith("---\n")`, `indexOf("\n---")`. */
const OWN_SEARCH = /startsWith\(\s*["'`]---(?:\\r)?\\n|indexOf\(\s*["'`](?:\\r)?\\n---/;
/** A line tested for being a fence by hand: `line.text === "---"`, `lines[0]?.trim() !== "---"`, `/^---[ \t]*$/.test(line)`. */
const OWN_LINE_TEST = /[!=]==?\s*["'`]---["'`]|["'`]---["'`]\s*[!=]==?|\^(?:\(\?:)?---(?:\|[^)\n]*\))?(?:\[ \\t\]\*|\\s\*)?\$/;

const readsTheBlockItself = (text: string) => OWN_PATTERN.test(text) || OWN_SEARCH.test(text) || OWN_LINE_TEST.test(text);

/**
 * Files that may keep a reading of their own, each with its reason. All three
 * decide what a view shows, not what a note's properties are, and they hide
 * more than the block: also what closes on the YAML document end `...`, which
 * is no properties block and so not the definition's business (ADR 0009,
 * addendum 2026-10-09, point 6).
 */
const ALLOWED = new Map<string, string>([
  // Its pattern lets the closing line follow the opening one directly, like
  // the definition (pinboard-search.test.ts).
  ["packages/core/src/vault/VaultQueryService.ts", "card search: wider than the block on purpose"],
  ["packages/ui/src/lib/noteCardModel.ts", "card preview: wider than the block on purpose"],
  ["packages/ui/src/lib/textDirection.ts", "writing direction of a paragraph: wider than the block on purpose"],
]);

describe("the properties block has one definition", () => {
  it("no shipped file spells the block out for itself", () => {
    const offenders = shippedSources()
      .filter(({ rel, text }) => !ALLOWED.has(rel) && readsTheBlockItself(text))
      .map(({ rel }) => `${rel}: use frontmatterSpan() or noteBodyOf() from @plainva/core — on an editor document frontmatterLines() from packages/ui/src/components/editorFrontmatter.ts`);
    expect(offenders).toEqual([]);
  });

  it("every exemption still names a file that needs it", () => {
    const sources = new Map(shippedSources().map(({ rel, text }) => [rel, text]));
    for (const rel of ALLOWED.keys()) {
      const text = sources.get(rel);
      expect(text, `${rel} is gone — remove the exemption`).toBeDefined();
      expect(readsTheBlockItself(text!), `${rel} no longer reads the block itself — remove the exemption`).toBe(true);
    }
  });

  it("recognises the shapes the copies had, and leaves writing a block alone", () => {
    for (const copy of [
      String.raw`const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;`,
      String.raw`content.match(/^---\n([\s\S]*?)\n---/)`,
      String.raw`.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, "")`,
      String.raw`if (/^---\r?\n/.test(text)) return text;`,
      String.raw`if (!content.startsWith("---\n")) return 0;`,
      String.raw`const first = content.startsWith("---\r\n") ? 5 : 4;`,
      String.raw`const close = content.indexOf("\n---", 3);`,
      // The editor's line scans, and the two shapes of the readers that stay.
      String.raw`if (state.doc.lines < 2 || state.doc.line(1).text !== "---") return 0;`,
      String.raw`if (firstLine === "---") {`,
      String.raw`if ("---" === doc.line(i).text) return i;`,
      String.raw`if (lines[0]?.trim() !== "---") return { fm: null, body: lines };`,
      String.raw`if (index === 0 && /^---[ \t]*$/.test(line)) {`,
      String.raw`if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) state.frontmatter = false;`,
      String.raw`const isFence = (line: string) => /^---\s*$/.test(line);`,
    ]) {
      expect(readsTheBlockItself(copy), copy).toBe(true);
    }
    for (const fine of [
      "return `---\\ntype: ${type}\\n---\\n\\n${text}`;",
      String.raw`lines.push("---", "tags:");`,
      String.raw`if (!content.startsWith("---", at)) return -1;`,
      String.raw`if (!line.startsWith("---", at)) return false;`,
      String.raw`case "divider": return insertBlock(value, start, end, "---");`,
      String.raw`const RULE = /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;`,
      String.raw`const dashes = text.replace(/---/g, "-");`,
    ]) {
      expect(readsTheBlockItself(fine), fine).toBe(false);
    }
  });
});
