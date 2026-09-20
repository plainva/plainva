import { describe, expect, it } from "vitest";
import { APP_LANGUAGES, getVaultTemplates, journalCandidates, journalDayOf } from "@plainva/ui";
import { DEFAULT_JOURNAL_HEADING, parseJournal, scanTasks } from "@plainva/core";
import { tourLessons } from "../../../../packages/ui/src/vaultTemplates/tourLearning";

/**
 * The tour's daily notes for today and yesterday carry a journal (plan Journal,
 * J8), so the journal view of a new tour vault is not empty. What has to hold
 * in EVERY language: the heading is the literal default the setting reads
 * ("Journal" — translating it would hide the entries), the lines are entries
 * the parser reads, and the notes lie where the tour's own daily-note setting
 * makes the stream look.
 */
describe("the tour's daily notes carry a journal", () => {
  for (const { code } of APP_LANGUAGES) {
    it(`${code}: two days, read by the parser and found by the stream`, () => {
      const tour = getVaultTemplates(code).find((d) => d.id === "plainva")!;
      const folder = String(tour.settings?.dailyNotesFolder ?? "");
      expect(folder).not.toBe("");
      const today = tour.notes.find((n) => n.path === `${folder}/{{today}}.md`)!;
      const yesterday = tour.notes.find((n) => n.path === `${folder}/{{today-1}}.md`)!;

      const first = parseJournal(today.body, { heading: DEFAULT_JOURNAL_HEADING });
      expect(first.heading?.text).toBe("Journal");
      expect(first.entries.map((e) => [e.time, e.task])).toEqual([["08:40", null], ["11:15", null], ["14:05", null]]);
      expect(first.entries[2].tags).toEqual(["tour"]);
      const second = parseJournal(yesterday.body, { heading: DEFAULT_JOURNAL_HEADING });
      expect(second.entries.map((e) => [e.time, e.task])).toEqual([["09:30", "done"], ["17:50", null]]);
      // Every text is there — an untranslated or empty lesson key would show as "undefined".
      for (const entry of [...first.entries, ...second.entries]) {
        expect(entry.text.trim().length, entry.time).toBeGreaterThan(3);
        expect(entry.text).not.toContain("undefined");
      }

      // Stop 02 of the tour sends the learner to THE checkbox of today's note:
      // the journal adds no second open box there, and none anywhere else.
      expect(scanTasks(today.body).filter((t) => !t.done).map((t) => t.text)).toEqual([tourLessons(code).captureTask]);
      expect(scanTasks(yesterday.body).filter((t) => !t.done)).toEqual([]);
      // The days without a journal stay as they were.
      expect(tour.notes.find((n) => n.path === `${folder}/{{today+1}}.md`)!.body).not.toContain("## Journal");

      // Scaffolded, the notes are named by their day: the stream picks them up.
      const [candidate] = journalCandidates([`${folder}/2026-09-20.md`, `${folder}/Notes.md`], { folder, format: "YYYY-MM-DD" });
      expect(candidate.key).toBe("2026-09-20");
      expect(journalDayOf(candidate, today.body, DEFAULT_JOURNAL_HEADING)?.entries).toHaveLength(3);
    });
  }
});
