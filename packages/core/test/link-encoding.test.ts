import { describe, expect, it } from "vitest";
import { decodeMarkdownLinkTarget, encodeMarkdownLinkAnchor, encodeMarkdownLinkPath } from "../src/linkEncoding.js";
import { relativeMarkdownUrl } from "../src/okf-index.js";
import { extractLinksAndTags } from "../src/ast-scanner.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";

/**
 * The same mechanism as the WebDAV finding from issue #78, on the links
 * Plainva writes into notes: `encodeURI` leaves `#` and `?` alone, and a note
 * named "Draft #1.md" got a destination whose anchor started at the `#`.
 */
describe("markdown link targets survive the characters encodeURI leaves alone", () => {
  it("encodes '#' and '?' so the file name is not cut into target and anchor", () => {
    expect(encodeMarkdownLinkPath("Draft #1.md")).toBe("Draft%20%231.md");
    expect(encodeMarkdownLinkPath("Why?.md")).toBe("Why%3F.md");
  });

  it("encodes parentheses so an unbalanced one cannot end the destination early", () => {
    expect(encodeMarkdownLinkPath("Notes (draft.md")).toBe("Notes%20%28draft.md");
    expect(encodeMarkdownLinkPath("Sub (1)/index.md")).toBe("Sub%20%281%29/index.md");
  });

  it("leaves every other name exactly as before, so existing vaults read back unchanged", () => {
    for (const name of ["Note File.md", "Ärger & Öl.md", "a/b/c.md", "../up/Note.md", "100%.md"]) {
      expect(encodeMarkdownLinkPath(name)).toBe(encodeURI(name));
    }
  });

  it("keeps the anchor marker and encodes the heading text like a path", () => {
    expect(encodeMarkdownLinkAnchor("#Heading Name")).toBe("#Heading%20Name");
    expect(encodeMarkdownLinkAnchor("#Q?A (1)")).toBe("#Q%3FA%20%281%29");
    expect(encodeMarkdownLinkAnchor("")).toBe("");
  });

  it("round-trips through the decoder, old form and new form alike", () => {
    for (const name of ["Draft #1.md", "Why?.md", "Notes (draft.md", "Note File.md", "Ärger & Öl.md"]) {
      expect(decodeMarkdownLinkTarget(encodeMarkdownLinkPath(name))).toBe(name);
      expect(decodeMarkdownLinkTarget(encodeURI(name))).toBe(name);
    }
    // A stray percent sign is a name, not a crash.
    expect(decodeMarkdownLinkTarget("100%")).toBe("100%");
  });

  it("is what the index writer uses, and what the scanner reads back", () => {
    expect(relativeMarkdownUrl("Projects", "Projects/Draft #1.md")).toBe("Draft%20%231.md");
    const ast = parseMarkdownAst("[Draft](Draft%20%231.md#Part%20%281%29)");
    const scanned = extractLinksAndTags(ast);
    expect(scanned.links).toHaveLength(1);
    expect(scanned.links[0].target).toBe("Draft #1.md");
    expect(scanned.links[0].anchor?.replace(/^#/, "")).toBe("Part (1)");
  });
});
