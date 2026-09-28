import { describe, expect, it } from "vitest";
import { insertJournalEntry, parseJournal, readJournalLine } from "../src/journal.js";
import { findInlineTagsInLine } from "../src/tagRule.js";
import { EDITOR_LIST_ITEM, MARKDOWN_LIST_ITEM, readMarkdownListItem } from "../src/markdownListItem.js";
import { trimSpaceBeforeLineEnds, trimStartChars } from "../src/textScan.js";

/**
 * Text from a vault is scanned in linear time (plan Befunde 24.09., E6). Each
 * hostile case is what an old pattern needed quadratic time for: a long run it
 * could split two ways, then something that made the match fail, so the engine
 * retried from every character of the run. The readers' behaviour is pinned by
 * their own tests (journal, journal-merge, tag-rule), which ran unchanged.
 */
const N = 100_000;
const within = (budgetMs: number, run: () => void) => {
  const start = performance.now();
  run();
  expect(performance.now() - start).toBeLessThan(budgetMs);
};

describe("textScan helpers", () => {
  it("trimStartChars takes only the given characters off the front", () => {
    expect(trimStartChars(" \t x \t", " \t")).toBe("x \t");
    expect(trimStartChars("\u00a0x", " \t")).toBe("\u00a0x");
    expect(trimStartChars("   ", " ")).toBe("");
  });

  it("trimSpaceBeforeLineEnds drops blanks before every line end, like /[ \\t]+$/gm", () => {
    const text = "a \t\nb  \r\nc\u2028 d  \u2029e \t";
    expect(trimSpaceBeforeLineEnds(text)).toBe(text.replace(/[ \t]+$/gm, ""));
    expect(trimSpaceBeforeLineEnds("a  b \n")).toBe("a  b\n");
  });

  it("…and only before a newline when asked, like /[ \\t]+\\n/g", () => {
    const text = "a \t\nb  \r\nc \u2028d  ";
    expect(trimSpaceBeforeLineEnds(text, "\n", false)).toBe(text.replace(/[ \t]+\n/g, "\n"));
  });

  it("both run in one pass over a long run of blanks", () => {
    const text = `a${" \t".repeat(N)}b`;
    within(1_000, () => expect(trimSpaceBeforeLineEnds(text)).toBe(text));
    within(1_000, () => expect(trimSpaceBeforeLineEnds(text, "\n", false)).toBe(text));
    within(1_000, () => expect(trimStartChars(text, "a \t")).toBe("b"));
  });
});

describe("one list reader, two grammars", () => {
  it("reads the copies' grammar: spaces and tabs, up to nine digits, boxes on numbered items", () => {
    expect(readMarkdownListItem("  - [x] done")).toEqual({ indent: "  ", marker: "-", ordered: false, box: "x", text: "done" });
    expect(readMarkdownListItem("12) [/] half")).toEqual({ indent: "", marker: "12)", ordered: true, box: "/", text: "half" });
    expect(readMarkdownListItem("- [x]glued")).toEqual({ indent: "", marker: "-", ordered: false, box: null, text: "[x]glued" });
    expect(readMarkdownListItem("1234567890. ten digits")).toBeNull();
    expect(readMarkdownListItem("-\u00a0nbsp")).toBeNull();
    expect(readMarkdownListItem("- text\r")).toBeNull();
    expect(readMarkdownListItem("-no gap")).toBeNull();
  });

  it("reads the editor's grammar: any whitespace, any length, boxes on bullets only", () => {
    expect(readMarkdownListItem("-\u00a0nbsp", EDITOR_LIST_ITEM)).toEqual({ indent: "", marker: "-", ordered: false, box: null, text: "nbsp" });
    expect(readMarkdownListItem("1234567890. ten", EDITOR_LIST_ITEM)?.marker).toBe("1234567890.");
    expect(readMarkdownListItem("1. [ ] not a box", EDITOR_LIST_ITEM)?.box).toBeNull();
    expect(readMarkdownListItem("1. [ ] a box", MARKDOWN_LIST_ITEM)?.box).toBe(" ");
    expect(readMarkdownListItem("- \r", EDITOR_LIST_ITEM)?.text).toBe("");
  });

  it("takes linear time on a line of blanks that does not end cleanly", () => {
    for (const grammar of [MARKDOWN_LIST_ITEM, EDITOR_LIST_ITEM]) {
      within(1_000, () => expect(readMarkdownListItem(`* ${" \t".repeat(N)}x\n`, grammar)).toBeNull());
      within(1_000, () => expect(readMarkdownListItem(`- [ ]${" ".repeat(N)}x\r`, grammar)).toBeNull());
    }
  });
});

describe("journal lines", () => {
  it("keeps what an entry line reads as", () => {
    expect(readJournalLine("- 09:12   \t Called the workshop")).toEqual({ seconds: 33120, task: null });
    expect(readJournalLine("- 09:12")).toEqual({ seconds: 33120, task: null });
    expect(readJournalLine("- 09:12x")).toBeNull();
    expect(readJournalLine("- 09:12:30 x")).toEqual({ seconds: 33150, task: null });
    expect(readJournalLine("- 09:12:3 x")).toBeNull();
    const journal = parseJournal("## Journal\n\n- 09:12 \t  two  \n  lines\t \n");
    expect(journal.entries[0].text).toBe("two\nlines");
  });

  it("an entry with a long run of blanks after the time", () => {
    within(1_000, () => expect(readJournalLine(`- 09:12${" \t".repeat(N)}x\u2028`)).toBeNull());
    within(1_000, () => expect(readJournalLine(`- [ ] 09:12${" ".repeat(N)}x\u2029`)).toBeNull());
  });

  it("an entry body with long runs of blanks and line breaks inside", () => {
    // The budget carries the Markdown outline parse of a 100 000-character
    // line (linear, about half a second); the old trim alone took far longer.
    const raw = `## Journal\n\n- 09:12 a${" \t".repeat(N / 2)}b\n  c${"\n".repeat(10)}`;
    within(5_000, () => expect(parseJournal(raw).entries[0].text).toBe(`a${" \t".repeat(N / 2)}b\nc`));
    within(5_000, () => expect(insertJournalEntry("## Journal\n", { time: "10:00", text: `x${" ".repeat(N)}y\n\n\n` }).ok).toBe(true));
  });
});

describe("tags in a line of source", () => {
  it("keeps what is blanked before the tags are read", () => {
    expect(findInlineTagsInLine("#a [[x #b]] ![[y #c]] [t](#d) <span #e> <!-- #f --> #g").map((t) => t.name)).toEqual(["a", "g"]);
    expect(findInlineTagsInLine("[[open #a <b #c").map((t) => t.name)).toEqual(["a", "c"]);
  });

  it("openers that never close, repeated across a long line", () => {
    for (const run of ["[[", "](", "<!--", "<a", "![["]) {
      within(1_000, () => findInlineTagsInLine(`#tag ${run.repeat(N / 4)}`));
    }
  });
});
