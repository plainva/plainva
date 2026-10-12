import { describe, expect, it } from "vitest";
import { noteBodyOf, noteWithoutProperties } from "../src/frontmatter-surgical.js";

/**
 * A note without its properties block: what "prepare" hands the link
 * conversion when a note becomes the overview of its folder (finding
 * 2026-10-09). The block goes by the rule of every writer of properties
 * (`composeNote`), and the text behind it is not touched.
 */
describe("noteWithoutProperties", () => {
  // Built at run time: the character is not typed into this file.
  const MARK = String.fromCharCode(0xfeff);

  it("takes the block out and leaves the text byte for byte, a mark in front of it", () => {
    expect(noteWithoutProperties("---\ntype: MOC\n---\n# Map\n\n* a\n")).toBe("# Map\n\n* a\n");
    // A blank line behind the block is the text's, and stays.
    expect(noteWithoutProperties("---\r\ntype: MOC\r\n---\r\n\r\n# Map\r\n")).toBe("\r\n# Map\r\n");
    expect(noteWithoutProperties(`${MARK}---\r\ntype: MOC\r\n---\r\n# Map\r\n`)).toBe(`${MARK}# Map\r\n`);
    expect(noteWithoutProperties("---\na: 1\n---")).toBe("");
  });

  it("hands a note without a block back as it is", () => {
    for (const note of ["# Map\n", `${MARK}# Map\r\n`, "---\nno closing fence\n", ""]) expect(noteWithoutProperties(note)).toBe(note);
  });

  it("follows the rule of the writers where the text opens with a `---` line", () => {
    // Taken out bare, the text's own rule would open a block and "Intro" would be read as YAML.
    const note = "---\ntype: MOC\n---\n---\nIntro\n---\nRest\n";
    const without = noteWithoutProperties(note);
    expect(without).toBe("---\n---\n---\nIntro\n---\nRest\n");
    expect(noteBodyOf(without)).toBe(noteBodyOf(note));
    // An empty block is no block to take out a second time.
    expect(noteWithoutProperties(without)).toBe(without);
    // In a note with Windows line ends the pair of fences is written with them.
    expect(noteWithoutProperties("---\r\ntype: MOC\r\n---\r\n---\r\nIntro\r\n")).toBe("---\r\n---\r\n---\r\nIntro\r\n");
  });
});
