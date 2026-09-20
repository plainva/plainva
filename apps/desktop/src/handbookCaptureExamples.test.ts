import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { captureVocabularyFrom, parseTaskCapture, type CaptureVocabulary } from "@plainva/ui";

/**
 * The handbook shows one capture sentence per language — "Send offer tomorrow
 * 2pm !!! #client weekly". A translated example is a claim about the parser: it
 * says "type this and Plainva understands it". This guard types every example
 * of every language folder into the real grammar, with the words that
 * language's locale file carries, and fails the page that promises more than
 * the app keeps.
 */

const DOCS = join(__dirname, "../../../docs/user");
const LOCALES = join(__dirname, "../../../packages/ui/src/locales");
const MARKER = "<!-- planner-capture-2026-09-20 -->";
// A Monday; "tomorrow" is the 22nd in every language.
const TODAY = "2026-09-21";
const TOMORROW = "2026-09-22";

const languages = readdirSync(DOCS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

function vocab(lang: string): CaptureVocabulary {
  const tasks = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8")).tasks as Record<string, string>;
  return captureVocabularyFrom(
    {
      today: tasks.captureToday, tomorrow: tasks.captureTomorrow, dayAfterTomorrow: tasks.captureDayAfterTomorrow,
      nextWeek: tasks.captureNextWeek, inDays: tasks.captureInDays, inWeeks: tasks.captureInWeeks,
      daily: tasks.captureDaily, weekly: tasks.captureWeekly, monthly: tasks.captureMonthly, yearly: tasks.captureYearly,
      every: tasks.captureEvery, everyNDays: tasks.captureEveryNDays, everyNWeeks: tasks.captureEveryNWeeks,
      oclock: tasks.captureOclock, at: tasks.captureAt,
    },
    lang,
    tasks.captureWeekdays,
  );
}

/** The code spans of the section the planner round added to a page. */
function spans(lang: string, page: string): string[] {
  const text = readFileSync(join(DOCS, lang, page), "utf8");
  const at = text.indexOf(MARKER);
  expect(at, `${lang}/${page} carries the planner section`).toBeGreaterThan(-1);
  return [...text.slice(at).matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

const isSentence = (span: string) => /\s!{2,3}(\s|$)/.test(span);

describe("the capture examples of the handbook, typed into the real grammar", () => {
  it("covers all ten language folders", () => {
    expect(languages.length).toBe(10);
  });

  for (const lang of languages) {
    it(`${lang}: every example sentence comes out as the page says`, () => {
      const words = vocab(lang);
      for (const page of ["Tasks.md", "Mobile_App.md", "Getting_Started.md"]) {
        const sentences = spans(lang, page).filter(isSentence);
        expect(sentences.length, `${lang}/${page} shows an example sentence`).toBeGreaterThan(0);
        for (const sentence of sentences) {
          const got = parseTaskCapture(sentence, words, TODAY);
          const marks = /\s(!{2,3})(\s|$)/.exec(sentence)![1].length;
          const where = `${lang}/${page}: ${sentence}`;
          expect(got.due, `${where} — "tomorrow"`).toBe(TOMORROW);
          expect(got.minutes, `${where} — the time`).not.toBeNull();
          expect(got.priority, `${where} — the priority`).toBe(marks === 3 ? 1 : 2);
          expect(got.title, `${where} — the title keeps no recognised word`).not.toMatch(/[0-9!#]/);
          expect(got.title.trim().length, `${where} — a title is left`).toBeGreaterThan(2);
          if (sentence.includes("#")) expect(got.tags.length, `${where} — the tag`).toBe(1);
          if (page === "Tasks.md") expect(got.repeat && [got.repeat.freq, got.repeat.interval], `${where} — "weekly"`).toEqual(["weekly", 1]);
        }
      }
    });

    it(`${lang}: every spelling of a time the page lists is understood`, () => {
      const words = vocab(lang);
      const times = spans(lang, "Tasks.md").filter((span) => /\d/.test(span) && !isSentence(span) && !/[[\]T!-]/.test(span) && !span.includes("remind"));
      expect(times.length, `${lang}/Tasks.md lists time spellings`).toBeGreaterThan(1);
      for (const time of times) {
        const got = parseTaskCapture(`Plainva ${time}`, words, TODAY);
        expect(got.minutes, `${lang}/Tasks.md: "${time}" is a time`).not.toBeNull();
        expect(got.title).toBe("Plainva");
      }
    });
  }
});
