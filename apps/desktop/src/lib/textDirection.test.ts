import { describe, expect, it } from "vitest";
import { firstStrongDirection, lineDirections, mayContainRtl, textDirectionOf } from "@plainva/ui";

/**
 * Right-to-left text (issue #111, plan Issues und Diskussionen 2026-09-30,
 * Teil R, R1): one rule for editor and reader - the first strong character
 * behind the Markdown syntax decides a block's direction.
 */

const AR = "بدأت اليوم قراءة كتاب جديد";
const HE = "התחלתי היום לקרוא ספר חדש";
const FA = "امروز یک کتاب تازه خواندم";
const DE = "Heute habe ich ein neues Buch angefangen";

describe("textDirectionOf", () => {
  it("reads Arabic, Hebrew and Persian as right to left, German as left to right", () => {
    expect(textDirectionOf(AR)).toBe("rtl");
    expect(textDirectionOf(HE)).toBe("rtl");
    expect(textDirectionOf(FA)).toBe("rtl");
    expect(textDirectionOf(DE)).toBe("ltr");
  });

  it("follows the FIRST strong character of a mixed line", () => {
    expect(textDirectionOf(`${AR} Plainva Markdown`)).toBe("rtl");
    expect(textDirectionOf("Plainva يحفظ ملاحظاتي كملفات Markdown.")).toBe("ltr");
    // Numbers and punctuation before the first letter decide nothing.
    expect(textDirectionOf(`42. ${AR}`)).toBe("rtl");
    expect(textDirectionOf(`(3) ${DE}`)).toBe("ltr");
  });

  it("skips every block prefix of Markdown", () => {
    for (const prefix of ["", "  ", "\t", "- ", "* ", "+ ", "1. ", "12) ", "# ", "### ", "> ", "> > ", "> - ", "  - "]) {
      expect(textDirectionOf(`${prefix}${AR}`), JSON.stringify(prefix)).toBe("rtl");
    }
  });

  it("keeps a task right to left behind any box - the `x` of `[x]` is syntax, not text", () => {
    for (const box of ["[ ]", "[x]", "[X]", "[/]", "[-]"]) {
      expect(textDirectionOf(`- ${box} مهمة منجزة`), box).toBe("rtl");
      expect(textDirectionOf(`1. ${box} ${HE}`), box).toBe("rtl");
    }
    expect(textDirectionOf("- [x] Buy the book")).toBe("ltr");
  });

  it("skips the callout marker, so the title decides", () => {
    expect(textDirectionOf(`> [!note] ${AR}`)).toBe("rtl");
    expect(textDirectionOf(`> [!warning]- ${HE}`)).toBe("rtl");
    expect(textDirectionOf("> [!tip] Remember")).toBe("ltr");
  });

  it("skips syntax the reader never shows: tags, comments, entities, link targets, embeds", () => {
    expect(textDirectionOf(`<span>${AR}</span>`)).toBe("rtl");
    expect(textDirectionOf(`<!-- c:abc123 -->${AR}`)).toBe("rtl");
    expect(textDirectionOf(`&nbsp;${AR}`)).toBe("rtl");
    expect(textDirectionOf(`[[Reading notes|${AR}]]`)).toBe("rtl");
    expect(textDirectionOf(`[[${AR}]] and more`)).toBe("rtl");
    expect(textDirectionOf(`![[cover.png]] ${AR}`)).toBe("rtl");
    expect(textDirectionOf(`![cover](cover.png) ${AR}`)).toBe("rtl");
    expect(textDirectionOf(`[٣](https://example.com) ${AR}`)).toBe("rtl");
    expect(textDirectionOf(`[^1] ${HE}`)).toBe("rtl");
  });

  it("falls back when there is no strong character at all", () => {
    expect(textDirectionOf("- ")).toBe("ltr");
    expect(textDirectionOf("- ", "rtl")).toBe("rtl");
    expect(textDirectionOf("42 / 310", "rtl")).toBe("rtl");
    // Arabic-Indic and Persian digits are numbers, not letters.
    expect(textDirectionOf("٤٢ ۳۱۰", "ltr")).toBe("ltr");
    expect(textDirectionOf("", "rtl")).toBe("rtl");
  });
});

describe("lineDirections", () => {
  it("gives every line of an Arabic note its direction, list items and quotes included", () => {
    const doc = [
      "# ملاحظات القراءة",
      "",
      AR,
      "- الفصل الأول: قرطبة",
      "- [x] شراء الكتاب",
      "> العلم في الصغر كالنقش على الحجر.",
      "Plainva يحفظ ملاحظاتي كملفات Markdown.",
    ].join("\n");
    expect(lineDirections(doc)).toEqual(["rtl", "rtl", "rtl", "rtl", "rtl", "rtl", "ltr"]);
  });

  it("an empty new list item and a blank line inherit the line before", () => {
    expect(lineDirections(`- ${AR}\n- `)).toEqual(["rtl", "rtl"]);
    expect(lineDirections(`${AR}\n`)).toEqual(["rtl", "rtl"]);
    expect(lineDirections(`${DE}\n- `)).toEqual(["ltr", "ltr"]);
  });

  it("numbers alone inherit", () => {
    expect(lineDirections(`${HE}\n\n2026\n\n${DE}\n\n42`)).toEqual(["rtl", "rtl", "rtl", "rtl", "ltr", "ltr", "ltr"]);
  });

  it("a paragraph is one block: its first strong character decides for every line", () => {
    expect(lineDirections(`123\n${AR}\nPlainva`)).toEqual(["rtl", "rtl", "rtl"]);
    // A list item carries its continuation lines.
    expect(lineDirections(`- ${AR}\n  Markdown`)).toEqual(["rtl", "rtl"]);
  });

  it("keeps fenced code, math blocks and the frontmatter left to right", () => {
    const doc = [
      "---",
      "title: ملاحظات",
      "---",
      AR,
      "```bash",
      'grep -n "الأندلس" notes.md',
      "```",
      "",
      "$$",
      "س = ٢",
      "$$",
      HE,
    ].join("\n");
    expect(lineDirections(doc)).toEqual(["ltr", "ltr", "ltr", "rtl", "ltr", "ltr", "ltr", "rtl", "ltr", "ltr", "ltr", "rtl"]);
  });

  it("a blank line after code goes back to the text's direction, not the code's", () => {
    expect(lineDirections(`${AR}\n~~~\ncode\n~~~\n`)).toEqual(["rtl", "ltr", "ltr", "ltr", "rtl"]);
  });

  it("a fence inside a list item or a quote is code too", () => {
    expect(lineDirections(`- ${AR}\n  \`\`\`\n  ${AR}\n  \`\`\``)).toEqual(["rtl", "ltr", "ltr", "ltr"]);
    expect(lineDirections(`> \`\`\`\n> ${AR}\n> \`\`\``)).toEqual(["ltr", "ltr", "ltr"]);
  });

  it("a table is one block", () => {
    expect(lineDirections(`| 1 | ${AR} |\n| --- | --- |\n| Plainva | 2 |`)).toEqual(["rtl", "rtl", "rtl"]);
  });

  it("a callout without a title takes the direction of its body", () => {
    expect(lineDirections(`${DE}\n\n> [!note]\n> ${AR}`)).toEqual(["ltr", "ltr", "rtl", "rtl"]);
    expect(lineDirections(`> [!note]\n>\n> ${HE}`)).toEqual(["rtl", "rtl", "rtl"]);
  });

  it("accepts the lines themselves (the editor passes doc.iterLines())", () => {
    expect(lineDirections([AR, "", DE])).toEqual(["rtl", "rtl", "ltr"]);
    expect(lineDirections(`${AR}\r\n\r\n${DE}\r\n`)).toEqual(["rtl", "rtl", "ltr", "ltr"]);
  });
});

describe("mayContainRtl / firstStrongDirection", () => {
  it("tells a note with right-to-left script from one without", () => {
    expect(mayContainRtl(`# ${DE}\n\n- [x] done`)).toBe(false);
    expect(mayContainRtl(`${DE} ${HE}`)).toBe(true);
    expect(mayContainRtl(FA)).toBe(true);
  });

  it("reads the first strong character of plain inline text", () => {
    expect(firstStrongDirection("   ")).toBeNull();
    expect(firstStrongDirection("** ")).toBeNull();
    expect(firstStrongDirection(`**${AR}**`)).toBe("rtl");
    expect(firstStrongDirection("日本語")).toBe("ltr");
    expect(firstStrongDirection("ދިވެހި")).toBe("rtl"); // Thaana
    expect(firstStrongDirection("ܐܪܡܝܐ")).toBe("rtl"); // Syriac
    expect(firstStrongDirection("ߒߞߏ")).toBe("rtl"); // NKo
  });
});
