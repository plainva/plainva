import { describe, expect, it } from "vitest";
import {
  JOURNAL_WINDOW_DAYS,
  JOURNAL_WINDOW_READS,
  NO_JOURNAL_FILTER,
  entryMatches,
  formatJournalTime,
  isJournalFiltered,
  journalCandidates,
  journalDayOf,
  journalTags,
  loadJournalWindow,
  newestFirst,
  withJournalDay,
} from "@plainva/ui";
import { parseJournal } from "@plainva/core";

/** Plan Journal, J5: the stream over all days, as a pure model. */

const SETTINGS = { folder: "Journal", format: "YYYY-MM-DD" };
const pad = (n: number) => String(n).padStart(2, "0");
const pathOf = (day: number) => `Journal/2026-09-${pad(day)}.md`;

function vaultOf(days: Record<number, string>) {
  const files = new Map(Object.entries(days).map(([day, raw]) => [pathOf(Number(day)), raw]));
  const reads: string[] = [];
  return {
    paths: [...files.keys(), "Notes/2026-09-20.md", "Journal/not-a-date.md", "Journal/2026-09.md"],
    reads,
    read: async (path: string) => {
      reads.push(path);
      const raw = files.get(path);
      if (raw === undefined) throw new Error("gone");
      return raw;
    },
  };
}

describe("journalCandidates", () => {
  it("picks the daily notes out of all notes, newest day first", () => {
    const vault = vaultOf({ 3: "", 21: "", 12: "" });
    expect(journalCandidates(vault.paths, SETTINGS).map((c) => c.key)).toEqual(["2026-09-21", "2026-09-12", "2026-09-03"]);
  });

  it("follows the vault's own format and the root folder", () => {
    const found = journalCandidates(["26.09.20.md", "Journal/26.09.19.md", "2026-09-20.md"], { folder: "", format: "YY.MM.DD" });
    expect(found.map((c) => c.path)).toEqual(["26.09.20.md"]);
  });
});

describe("loadJournalWindow", () => {
  it("fills a window with the newest days that HAVE entries and says where it stopped", async () => {
    const days: Record<number, string> = {};
    for (let d = 1; d <= 30; d++) days[d] = d % 2 ? `## Journal\n- 08:00 day ${d}\n` : "# nothing here\n";
    const vault = vaultOf(days);
    const candidates = journalCandidates(vault.paths, SETTINGS);
    const first = await loadJournalWindow(candidates, null, vault.read, "Journal");
    expect(first.days).toHaveLength(JOURNAL_WINDOW_DAYS);
    expect(first.days[0].key).toBe("2026-09-29");
    expect(first.more).toBe(true);
    // 14 days with entries = 28 notes read, from the 30th down to the 3rd.
    expect(vault.reads).toHaveLength(28);
    const second = await loadJournalWindow(candidates, first.through, vault.read, "Journal");
    expect(second.days.map((d) => d.key)).toEqual(["2026-09-01"]);
    expect(second.more).toBe(false);
  });

  it("stops reading after a bounded number of notes, entries or not", async () => {
    const paths: string[] = [];
    for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d++) paths.push(`Journal/2025-${pad(m)}-${pad(d)}.md`);
    let reads = 0;
    const window = await loadJournalWindow(journalCandidates(paths, SETTINGS), null, async () => { reads++; return "# empty\n"; }, "Journal");
    expect(reads).toBe(JOURNAL_WINDOW_READS);
    expect(window.days).toEqual([]);
    expect(window.more).toBe(true);
  });

  it("is not thrown off by a daily note that appears later", async () => {
    const vault = vaultOf({ 20: "## Journal\n- 08:00 a\n", 10: "## Journal\n- 08:00 b\n" });
    const before = journalCandidates(vault.paths, SETTINGS);
    const first = await loadJournalWindow(before.slice(0, 1), null, vault.read, "Journal");
    // The 15th syncs in from another device before "load older" is pressed.
    const later = journalCandidates([...vault.paths, pathOf(25), pathOf(15)], SETTINGS);
    const files = new Map([[pathOf(15), "## Journal\n- 09:00 synced in\n"], [pathOf(10), "## Journal\n- 08:00 b\n"]]);
    const second = await loadJournalWindow(later, first.through, async (p) => files.get(p) ?? "", "Journal");
    expect(second.days.map((d) => d.key)).toEqual(["2026-09-15", "2026-09-10"]);
  });

  it("skips a note that cannot be read", async () => {
    const vault = vaultOf({ 20: "## Journal\n- 08:00 a\n" });
    const candidates = journalCandidates([...vault.paths, pathOf(21)], SETTINGS);
    const window = await loadJournalWindow(candidates, null, vault.read, "Journal");
    expect(window.days.map((d) => d.key)).toEqual(["2026-09-20"]);
  });

  it("applies the filter while reading, so a window holds matching days", async () => {
    const vault = vaultOf({ 20: "## Journal\n- 08:00 plain\n- [ ] 09:00 a task #client\n", 19: "## Journal\n- 08:00 nothing to do\n" });
    const window = await loadJournalWindow(journalCandidates(vault.paths, SETTINGS), null, vault.read, "Journal", { ...NO_JOURNAL_FILTER, tasksOnly: true });
    expect(window.days.map((d) => [d.key, d.entries.map((e) => e.text)])).toEqual([["2026-09-20", ["a task #client"]]]);
  });
});

describe("filters", () => {
  const [plain, task, nested] = parseJournal("## Journal\n- 08:00 Café am Kanal\n- [x] 09:30 Angebot #kunde/vogt\n- 10:00 second line\n  with Über-Text\n").entries;

  it("matches every word, whatever the case and the accents", () => {
    expect(entryMatches(plain, { ...NO_JOURNAL_FILTER, text: "cafe KANAL" })).toBe(true);
    expect(entryMatches(plain, { ...NO_JOURNAL_FILTER, text: "cafe hafen" })).toBe(false);
    expect(entryMatches(nested, { ...NO_JOURNAL_FILTER, text: "uber" })).toBe(true);
    expect(entryMatches(task, { ...NO_JOURNAL_FILTER, text: "09:30" })).toBe(true);
  });

  it("matches a tag and its children, and tasks only on request", () => {
    expect(entryMatches(task, { ...NO_JOURNAL_FILTER, tag: "kunde" })).toBe(true);
    expect(entryMatches(task, { ...NO_JOURNAL_FILTER, tag: "Kunde/Vogt" })).toBe(true);
    expect(entryMatches(task, { ...NO_JOURNAL_FILTER, tag: "kun" })).toBe(false);
    expect(entryMatches(plain, { ...NO_JOURNAL_FILTER, tasksOnly: true })).toBe(false);
    expect(entryMatches(task, { ...NO_JOURNAL_FILTER, tasksOnly: true })).toBe(true);
  });

  it("knows when nothing is filtered", () => {
    expect(isJournalFiltered(NO_JOURNAL_FILTER)).toBe(false);
    expect(isJournalFiltered({ ...NO_JOURNAL_FILTER, text: "  " })).toBe(false);
    expect(isJournalFiltered({ ...NO_JOURNAL_FILTER, tag: "x" })).toBe(true);
  });
});

describe("the stream after a change", () => {
  const candidate = (day: number) => journalCandidates([pathOf(day)], SETTINGS)[0];
  const dayOf = (day: number, raw: string) => journalDayOf(candidate(day), raw, "Journal")!;

  it("puts a changed day in its place and takes an emptied one out", () => {
    const days = [dayOf(21, "## Journal\n- 08:00 a\n"), dayOf(19, "## Journal\n- 08:00 c\n")];
    const added = withJournalDay(days, candidate(20), dayOf(20, "## Journal\n- 08:00 b\n"));
    expect(added.map((d) => d.key)).toEqual(["2026-09-21", "2026-09-20", "2026-09-19"]);
    const replaced = withJournalDay(added, candidate(20), dayOf(20, "## Journal\n- 08:00 b\n- 09:00 b2\n"));
    expect(replaced[1].entries).toHaveLength(2);
    expect(withJournalDay(replaced, candidate(20), null).map((d) => d.key)).toEqual(["2026-09-21", "2026-09-19"]);
  });

  it("has no day without entries", () => {
    expect(journalDayOf(candidate(20), "# a daily note without a journal\n", "Journal")).toBeNull();
    expect(journalDayOf(candidate(20), "## Memos\n- 08:00 x\n", "Memos")?.entries).toHaveLength(1);
  });

  it("offers the most frequent tags and shows the newest entry first", () => {
    const days = [dayOf(21, "## Journal\n- 08:00 a #x #y\n- 09:00 b #y\n"), dayOf(20, "## Journal\n- 10:00 c #y #z\n")];
    expect(journalTags(days)).toEqual(["y", "x", "z"]);
    expect(newestFirst(days[0].entries).map((e) => e.time)).toEqual(["09:00", "08:00"]);
  });

  it("shows the time in the clock of the language, seconds only where the entry has them", () => {
    const [short, long] = parseJournal("## Journal\n- 14:05 a\n- 14:05:09 b\n").entries;
    expect(formatJournalTime(short, "de")).toBe("14:05");
    expect(formatJournalTime(long, "de")).toBe("14:05:09");
    expect(formatJournalTime(short, "en-US")).toMatch(/^02:05\sPM$/);
  });
});
