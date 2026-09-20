import { describe, expect, it } from "vitest";
import {
  insertJournalEntry,
  journalTimeOf,
  normalizeJournalHeading,
  parseJournal,
  readJournalLine,
  removeJournalEntry,
  replaceJournalEntry,
  restoreJournalEntry,
  setJournalEntryTask,
  toggleJournalTask,
} from "../src/journal.js";

/** Lines with their line endings, so a comparison sees every byte. */
const pieces = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/**
 * The rule of the project: an insert ADDS lines and changes none. Every line of
 * the note comes back byte for byte and in order; what is new is the entry, a
 * blank line, or the heading. The one allowed difference: a note that ended
 * without a line break lends its last line one.
 */
function expectOnlyAdded(before: string, after: string, allowed: (line: string) => boolean) {
  const was = pieces(before), now = pieces(after);
  let at = 0;
  for (const piece of now) {
    const old = was[at];
    if (old !== undefined && (piece === old || (at === was.length - 1 && !/\n$/.test(old) && piece.replace(/\r?\n$/, "") === old))) { at++; continue; }
    expect(allowed(piece.replace(/\r?\n$/, "")), `unexpected new line ${JSON.stringify(piece)}`).toBe(true);
  }
  expect(at, "every line of the note is still there").toBe(was.length);
}

const added = (entry: string[], heading = "## Journal") => (line: string) => line === "" || line === heading || entry.includes(line);

function insertOk(raw: string, insert: Parameters<typeof insertJournalEntry>[1]) {
  const result = insertJournalEntry(raw, insert);
  if (!result.ok) throw new Error(`insert refused: ${result.reason}`);
  return result;
}

describe("parseJournal", () => {
  it("reads what Thino writes: plain entries and task entries under the heading", () => {
    const raw = "# 2026-09-20\n\n# Journal\n\n- 09:12 Called the workshop\n- [ ] 10:30 Send the offer #client\n- [x] 11:00 Paid the invoice\n\n# Notes\n\n- 12:00 not a journal line\n";
    const journal = parseJournal(raw);
    expect(journal.heading).toEqual({ line: 2, level: 1, text: "Journal" });
    expect(journal.entries.map((e) => [e.time, e.text, e.task, e.line])).toEqual([
      ["09:12", "Called the workshop", null, 4],
      ["10:30", "Send the offer #client", "open", 5],
      ["11:00", "Paid the invoice", "done", 6],
    ]);
    expect(journal.entries[1].tags).toEqual(["client"]);
  });

  it("reads what Knomo writes: seconds, under its own heading", () => {
    const raw = "## Memos\n- 08:01:59 First thought\n- 23:59:00 Last thought\n";
    const journal = parseJournal(raw, { heading: "Memos" });
    expect(journal.entries.map((e) => [e.time, e.seconds])).toEqual([["08:01:59", 8 * 3600 + 119], ["23:59:00", 23 * 3600 + 59 * 60]]);
    expect(parseJournal(raw).entries).toEqual([]);
  });

  it("finds the heading by its text, on every level and in any case", () => {
    for (let level = 1; level <= 6; level++) {
      const raw = `${"#".repeat(level)} JOURNAL\n- 07:00 up\n`;
      const journal = parseJournal(raw, { heading: "journal" });
      expect(journal.heading?.level).toBe(level);
      expect(journal.entries).toHaveLength(1);
    }
    expect(parseJournal("Journal\n=======\n\n- 07:00 up\n").entries).toHaveLength(1);
    expect(parseJournal("## **Journal**\n- 07:00 up\n").entries).toHaveLength(1);
  });

  it("ends the section at the next heading of the same or a higher level, not at a lower one", () => {
    const raw = "## Journal\n- 07:00 one\n### Afternoon\n- 15:00 two\n## Other\n- 16:00 three\n";
    expect(parseJournal(raw).entries.map((e) => e.text)).toEqual(["one", "two"]);
  });

  it("keeps a line inside a code fence out, however much it looks like an entry", () => {
    const raw = "## Journal\n- 07:00 real\n\n```\n- 08:00 inside a fence\n```\n\n- 09:00 real again\n";
    expect(parseJournal(raw).entries.map((e) => e.text)).toEqual(["real", "real again"]);
  });

  it("does not let a heading inside an entry end the section", () => {
    const raw = "## Journal\n- 07:00 notes\n  # looks like a heading\n- 08:00 after\n";
    const entries = parseJournal(raw).entries;
    expect(entries.map((e) => e.time)).toEqual(["07:00", "08:00"]);
    expect(entries[0].text).toBe("notes\n# looks like a heading");
  });

  it("reads continuation lines, dedented, and leaves blank lines after the entry out", () => {
    const raw = "## Journal\n- 07:00 first line\n  second line\n\n  a paragraph of its own\n\n- 08:00 next\n";
    const [first, second] = parseJournal(raw).entries;
    expect(first.text).toBe("first line\nsecond line\n\na paragraph of its own");
    expect([first.line, first.lineCount]).toEqual([1, 4]);
    expect(first.source).toEqual(["- 07:00 first line", "  second line", "", "  a paragraph of its own"]);
    expect(second.line).toBe(6);
  });

  it("reads the two states other tools write, other bullets and a single-digit hour", () => {
    const raw = "## Journal\n* [/] 9:05 in progress\n* [-] 10:00 cancelled\n";
    expect(parseJournal(raw).entries.map((e) => [e.task, e.seconds])).toEqual([["progress", 9 * 3600 + 300], ["cancelled", 36000]]);
  });

  it("ignores what is not an entry: no time, an impossible time, nested or quoted lines", () => {
    const raw = "## Journal\n- no time here\n- 25:00 impossible\n- 12:61 impossible too\n- a list\n  - 13:00 nested\n> - 14:00 quoted\n1. 15:00 numbered\n- 16:00x no gap\n";
    expect(parseJournal(raw).entries).toEqual([]);
  });

  it("reads CRLF notes and notes with frontmatter", () => {
    const raw = "---\r\ntitle: \"- 07:00 not an entry\"\r\n---\r\n\r\n## Journal\r\n\r\n- 07:00 one\r\n- 08:00 two\r\n  more\r\n";
    const entries = parseJournal(raw).entries;
    expect(entries.map((e) => e.text)).toEqual(["one", "two\nmore"]);
    expect(entries[1].source).toEqual(["- 08:00 two", "  more"]);
  });

  it("takes comment anchors out of the text and leaves them in the source", () => {
    const raw = "## Journal\n- 07:00 a <!--pv#0a1b-->marked<!--/pv#0a1b--> word\n- 08:00 next\n";
    const [entry, next] = parseJournal(raw).entries;
    expect(entry.text).toBe("a marked word");
    expect(entry.source).toEqual(["- 07:00 a <!--pv#0a1b-->marked<!--/pv#0a1b--> word"]);
    expect(next.line).toBe(2);
  });
});

describe("insertJournalEntry", () => {
  it("appends at the end of the section, in front of the blank lines that close it", () => {
    const raw = "# Day\n\n## Journal\n\n- 09:12 first\n\n## Notes\n\ntext\n";
    const result = insertOk(raw, { time: "10:30", text: "second" });
    expect(result.content).toBe("# Day\n\n## Journal\n\n- 09:12 first\n- 10:30 second\n\n## Notes\n\ntext\n");
    expect(result.entry).toMatchObject({ line: 5, time: "10:30", text: "second", task: null });
    expect(result.createdHeading).toBe(false);
    expectOnlyAdded(raw, result.content, added(["- 10:30 second"]));
  });

  it("creates a missing heading at the end of the note, exactly one blank line away", () => {
    for (const raw of ["# Day\n\nSome text\n", "# Day\n\nSome text", "# Day\n\nSome text\n\n", "# Day\n\nSome text\n\n\n\n"]) {
      const result = insertOk(raw, { time: "08:00", text: "hello" });
      expect(result.createdHeading).toBe(true);
      expect(result.content).toContain("Some text\n\n## Journal\n\n- 08:00 hello");
      expect(result.content.endsWith("\n")).toBe(raw.endsWith("\n"));
      expectOnlyAdded(raw, result.content, added(["- 08:00 hello"]));
      expect(parseJournal(result.content).entries).toHaveLength(1);
    }
  });

  it("writes into an empty note and under frontmatter that is all the note has", () => {
    expect(insertOk("", { time: "08:00", text: "hello" }).content).toBe("## Journal\n\n- 08:00 hello\n");
    const raw = "---\ntitle: Day\n---\n";
    const result = insertOk(raw, { time: "08:00", text: "hello" });
    expect(result.content).toBe("---\ntitle: Day\n---\n\n## Journal\n\n- 08:00 hello\n");
    expectOnlyAdded(raw, result.content, added(["- 08:00 hello"]));
  });

  it("uses the configured heading, also for the one it creates", () => {
    const result = insertOk("text\n", { heading: "## Tagebuch ", time: "08:00", text: "hallo" });
    expect(result.content).toBe("text\n\n## Tagebuch\n\n- 08:00 hallo\n");
    expect(parseJournal(result.content, { heading: "tagebuch" }).entries).toHaveLength(1);
  });

  it("fills an empty section with a blank line on either side", () => {
    expect(insertOk("## Journal\n## Notes\n", { time: "08:00", text: "x" }).content).toBe("## Journal\n\n- 08:00 x\n\n## Notes\n");
    expect(insertOk("## Journal\n\n## Notes\n", { time: "08:00", text: "x" }).content).toBe("## Journal\n\n- 08:00 x\n\n## Notes\n");
    expect(insertOk("## Journal\n\n\n## Notes\n", { time: "08:00", text: "x" }).content).toBe("## Journal\n\n- 08:00 x\n\n## Notes\n");
    expect(insertOk("## Journal", { time: "08:00", text: "x" }).content).toBe("## Journal\n\n- 08:00 x");
    expect(insertOk("## Journal\n", { time: "08:00", text: "x" }).content).toBe("## Journal\n\n- 08:00 x\n");
  });

  it("keeps a section at the end of the file without a line break that way", () => {
    const raw = "## Journal\n- 09:00 first";
    const result = insertOk(raw, { time: "10:00", text: "second" });
    expect(result.content).toBe("## Journal\n- 09:00 first\n- 10:00 second");
    expectOnlyAdded(raw, result.content, added(["- 10:00 second"]));
  });

  it("keeps CRLF, line by line", () => {
    const raw = "---\r\ntitle: Day\r\n---\r\n## Journal\r\n- 09:00 first\r\n\r\n## Notes\r\n";
    const result = insertOk(raw, { time: "10:00", text: "second\nwith a second line" });
    expect(result.content).toBe("---\r\ntitle: Day\r\n---\r\n## Journal\r\n- 09:00 first\r\n- 10:00 second\r\n  with a second line\r\n\r\n## Notes\r\n");
    expectOnlyAdded(raw, result.content, added(["- 10:00 second", "  with a second line"]));
    expect(result.entry.text).toBe("second\nwith a second line");
  });

  it("writes several lines as indented continuation lines, a blank one stays blank", () => {
    const result = insertOk("## Journal\n", { time: "10:00", text: "  one \n\ntwo\n   \n" });
    expect(result.content).toBe("## Journal\n\n- 10:00 one\n\n  two\n");
    expect(result.entry.text).toBe("one\n\ntwo");
  });

  it("leaves a text that starts like Markdown structure a text", () => {
    for (const text of ["# not a heading", "- not a list", "[ ] not a box", "> not a quote", "12:00 not a second time"]) {
      const result = insertOk("## Journal\n- 09:00 first\n", { time: "10:00", text });
      expect(result.entry.text).toBe(text);
      expect(result.entry.task).toBeNull();
      expect(parseJournal(result.content).entries).toHaveLength(2);
    }
  });

  it("writes a task entry on request", () => {
    const result = insertOk("## Journal\n", { time: "10:00", text: "call back", task: "open" });
    expect(result.content).toBe("## Journal\n\n- [ ] 10:00 call back\n");
    expect(result.entry.task).toBe("open");
  });

  it("continues the list the way the note writes it: its bullet, its blank lines", () => {
    expect(insertOk("## Journal\n* 09:00 a\n", { time: "10:00", text: "b" }).content).toBe("## Journal\n* 09:00 a\n* 10:00 b\n");
    const loose = "## Journal\n\n- 09:00 a\n\n- 09:30 b\n";
    expect(insertOk(loose, { time: "10:00", text: "c" }).content).toBe("## Journal\n\n- 09:00 a\n\n- 09:30 b\n\n- 10:00 c\n");
  });

  it("sets a blank line between running text and the entry", () => {
    const raw = "## Journal\nA few words first.\n";
    const result = insertOk(raw, { time: "10:00", text: "b" });
    expect(result.content).toBe("## Journal\nA few words first.\n\n- 10:00 b\n");
  });

  it("goes under the heading when the end of the section would swallow the entry", () => {
    const raw = "## Journal\n\n- 09:00 a\n\n```\nnever closed\n";
    const result = insertOk(raw, { time: "10:00", text: "b" });
    expect(parseJournal(result.content).entries.map((e) => e.text)).toEqual(["b", "a"]);
    expectOnlyAdded(raw, result.content, added(["- 10:00 b"]));
  });

  it("refuses rather than writing where it cannot be read", () => {
    expect(insertJournalEntry("text\n\n```\nnever closed\n", { time: "10:00", text: "b" })).toEqual({ ok: false, reason: "unplaceable" });
    expect(insertJournalEntry("## Journal\n", { time: "10:00", text: "  \n " })).toEqual({ ok: false, reason: "empty" });
    expect(insertJournalEntry("## Journal\n", { time: "24:00", text: "x" })).toEqual({ ok: false, reason: "time" });
    expect(insertJournalEntry("## Journal\n", { time: "noon", text: "x" })).toEqual({ ok: false, reason: "time" });
  });

  it("holds the property for a table of notes: the entry is there, nothing else moved", () => {
    const notes = [
      "", "\n", "text", "text\n", "# Journal", "# Journal\n\n", "## Journal\n- 01:00 a\n- 02:00 b",
      "---\na: 1\n---\n# Day\n\n## Journal\n\n- 01:00 a\n  more\n\n## Later\n\ntext\n",
      "## Journal\r\n\r\n- 01:00 a\r\n", "## Journal\n\n| a | b |\n|---|---|\n| 1 | 2 |\n", "## Journal\n> quote\n", "## Journal\n\n1. numbered\n",
      "## Journal\n- 01:00 a\n\n\n\n", "intro\n\n## Journal\n\n### Morning\n- 01:00 a\n\n## Notes\n",
    ];
    for (const raw of notes) {
      const result = insertOk(raw, { time: "23:59", text: "the new one\nsecond line" });
      const entries = parseJournal(result.content).entries;
      expect(entries.some((e) => e.time === "23:59" && e.text === "the new one\nsecond line"), JSON.stringify(raw)).toBe(true);
      expect(entries.length).toBe(parseJournal(raw).entries.length + 1);
      expectOnlyAdded(raw, result.content, added(["- 23:59 the new one", "  second line"]));
    }
  });
});

describe("editing an entry", () => {
  const raw = "## Journal\n\n- 09:00 first\n*   [ ] 10:00 second #tag\n    with more\n- 11:00 third\n\n## Notes\n";

  it("replaces the text and keeps marker, box, time and indent as written", () => {
    const entry = parseJournal(raw).entries[1];
    const result = replaceJournalEntry(raw, entry, { text: "rewritten\nin two lines" });
    expect(result.ok && result.content).toBe("## Journal\n\n- 09:00 first\n*   [ ] 10:00 rewritten\n    in two lines\n- 11:00 third\n\n## Notes\n");
    expect(result.ok && result.entry.task).toBe("open");
  });

  it("takes a new time on request and refuses an impossible one", () => {
    const entry = parseJournal(raw).entries[0];
    const result = replaceJournalEntry(raw, entry, { text: "first", time: "08:45" });
    expect(result.ok && result.content.includes("- 08:45 first\n")).toBe(true);
    expect(replaceJournalEntry(raw, entry, { text: "first", time: "8h" })).toEqual({ ok: false, reason: "time" });
    expect(replaceJournalEntry(raw, entry, { text: " " })).toEqual({ ok: false, reason: "empty" });
  });

  it("finds the entry again after lines were added above it", () => {
    const entry = parseJournal(raw).entries[2];
    const moved = "# A new title\n\n" + raw;
    const result = replaceJournalEntry(moved, entry, { text: "found" });
    expect(result.ok && result.content).toBe(moved.replace("- 11:00 third", "- 11:00 found"));
    expect(replaceJournalEntry(raw.replace("third", "changed elsewhere"), entry, { text: "x" })).toEqual({ ok: false, reason: "missing" });
  });

  it("keeps CRLF and a missing final line break when replacing", () => {
    const crlf = "## Journal\r\n- 09:00 a\r\n- 10:00 b";
    const entry = parseJournal(crlf).entries[1];
    const result = replaceJournalEntry(crlf, entry, { text: "b2\nmore" });
    expect(result.ok && result.content).toBe("## Journal\r\n- 09:00 a\r\n- 10:00 b2\r\n  more");
  });

  it("turns an entry into a task and back without touching the rest of the line", () => {
    const entries = parseJournal(raw).entries;
    const made = setJournalEntryTask(raw, entries[0], "open");
    expect(made.ok && made.content).toBe(raw.replace("- 09:00 first", "- [ ] 09:00 first"));
    const cancelled = setJournalEntryTask(raw, entries[1], "cancelled");
    expect(cancelled.ok && cancelled.content).toBe(raw.replace("*   [ ] 10:00", "*   [-] 10:00"));
    const plain = setJournalEntryTask(raw, entries[1], null);
    expect(plain.ok && plain.content).toBe(raw.replace("*   [ ] 10:00", "*   10:00"));
    expect(plain.ok && plain.entry.task).toBeNull();
  });

  it("ticks a task entry the way the task view does, completion date included", () => {
    const note = "## Journal\n- [ ] 10:00 pay 📅 2026-09-21\n- [/] 11:00 draft\n- [-] 12:00 dropped\n- 13:00 plain\n";
    const entries = parseJournal(note).entries;
    const done = toggleJournalTask(note, entries[0], { today: "2026-09-20" });
    expect(done.ok && done.content).toContain("- [x] 10:00 pay 📅 2026-09-21 ✅ 2026-09-20\n");
    expect(done.ok && done.entry.task).toBe("done");
    const finished = toggleJournalTask(note, entries[1], { today: "2026-09-20" });
    expect(finished.ok && finished.entry.task).toBe("done");
    const reopened = toggleJournalTask(note, entries[2], { today: "2026-09-20" });
    expect(reopened.ok && reopened.entry.task).toBe("open");
    expect(toggleJournalTask(note, entries[3])).toEqual({ ok: false, reason: "missing" });
  });

  it("follows a repeating task entry below the successor it writes", () => {
    const note = "## Journal\n- [ ] 10:00 water the plants 🔁 every day 📅 2026-09-20\n";
    const result = toggleJournalTask(note, parseJournal(note).entries[0], { today: "2026-09-20", newId: () => "abc" });
    expect(result.ok && result.entry.task).toBe("done");
    expect(result.ok && result.entry.line).toBe(2);
    expect(result.ok && parseJournal(result.content).entries.map((e) => e.task)).toEqual(["open", "done"]);
  });
});

describe("removing and restoring", () => {
  it("removes the entry with its continuation lines and nothing else", () => {
    const raw = "## Journal\n- 09:00 a\n- 10:00 b\n  more\n- 11:00 c\n";
    const result = removeJournalEntry(raw, parseJournal(raw).entries[1]);
    expect(result.ok && result.content).toBe("## Journal\n- 09:00 a\n- 11:00 c\n");
    expect(result.ok && result.removed.text).toBe("b\nmore");
  });

  it("takes the blank line in front along when blank lines surround the entry", () => {
    const loose = "## Journal\n\n- 09:00 a\n\n- 10:00 b\n\n- 11:00 c\n";
    const result = removeJournalEntry(loose, parseJournal(loose).entries[1]);
    expect(result.ok && result.content).toBe("## Journal\n\n- 09:00 a\n\n- 11:00 c\n");
    const only = "## Journal\n\n- 09:00 a\n\n## Notes\n";
    const emptied = removeJournalEntry(only, parseJournal(only).entries[0]);
    expect(emptied.ok && emptied.content).toBe("## Journal\n\n## Notes\n");
  });

  it("undoes an insert byte for byte", () => {
    for (const raw of ["## Journal\n- 09:00 a\n", "## Journal\n- 09:00 a", "## Journal\r\n- 09:00 a\r\n", "## Journal\n\n- 09:00 a\n\n- 09:30 b\n\n## Notes\n"]) {
      const inserted = insertOk(raw, { time: "10:00", text: "b\nmore" });
      const removed = removeJournalEntry(inserted.content, inserted.entry);
      expect(removed.ok && removed.content, JSON.stringify(raw)).toBe(raw);
    }
  });

  it("puts a removed entry back where its time belongs, spelled as it was", () => {
    const raw = "## Journal\n- 09:00 a\n* [x] 10:00:30 b\n  more\n- 11:00 c\n";
    const entry = parseJournal(raw).entries[1];
    const removed = removeJournalEntry(raw, entry);
    if (!removed.ok) throw new Error("remove failed");
    const restored = restoreJournalEntry(removed.content, removed.removed);
    expect(restored.ok && restored.content).toBe(raw);
    const first = parseJournal(raw).entries[0];
    const withoutFirst = removeJournalEntry(raw, first);
    if (!withoutFirst.ok) throw new Error("remove failed");
    const back = restoreJournalEntry(withoutFirst.content, withoutFirst.removed);
    expect(back.ok && back.content).toBe(raw);
  });

  it("restores into a note that has lost its section", () => {
    const entry = parseJournal("## Journal\n- 09:00 a\n").entries[0];
    const result = restoreJournalEntry("other text\n", entry);
    expect(result.ok && result.content).toBe("other text\n\n## Journal\n\n- 09:00 a\n");
    expect(restoreJournalEntry("x\n", { source: ["not an entry"], seconds: 0 })).toEqual({ ok: false, reason: "missing" });
  });
});

describe("helpers", () => {
  it("normalises what a settings field may hold", () => {
    expect(normalizeJournalHeading("  ## Tage  buch ")).toBe("Tage buch");
    expect(normalizeJournalHeading("")).toBe("Journal");
    expect(normalizeJournalHeading(null)).toBe("Journal");
    expect(normalizeJournalHeading("###")).toBe("Journal");
  });

  it("judges a single line for the sync merge", () => {
    expect(readJournalLine("- 09:05 text")).toEqual({ seconds: 9 * 3600 + 300, task: null });
    expect(readJournalLine("- [x] 09:05:10 text\r")).toEqual({ seconds: 9 * 3600 + 310, task: "done" });
    expect(readJournalLine("- text 09:05")).toBeNull();
    expect(readJournalLine("  continuation")).toBeNull();
    expect(readJournalLine("- 24:00 no")).toBeNull();
  });

  it("stamps the local time with two digits", () => {
    expect(journalTimeOf(new Date(2026, 8, 20, 7, 5, 9))).toBe("07:05");
    expect(journalTimeOf(new Date(2026, 8, 20, 17, 45, 9), true)).toBe("17:45:09");
  });
});
