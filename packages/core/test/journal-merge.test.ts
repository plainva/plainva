import { describe, expect, it } from "vitest";
import { mergeEditorText, mergeText, mergeWithoutBase } from "../src/conflict-resolver.js";
import { insertJournalEntry, parseJournal } from "../src/journal.js";

/** What a device does when it captures: the real insert, not a hand-written line. */
function capture(raw: string, time: string, text: string): string {
  const result = insertJournalEntry(raw, { time, text });
  if (!result.ok) throw new Error(result.reason);
  return result.content;
}

const times = (raw: string) => parseJournal(raw).entries.map((e) => e.time);

describe("journal entries appended on two devices (plan Journal, E6)", () => {
  const base = "# 2026-09-20\n\n## Journal\n\n- 08:00 breakfast\n\n## Notes\n\nplain text\n";

  it("unites what both sides appended, by time", () => {
    const phone = capture(capture(base, "09:10", "on the train"), "12:30", "lunch");
    const desk = capture(base, "10:45", "call with the workshop");
    const result = mergeText(base, phone, desk);
    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe("# 2026-09-20\n\n## Journal\n\n- 08:00 breakfast\n- 09:10 on the train\n- 10:45 call with the workshop\n- 12:30 lunch\n\n## Notes\n\nplain text\n");
    // The same answer whichever device merges.
    expect(mergeText(base, desk, phone).mergedText).toBe(result.mergedText);
  });

  it("puts the local side first when two entries carry the same minute", () => {
    const result = mergeText(base, capture(base, "09:00", "mine"), capture(base, "09:00", "theirs"));
    expect(result.mergedText).toContain("- 09:00 mine\n- 09:00 theirs\n");
  });

  it("keeps an entry together with its continuation lines", () => {
    const phone = capture(base, "09:00", "first line\nsecond line\n\nthird, after a gap");
    const desk = capture(base, "09:30", "short");
    const result = mergeText(base, desk, phone);
    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toContain("- 09:00 first line\n  second line\n\n  third, after a gap\n- 09:30 short\n");
  });

  it("never sorts an indented line away from the entry it belongs to", () => {
    const phone = base.replace("- 08:00 breakfast\n", "- 08:00 breakfast\n- 09:00 parent\n  - 09:40 a nested line that looks like an entry\n");
    const desk = capture(base, "09:20", "between");
    const result = mergeText(base, phone, desk);
    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toContain("- 09:00 parent\n  - 09:40 a nested line that looks like an entry\n- 09:20 between\n");
  });

  it("writes an entry once that arrived on both sides", () => {
    const shared = capture(base, "09:00", "the same thought");
    const result = mergeText(base, capture(shared, "09:30", "and one more"), shared);
    expect(result.hasConflicts).toBe(false);
    expect(times(result.mergedText)).toEqual(["08:00", "09:00", "09:30"]);
  });

  it("unites two devices that both had to create the section", () => {
    const bare = "# 2026-09-20\n\nplain text\n";
    const result = mergeText(bare, capture(bare, "11:00", "desk"), capture(bare, "07:30", "phone"));
    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe("# 2026-09-20\n\nplain text\n\n## Journal\n\n- 07:30 phone\n- 11:00 desk\n");
  });

  it("fills an empty section from both sides without doubling the padding", () => {
    const empty = "## Journal\n## Notes\n";
    const result = mergeText(empty, capture(empty, "09:00", "a"), capture(empty, "10:00", "b"));
    expect(result.mergedText).toBe("## Journal\n\n- 09:00 a\n- 10:00 b\n\n## Notes\n");
  });

  it("keeps the blank lines of a list that sets one between its items", () => {
    const loose = "## Journal\n\n- 08:00 a\n\n- 08:30 b\n";
    const result = mergeText(loose, capture(loose, "09:00", "c"), capture(loose, "10:00", "d"));
    expect(result.mergedText).toBe("## Journal\n\n- 08:00 a\n\n- 08:30 b\n\n- 09:00 c\n\n- 10:00 d\n");
  });

  it("merges as before when one side appends and the other edits further up", () => {
    const result = mergeText(base, capture(base, "09:00", "appended"), base.replace("plain text", "edited text"));
    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toContain("- 09:00 appended\n");
    expect(result.mergedText).toContain("edited text");
  });

  it("stays a conflict when a side also changes an existing line there", () => {
    const phone = capture(base, "09:00", "appended").replace("- 08:00 breakfast", "- 08:00 late breakfast");
    const desk = capture(base, "10:00", "other").replace("- 08:00 breakfast", "- 08:00 early breakfast");
    expect(mergeText(base, phone, desk).hasConflicts).toBe(true);
  });

  it("stays a conflict when anything but a journal line is inserted at the place", () => {
    const phone = capture(base, "09:00", "appended");
    const desk = base.replace("- 08:00 breakfast\n", "- 08:00 breakfast\nA paragraph somebody typed.\n");
    expect(mergeText(base, phone, desk).hasConflicts).toBe(true);
    const list = base.replace("- 08:00 breakfast\n", "- 08:00 breakfast\n- a list item without a time\n");
    expect(mergeText(base, phone, list).hasConflicts).toBe(true);
    const continued = base.replace("- 08:00 breakfast\n", "- 08:00 breakfast\n  with a line added to it\n");
    expect(mergeText(base, phone, continued).hasConflicts).toBe(true);
  });

  it("reaches the open editor through mergeEditorText", () => {
    const result = mergeEditorText(base, capture(base, "09:00", "typed"), capture(base, "09:30", "captured"));
    expect(result.hasConflicts).toBe(false);
    expect(times(result.mergedText)).toEqual(["08:00", "09:00", "09:30"]);
  });

  it("unites CRLF notes too, with the line endings every merge writes", () => {
    // A merged note is written with LF — the documented behaviour of mergeText,
    // which this pre-stage follows rather than changes.
    const crlf = base.replace(/\n/g, "\r\n");
    const result = mergeText(crlf, capture(crlf, "09:00", "a"), capture(crlf, "10:00", "b"));
    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe(capture(capture(base, "09:00", "a"), "10:00", "b"));
  });
});

describe("two versions and no common ancestor", () => {
  const template = "---\ndate: 2026-09-20\n---\n# 2026-09-20\n\n## Journal\n\n## Notes\n";

  it("unites two daily notes that were created apart and differ only in their journal", () => {
    const phone = capture(capture(template, "07:30", "phone one"), "12:00", "phone two");
    const desk = capture(template, "09:00", "desk");
    const result = mergeWithoutBase(desk, phone);
    expect(result.hasConflicts).toBe(false);
    expect(result.mergedText).toBe("---\ndate: 2026-09-20\n---\n# 2026-09-20\n\n## Journal\n\n- 07:30 phone one\n- 09:00 desk\n- 12:00 phone two\n\n## Notes\n");
    expect(mergeWithoutBase(phone, desk).mergedText).toBe(result.mergedText);
  });

  it("keeps the section only one of them had to create", () => {
    const bare = "# 2026-09-20\n\ntext\n";
    const result = mergeWithoutBase(bare, capture(bare, "09:00", "desk"));
    expect(result).toEqual({ mergedText: "# 2026-09-20\n\ntext\n\n## Journal\n\n- 09:00 desk\n", hasConflicts: false });
    const both = mergeWithoutBase(capture(bare, "10:00", "phone"), capture(bare, "09:00", "desk"));
    expect(both).toEqual({ mergedText: "# 2026-09-20\n\ntext\n\n## Journal\n\n- 09:00 desk\n- 10:00 phone\n", hasConflicts: false });
  });

  it("keeps every other difference a conflict", () => {
    expect(mergeWithoutBase("local content", "remote content").hasConflicts).toBe(true);
    const stamped = (time: string) => template.replace("date: 2026-09-20", `date: 2026-09-20\ncreated: ${time}`);
    expect(mergeWithoutBase(capture(stamped("08:00"), "08:00", "a"), capture(stamped("09:00"), "09:00", "b")).hasConflicts).toBe(true);
    expect(mergeWithoutBase(template, template + "A new paragraph.\n").hasConflicts).toBe(true);
    expect(mergeWithoutBase(template, template + "\n## Another heading\n").hasConflicts).toBe(true);
  });

  it("never loses a line of either side", () => {
    const phone = capture(capture(template, "07:30", "one\nwith a second line"), "12:00", "two");
    const desk = capture(capture(template, "07:30", "one\nwith a second line"), "09:00", "three");
    const merged = mergeWithoutBase(phone, desk).mergedText.split("\n");
    for (const line of [...phone.split("\n"), ...desk.split("\n")]) expect(merged).toContain(line);
    expect(times(merged.join("\n"))).toEqual(["07:30", "09:00", "12:00"]);
  });
});
