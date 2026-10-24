import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseMarkdownTree, type MarkdownTreeNode } from "../../../packages/core/src/markdown-parser";
import { REPO, sourceFile, sourceMap } from "./test-sourceTree";

/**
 * What the user guide marks as bold is read as bold (finding 2026-10-11).
 *
 * `**` does not open or close bold wherever it stands. CommonMark asks what
 * touches it: a marker opens in front of a letter, and in front of punctuation
 * only if a blank or punctuation stands before it; it closes by the mirrored
 * rule. A bold run that begins or ends with punctuation or a symbol — "…",
 * "：", "）", "⋮", "+" — and touches a letter on its outside therefore has a
 * marker that is neither. Japanese and Chinese set no blank between words, so
 * there it happened all over the guide; the Latin-script languages had one
 * place, an elision.
 *
 * Two things came of it, and the second leaves no trace in the text:
 *  - the asterisks stayed on the page — "エディター右上の**⋮**メニュー" on
 *    plainva.com;
 *  - a marker that could not close opened instead, and the pairs of the line
 *    matched differently from how they were written: in
 *    "**アカウントを接続…**で**Dropbox**タイル" the words between two labels
 *    were bold together with both of them, and a whole paragraph could be.
 * On 2026-10-13 that was 90 blocks of the Japanese guide, 85 of the Chinese
 * and one of the French. A blank on the outside of the run mends it, as the
 * pages already wrote it elsewhere: "右上の **⋮** メニュー".
 *
 * WHAT IT READS, AND WHAT IT DELIBERATELY DOES NOT
 * Every page of every language, with the core's own Markdown parse — the
 * same parser, with the same rule, that renders the guide on the website. It
 * fails on an asterisk that is left as text, and on bold inside bold (italic
 * inside italic): nobody writes that, so it is the sign of pairs that closed
 * elsewhere. It knows nothing about which words SHOULD be bold; a run nobody
 * marked is not its business. A literal asterisk is written `\*`.
 */

export interface EmphasisProblem {
  /** 1-based line of the page. */
  line: number;
  what: "asterisk left as text" | "bold inside bold" | "italic inside italic";
  /** The source around the place. */
  near: string;
}

/** The first asterisk of `text` between two offsets that no backslash escapes, or -1. */
function looseAsterisk(text: string, from: number, to: number): number {
  for (let i = from; i < to; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "*") return i;
  }
  return -1;
}

/** What stands around a place, within its line. */
function around(text: string, at: number): string {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const lineEnd = text.indexOf("\n", at);
  return text.slice(Math.max(lineStart, at - 16), Math.min(lineEnd < 0 ? text.length : lineEnd, at + 26));
}

/**
 * The markers of a page that were not read as the ones they were written as.
 * Exported for the fixtures at the bottom — the red counter-check of this
 * reading, kept instead of run once by hand.
 */
export function emphasisProblems(text: string): EmphasisProblem[] {
  const problems: EmphasisProblem[] = [];
  const walk = (node: MarkdownTreeNode, inBold: boolean, inItalic: boolean): void => {
    const place = node.position;
    if (node.type === "text") {
      // Code, links' addresses and comments are no text nodes: an asterisk there is left alone.
      if (!place) return;
      const at = looseAsterisk(text, place.start.offset, place.end.offset);
      if (at < 0) return;
      // A paragraph over several lines is one text node: count on to the asterisk's own line.
      const line = place.start.line + text.slice(place.start.offset, at).split("\n").length - 1;
      problems.push({ line, what: "asterisk left as text", near: around(text, at) });
      return;
    }
    if (node.type === "strong" || node.type === "emphasis") {
      const nested = node.type === "strong" ? inBold : inItalic;
      if (nested && place) {
        problems.push({ line: place.start.line, what: node.type === "strong" ? "bold inside bold" : "italic inside italic", near: around(text, place.start.offset) });
      }
      if (node.type === "strong") inBold = true;
      else inItalic = true;
    }
    for (const child of node.children ?? []) walk(child, inBold, inItalic);
  };
  walk(parseMarkdownTree(text), false, false);
  return problems;
}

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

/**
 * Reading every page takes the parser some seconds, and most runs of this
 * suite have not touched the guide: the hooks run it for a change to the
 * code. So a page that was read without a problem is remembered by its text,
 * beside the scan guards' snapshot (test-sourceTree.ts), and a later run reads
 * only the pages that changed. A verdict depends on the page and on its
 * reader, and the reader — the lockfile that pins the parser, the core's
 * parse, this file — is part of every key: a change to one of them forgets
 * everything. A page with a problem is never remembered, and a fresh
 * checkout, CI among them, remembers nothing and reads every page.
 */
export function rememberedPages(file: string, reader: string) {
  const known = new Set<string>();
  try {
    const stored = JSON.parse(readFileSync(file, "utf8")) as { reader: string; pages: string[] };
    if (stored.reader === reader) for (const key of stored.pages) known.add(key);
  } catch {
    // nothing remembered yet, or an unreadable file: every page is read
  }
  const kept = new Set<string>();
  const keyOf = (text: string) => sha1(`${reader}\n${text}`);
  return {
    /** The problems of a page; read by the parser only if this text was not read rightly before. */
    problemsOf(text: string): EmphasisProblem[] {
      const key = keyOf(text);
      if (known.has(key)) {
        kept.add(key);
        return [];
      }
      const problems = emphasisProblems(text);
      if (problems.length === 0) kept.add(key);
      return problems;
    },
    /** Writes down what this run read rightly, when that differs from what was known. */
    save(): void {
      if (kept.size === known.size && [...kept].every((key) => known.has(key))) return;
      try {
        // Written aside and renamed, so another run reads the old file or the new one, never half of one.
        mkdirSync(dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        writeFileSync(temp, JSON.stringify({ reader, pages: [...kept].sort() }));
        renameSync(temp, file);
      } catch {
        // the memory only saves time
      }
    },
  };
}

const GUIDE = "docs/user/";
const guide = sourceMap(["docs/user"], "markdown");

/** The pages by language; a page that lies beside the language folders (the index) is its own group. */
const pagesByLanguage = new Map<string, Array<{ rel: string; text: string }>>();
for (const [rel, text] of guide) {
  const inside = rel.slice(GUIDE.length);
  const language = inside.includes("/") ? inside.slice(0, inside.indexOf("/")) : "(index)";
  pagesByLanguage.set(language, [...(pagesByLanguage.get(language) ?? []), { rel, text }]);
}
const languages = [...pagesByLanguage.keys()].filter((language) => language !== "(index)");

const memory = rememberedPages(
  join(REPO, "node_modules", ".cache", "plainva-scan-guards", "guide-emphasis.json"),
  sha1([sourceFile("pnpm-lock.yaml"), sourceFile("packages/core/src/markdown-parser.ts"), sourceFile("apps/desktop/src/docsEmphasis.test.ts")].join("\n")),
);
afterAll(() => memory.save());

const HOW_TO_MEND =
  `\nA marker opens bold in front of a letter, and in front of punctuation only behind a blank or punctuation; it closes by the mirrored rule. ` +
  `Where a bold run begins or ends with punctuation or a symbol and touches a letter on its outside, set a blank there: ` +
  `"右上の **⋮** メニュー", "**アカウントを接続…** で**Dropbox**". A literal asterisk is written "\\*".`;

describe("user guide emphasis", () => {
  it("has ten languages, and pages that mark bold", () => {
    // Without this the tests below could pass by reading nothing.
    expect(languages.length).toBeGreaterThanOrEqual(10);
    for (const language of languages) {
      const pages = pagesByLanguage.get(language)!;
      expect(pages.length, language).toBeGreaterThanOrEqual(20);
      expect(pages.reduce((sum, page) => sum + page.text.split("**").length - 1, 0), language).toBeGreaterThan(1_000);
    }
  });

  // One test per language: none of them reads for long, and a failure names its language.
  for (const [language, pages] of pagesByLanguage) {
    it(`${language}: every marker is read as the one it was written as`, () => {
      const problems = pages.flatMap(({ rel, text }) => {
        // One entry per line: what follows the first marker that went wrong there is its consequence.
        const firstOfLine = new Map<number, EmphasisProblem>();
        for (const problem of memory.problemsOf(text)) if (!firstOfLine.has(problem.line)) firstOfLine.set(problem.line, problem);
        return [...firstOfLine.values()].map((problem) => `${rel}:${problem.line}  ${problem.what}: …${problem.near}…`);
      });
      expect(problems, `${problems.join("\n")}\n${HOW_TO_MEND}`).toEqual([]);
    });
  }
});

describe("user guide emphasis — the reading itself", () => {
  const whats = (text: string) => emphasisProblems(text).map((problem) => `${problem.line}: ${problem.what}`);

  it("sees asterisks that stay on the page, and none once a blank stands outside", () => {
    // The four shapes of the finding: a symbol on both sides, punctuation at the end, at the start, and a label with its colon.
    expect(whats("エディター右上の**⋮**メニュー")).toEqual(["1: asterisk left as text"]);
    expect(whats("エディター右上の **⋮** メニュー")).toEqual([]);
    expect(whats("ゴミ箱の**バージョン…**は完全な履歴を開きます")).toEqual(["1: asterisk left as text"]);
    expect(whats("ゴミ箱の**バージョン…** は完全な履歴を開きます")).toEqual([]);
    expect(whats("セクション見出しの**+ 新しいタスク**は入力欄を開きます")).toEqual(["1: asterisk left as text"]);
    expect(whats("セクション見出しの **+ 新しいタスク**は入力欄を開きます")).toEqual([]);
    expect(whats("**系统要求：**在 iPhone 和 iPad 上")).toEqual(["1: asterisk left as text"]);
    expect(whats("**系统要求：** 在 iPhone 和 iPad 上")).toEqual([]);
  });

  it("sees pairs that closed elsewhere, although no asterisk is left", () => {
    // The marker behind "…" cannot close, so it opens: "で" is bold, inside one run from the first label to the second.
    const line = "1. **クラウドアカウント** → **アカウントを接続…**で**Dropbox**タイルを選びます。";
    expect(whats(line)).toEqual(["1: bold inside bold"]);
    expect(emphasisProblems(line)[0].near).toContain("**Dropbox**");
    expect(whats(line.replace("…**で", "…** で"))).toEqual([]);
    expect(whats("*注意：*后面的*重点*。")).toEqual(["1: italic inside italic"]);
    expect(whats("*注意：* 后面的*重点*。")).toEqual([]);
  });

  it("holds for the Latin-script languages too", () => {
    // An elision: a blank behind the apostrophe would be wrong French, so the apostrophe leaves the bold.
    expect(whats("Un rappel indique désormais **ce qu'**il annonce.")).toEqual(["1: asterisk left as text"]);
    expect(whats("Un rappel indique désormais **ce qu**'il annonce.")).toEqual([]);
  });

  it("reads a table cell on its own, and names the line", () => {
    const page = ["# T", "", "A paragraph", "over two lines with**…**a marker.", "", "| a | b |", "| --- | --- |", "| 右上の**⋮**メニュー | **fine** |", ""].join("\n");
    expect(whats(page)).toEqual(["4: asterisk left as text", "8: asterisk left as text"]);
    // A marker cannot find its partner in the next cell.
    expect(whats(["| a | b |", "| --- | --- |", "| **open | shut** |"].join("\n"))).toEqual(["3: asterisk left as text", "3: asterisk left as text"]);
  });

  it("leaves alone what is no marker, and what is read rightly", () => {
    for (const fine of [
      "**Bold**, *italic*, and **bold with *italic* inside**.",
      "右上の「**⋮**」メニュー、**設定** → **保管庫**。",
      "Code keeps its asterisks: `**⋮**` and `a * b`.",
      ["```", "の**⋮**メニュー", "2 * 3", "```"].join("\n"),
      "A literal asterisk: 2 \\* 3 = 6, and \\*\\*not bold\\*\\*.",
      ["* a bullet", "* another", "", "***", "", "<!-- a comment with ** in it -->"].join("\n"),
    ]) {
      expect(whats(fine), fine).toEqual([]);
    }
    // An asterisk in running text is read as a marker that found no partner: it is written `\*`.
    expect(whats("2 * 3 = 6")).toEqual(["1: asterisk left as text"]);
  });
});

describe("user guide emphasis — what it remembers", () => {
  const temp = mkdtempSync(join(tmpdir(), "plainva-guide-emphasis-"));
  afterAll(() => rmSync(temp, { recursive: true, force: true }));
  const right = "右上の **⋮** メニュー";
  const wrong = "右上の**⋮**メニュー";

  it("keeps a page that was read rightly, for the same reader only", () => {
    const file = join(temp, "kept", "pages.json");
    const first = rememberedPages(file, "reader 1");
    expect(first.problemsOf(right)).toEqual([]);
    first.save();
    const stored = () => (JSON.parse(readFileSync(file, "utf8")) as { reader: string; pages: string[] }).pages;
    expect(stored()).toHaveLength(1);
    const key = stored()[0];

    // The same reader knows the page; what it hands out for it is still "no problem".
    const again = rememberedPages(file, "reader 1");
    expect(again.problemsOf(right)).toEqual([]);
    again.save();
    expect(stored()).toEqual([key]);

    // Another reader — a new parser, a changed rule — starts from nothing: its key for the same text is another one.
    const other = rememberedPages(file, "reader 2");
    expect(other.problemsOf(right)).toEqual([]);
    other.save();
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).not.toBe(key);
  });

  it("never keeps a page with a problem, and reads a changed page again", () => {
    const file = join(temp, "changed", "pages.json");
    const first = rememberedPages(file, "reader");
    expect(first.problemsOf(right)).toEqual([]);
    expect(first.problemsOf(wrong)).toHaveLength(1);
    first.save();
    expect((JSON.parse(readFileSync(file, "utf8")) as { pages: string[] }).pages).toHaveLength(1);

    // The page that was right is edited into the wrong one: it is read, and found.
    const second = rememberedPages(file, "reader");
    expect(second.problemsOf(wrong)).toHaveLength(1);
    expect(second.problemsOf(`${right}\n\n${wrong}`).map((problem) => problem.line)).toEqual([3]);
  });

  it("reads everything when the file is damaged", () => {
    const file = join(temp, "damaged", "pages.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ not json");
    expect(rememberedPages(file, "reader").problemsOf(wrong)).toHaveLength(1);
  });
});
