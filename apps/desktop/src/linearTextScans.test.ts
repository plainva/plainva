import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  captureVocabularyFrom,
  dailyTemplatePath,
  markdownToHtml,
  markdownToPlainText,
  parseListLine,
  parseTaskCapture,
  setCaptureWord,
} from "@plainva/ui";

/**
 * Text that arrives from anywhere — a synced note, a pasted line, a typed
 * sentence — is scanned in linear time (plan Befunde 24.09., E6). Each case
 * is the input the old pattern needed quadratic time for: a long run it could
 * split two ways, followed by something that made the match fail, so the
 * engine retried from every character of the run. A hundred thousand blanks
 * were seconds before; they are milliseconds now.
 *
 * What the functions return is pinned by their own behaviour tests
 * (taskCapture, dailyNoteCreate, listKeymap, markdownToHtml,
 * markdownToPlainText), which ran unchanged across the rewrite.
 */
const N = 100_000;
const within = (budgetMs: number, run: () => void) => {
  const start = performance.now();
  run();
  expect(performance.now() - start).toBeLessThan(budgetMs);
};

const LOCALES = join(__dirname, "../../../packages/ui/src/locales");
function englishVocabulary() {
  const tasks = JSON.parse(readFileSync(join(LOCALES, "en.json"), "utf8")).tasks as Record<string, string>;
  return captureVocabularyFrom(
    {
      today: tasks.captureToday, tomorrow: tasks.captureTomorrow, dayAfterTomorrow: tasks.captureDayAfterTomorrow,
      nextWeek: tasks.captureNextWeek, inDays: tasks.captureInDays, inWeeks: tasks.captureInWeeks,
      daily: tasks.captureDaily, weekly: tasks.captureWeekly, monthly: tasks.captureMonthly, yearly: tasks.captureYearly,
      every: tasks.captureEvery, everyNDays: tasks.captureEveryNDays, everyNWeeks: tasks.captureEveryNWeeks,
      oclock: tasks.captureOclock, at: tasks.captureAt,
    },
    "en",
    tasks.captureWeekdays,
  );
}

describe("W1: trimming at the edges", () => {
  it("a capture sentence with a long run of separators inside", () => {
    const vocabulary = englishVocabulary();
    let title = "";
    within(2_000, () => { title = parseTaskCapture(`Report${" ,".repeat(N / 2)} draft`, vocabulary, "2026-09-24").title; });
    expect(title.startsWith("Report ,")).toBe(true);
    expect(title.endsWith(", draft")).toBe(true);
  });

  it("a quick button writing after a long run of blanks", () => {
    const input = `Call${" ".repeat(N)}x`;
    let next = "";
    within(1_000, () => { next = setCaptureWord(input, { title: "", due: null, minutes: null, priority: 0, tags: [], repeat: null, bricks: [] }, "priority", "!!"); });
    expect(next).toBe(`${input} !!`);
  });

  it("a template folder with a long run of slashes inside", () => {
    within(1_000, () => expect(dailyTemplatePath({ templateFolder: `a${"/".repeat(N)}b//`, template: "Daily" })).toBe(`a${"/".repeat(N)}b/Daily`));
  });
});

describe("W2: one list reader for the editor and both copies", () => {
  const hostile = [`* ${" ".repeat(N)}x\n`, `- ${" \t".repeat(N / 2)}x\r`, `1. [ ]${"\t".repeat(N)}x\r`, `* [x]${" ".repeat(N)}x\u2028`];

  it("the editor's list continuation", () => {
    for (const line of hostile) within(1_000, () => expect(parseListLine(line)).toBeNull());
  });

  it("copy as plain text and as HTML", () => {
    for (const line of hostile) {
      within(1_000, () => markdownToPlainText(line));
      within(1_000, () => markdownToHtml(line));
    }
  });
});
