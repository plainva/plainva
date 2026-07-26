import { describe, expect, it } from "vitest";
import {
  canRepeat,
  describeRule,
  nextDueDate,
  isMirroredNamespace,
  readRepeatRule,
  repeatFromNamespace,
  writeNextOccurrenceNote,
  writeRepeatRule,
  type RepeatRule,
} from "./taskRecurrence";

/**
 * Recurring tasks (issue #34, wave 3). The generator model means there is no
 * hidden series: what these tests pin is the arithmetic (civil dates, no
 * timezone drift, month-end clamping), the catch-up behaviour for an overdue
 * fixed rhythm, and that the rule never lands on a mirrored provider task.
 */

const rule = (over: Partial<RepeatRule> = {}): RepeatRule => ({ freq: "weekly", interval: 1, from: "due", ...over });

describe("nextDueDate", () => {
  it('counts from the DUE date for a fixed rhythm ("every Monday")', () => {
    expect(nextDueDate(rule(), "2026-08-03", "2026-08-03")).toBe("2026-08-10");
  });

  it("counts from the COMPLETION date when that is the anchor", () => {
    // Watered three days late -> next in three days, not on the old rhythm.
    expect(nextDueDate(rule({ freq: "daily", interval: 3, from: "completion" }), "2026-08-01", "2026-08-04")).toBe("2026-08-07");
  });

  it("resumes an overdue fixed task in the FUTURE instead of piling up the misses", () => {
    // Weekly, due in early August, ticked six weeks later: one next date.
    const next = nextDueDate(rule(), "2026-08-03", "2026-09-14");
    expect(next).toBe("2026-09-21");
    expect(next! > "2026-09-14").toBe(true);
  });

  it("clamps month arithmetic to the end of the target month", () => {
    // 31 January + 1 month is February's last day, never 3 March: rolling over
    // would drift a monthly task later every single year.
    expect(nextDueDate(rule({ freq: "monthly" }), "2026-01-31", "2026-01-31")).toBe("2026-02-28");
    expect(nextDueDate(rule({ freq: "monthly" }), "2028-01-31", "2028-01-31")).toBe("2028-02-29"); // leap year
    expect(nextDueDate(rule({ freq: "monthly" }), "2026-03-31", "2026-03-31")).toBe("2026-04-30");
  });

  it("crosses year boundaries on the civil calendar", () => {
    expect(nextDueDate(rule({ freq: "monthly", interval: 2 }), "2026-11-30", "2026-11-30")).toBe("2027-01-30");
    expect(nextDueDate(rule({ freq: "yearly" }), "2026-02-29", "2026-02-29")).toBe("2027-02-28");
    expect(nextDueDate(rule({ freq: "daily" }), "2026-12-31", "2026-12-31")).toBe("2027-01-01");
  });

  it("falls back to the completion date when the task has no due date", () => {
    expect(nextDueDate(rule({ freq: "daily", interval: 2 }), null, "2026-08-04")).toBe("2026-08-06");
  });

  it("gives up rather than guessing when there is nothing to count from", () => {
    expect(nextDueDate(rule(), null, "")).toBeNull();
    expect(nextDueDate(rule(), "not-a-date", "also-not")).toBeNull();
  });
});

describe("reading and writing the rule", () => {
  const NOTE = `---
type: task
frist: 2026-08-03
plainva:
  pim:
    uid: remote-1
---

# T
`;

  it("round-trips a rule without disturbing sibling anchors", () => {
    const written = writeRepeatRule(NOTE, rule({ freq: "monthly", interval: 3, from: "completion" }));
    expect(readRepeatRule(written)).toEqual({ freq: "monthly", interval: 3, from: "completion" });
    // The mirrored-task anchor must survive: it is a different key in the same
    // namespace, and clobbering it would confuse the task reconciler.
    expect(written).toContain("uid: remote-1");
    expect(written).toContain("frist: 2026-08-03");
  });

  it("removes the rule again", () => {
    const written = writeRepeatRule(NOTE, rule());
    const cleared = writeRepeatRule(written, null);
    expect(readRepeatRule(cleared)).toBeNull();
    expect(cleared).toContain("uid: remote-1");
  });

  it("reads hand-edited nonsense as 'no rule' rather than throwing", () => {
    expect(readRepeatRule("# no frontmatter")).toBeNull();
    expect(readRepeatRule(`---\nplainva:\n  repeat: "weekly"\n---\n`)).toBeNull();
    expect(readRepeatRule(`---\nplainva:\n  repeat:\n    freq: fortnightly\n---\n`)).toBeNull();
  });

  it("repairs an out-of-range interval instead of rejecting the rule", () => {
    expect(readRepeatRule(`---\nplainva:\n  repeat:\n    freq: daily\n    interval: 0\n---\n`)).toEqual({
      freq: "daily",
      interval: 1,
      from: "due",
    });
    expect(readRepeatRule(`---\nplainva:\n  repeat:\n    freq: daily\n    interval: 99999\n---\n`)?.interval).toBe(999);
  });

  it("refuses to repeat a mirrored provider task", () => {
    // The provider owns its own recurrence; a local generator on top of it
    // would push duplicates back at it.
    expect(canRepeat(NOTE)).toBe(false);
    expect(canRepeat("---\ntype: task\n---\n\n# Local only\n")).toBe(true);
  });
});

describe("describeRule", () => {
  it("picks the wording per frequency and passes the interval", () => {
    const t = (key: string, o: { defaultValue: string; n: number }) => `${key}:${o.n}`;
    expect(describeRule(rule({ freq: "daily", interval: 2 }), t)).toBe("tasks.repeatEvery_daily:2");
    expect(describeRule(rule({ freq: "yearly", interval: 1 }), t)).toBe("tasks.repeatEvery_yearly:1");
  });
});

describe("reading the rule from the INDEXED namespace", () => {
  it("parses the JSON string the database query hands over", () => {
    // This is what keeps the list cheap: the badge costs no file read.
    const raw = JSON.stringify({ repeat: { freq: "weekly", interval: 2, from: "completion" }, icon: "🌱" });
    expect(repeatFromNamespace(raw)).toEqual({ freq: "weekly", interval: 2, from: "completion" });
  });

  it("accepts an already-parsed object and shrugs off anything else", () => {
    expect(repeatFromNamespace({ repeat: { freq: "daily" } })).toEqual({ freq: "daily", interval: 1, from: "due" });
    expect(repeatFromNamespace("{ broken")).toBeNull();
    expect(repeatFromNamespace(null)).toBeNull();
    expect(repeatFromNamespace(JSON.stringify({ icon: "🌱" }))).toBeNull();
  });

  it("spots a mirrored provider task from the same value", () => {
    expect(isMirroredNamespace(JSON.stringify({ pim: { uid: "remote-1" } }))).toBe(true);
    expect(isMirroredNamespace(JSON.stringify({ pim: { uid: "" } }))).toBe(false);
    expect(isMirroredNamespace(JSON.stringify({ repeat: { freq: "daily" } }))).toBe(false);
    expect(isMirroredNamespace(null)).toBe(false);
  });
});

describe("writeNextOccurrenceNote", () => {
  function adapter(existing: string[]) {
    const written: Record<string, string> = {};
    return {
      written,
      exists: async (p: string) => existing.includes(p) || p in written,
      writeTextFile: async (p: string, c: string) => {
        written[p] = c;
      },
    };
  }

  it("writes the next free sibling", async () => {
    const a = adapter(["Tasks/Water plants.md"]);
    const path = await writeNextOccurrenceNote(a, "Tasks/Water plants.md", "content");
    expect(path).toBe("Tasks/Water plants 2.md");
    expect(a.written[path!]).toBe("content");
  });

  it("does not stack counters along a chain", async () => {
    // Third repetition must be "... 4", never "... 2 2 2".
    const a = adapter(["Tasks/Water plants.md", "Tasks/Water plants 2.md", "Tasks/Water plants 3.md"]);
    expect(await writeNextOccurrenceNote(a, "Tasks/Water plants 3.md", "c")).toBe("Tasks/Water plants 4.md");
  });

  it("gives up rather than looping forever", async () => {
    const many = ["Tasks/T.md", ...Array.from({ length: 600 }, (_, i) => `Tasks/T ${i + 2}.md`)];
    expect(await writeNextOccurrenceNote(adapter(many), "Tasks/T.md", "c")).toBeNull();
  });
});
