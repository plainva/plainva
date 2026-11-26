import { afterAll, describe, expect, it } from "vitest";
import { NOTE_BUDGET, readAsTextParts, setNoteBudget } from "../src/inlineParseBudget.ts";
import { parseMarkdownAst } from "../src/markdown-parser.ts";
import { extractLinksAndTags } from "../src/ast-scanner.ts";

/**
 * A label is one label as the parser folds it: micromark's
 * `normalizeIdentifier` collapses white space and folds case by upper case
 * (`Straße` and `STRASSE` are one label, `ẞ` and `SS` are one), which lower
 * case alone does not. A reading of a note over its budget that keyed labels
 * by lower case missed such a definition and read `[a][Straße](x.md)` as a
 * link to `x.md`, where the note read whole reads a reference and the text
 * `(x.md)` (review of L14, 2026-11-26, S2). Both directions: the definition
 * formatted and the reference in a piece of a block read as text, and the
 * definition in that block and the reference formatted.
 */

afterAll(() => setNoteBudget(NOTE_BUDGET));

const links = (note: string) => extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true }), note).links.map((link) => `${link.type} ${link.target} @${link.line}`);
const list = (n: number, at: number, line: string) => Array.from({ length: n }, (_, i) => (i === at ? line : `- item ${i} [[Note ${i % 50}]] some words ${i}`)).join("\n");
const REFERENCES = "see [a][Straße](x.md) and [b][ẞ](x.md) here";
const DEFINITIONS = "[STRASSE]: def.md\n\n[SS]: def.md";

const NOTES: Record<string, (n: number) => string> = {
  "the definitions formatted, the references in a piece": (n) => `# T\n\n${DEFINITIONS}\n\n${list(n, Math.floor(n / 2), `- ${REFERENCES}`)}\n`,
  "the definitions in a piece, the references formatted": (n) => `# T\n\n${REFERENCES}\n\n${list(n, Math.floor(n / 2), "- [STRASSE]: def.md")}\n\n${list(n, Math.floor(n / 3), "- [SS]: def.md")}\n`,
};

describe("labels folded as the parser folds them, in a note over its budget", () => {
  for (const [name, make] of Object.entries(NOTES)) {
    it(`${name}: a reference, as in the note read whole`, () => {
      expect.hasAssertions();
      setNoteBudget(NOTE_BUDGET);
      let n = 1_000;
      while (readAsTextParts(make(n)).pieces.length === 0) n = Math.ceil(n * 1.5);
      const note = make(n);
      const parts = readAsTextParts(note);
      expect(parts.unread).toEqual([]);
      const at = note.indexOf(name.startsWith("the definitions formatted") ? REFERENCES : "[STRASSE]: def.md");
      expect(parts.ranges.some((range) => range.block && range.from <= at && at < range.to), "in a block read as text").toBe(true);
      const head = links(note);
      setNoteBudget(Number.MAX_SAFE_INTEGER);
      const whole = links(note);
      setNoteBudget(NOTE_BUDGET);
      expect(whole.some((link) => link.includes(" x.md ")), "the note read whole reads references").toBe(false);
      expect(head).toEqual(whole);
    }, 120_000);
  }
});
