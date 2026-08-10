import { describe, it, expect } from "vitest";
import {
  buildEntryEventDraft,
  createEntryEvent,
  entryDateValue,
  readEntryEvents,
  reconcileEntryEvents,
  type EntryEventAnchor,
} from "@plainva/ui";
import type { PimEventRow } from "@plainva/core";

/**
 * The writing connection (S19, plan P9b): a database entry becomes a real
 * appointment and stays linked. The three directions the plan names each get a
 * test here, because each is a way to lose someone's data if it is wrong.
 */

const NOTE = `---
type: Note
okf_version: "1.0"
faellig: 2026-08-12
plainva:
  pim:
    uid: remote-task-1
---

# Release
`;

function fakeAdapter(initial: string) {
  const files = new Map<string, string>([["Projekte/Release.md", initial]]);
  return {
    files,
    readTextFile: async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error("not found");
      return v;
    },
    writeTextFile: async (p: string, c: string) => void files.set(p, c),
  } as never;
}

const target = (uid = "evt-1") => async () => ({ uid });

describe("buildEntryEventDraft", () => {
  it("is all-day when the entry names no time", () => {
    // An entry that says "the 12th" must not claim to start at nine.
    const d = buildEntryEventDraft({ title: "Release", day: "2026-08-12" });
    expect(d.allDay).toBe(true);
    expect(d.start.date).toBe("2026-08-12");
    // End date is EXCLUSIVE — the day after.
    expect(d.end.date).toBe("2026-08-13");
  });

  it("is timed when it does, and carries the note as a readable link", () => {
    const d = buildEntryEventDraft({ title: "Abnahme", day: "2026-08-12", minutes: 14 * 60 + 30, noteTarget: "Release" });
    expect(d.allDay).toBe(false);
    expect(new Date(d.start.ts!).getHours()).toBe(14);
    expect(d.description).toBe("[[Release]]");
    expect(d.descriptionHtml).toContain("Release");
  });
});

describe("createEntryEvent", () => {
  it("anchors the note WITHOUT touching a sibling anchor", async () => {
    // `plainva.pim` belongs to the task reconciler. Replacing the whole map
    // would drop it and un-mirror a remote task.
    const adapter = fakeAdapter(NOTE);
    const res = await createEntryEvent({
      adapter,
      createEvent: target(),
      calendarKey: "acc-1 primary",
      notePath: "Projekte/Release.md",
      title: "Release",
      day: "2026-08-12",
      dateField: "faellig",
    });
    expect(res).toMatchObject({ uid: "evt-1", accountId: "acc-1", anchored: true });
    const written = (adapter as unknown as { files: Map<string, string> }).files.get("Projekte/Release.md")!;
    expect(written).toContain("remote-task-1");
    const anchors = readEntryEvents(written);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ uid: "evt-1", dateField: "faellig", start: "2026-08-12" });
  });

  it("reports a failed anchor instead of hiding the appointment", async () => {
    // The appointment is already live at the provider. Pretending it failed
    // would leave a real appointment nobody was told about.
    const res = await createEntryEvent({
      adapter: { readTextFile: async () => { throw new Error("locked"); }, writeTextFile: async () => {} } as never,
      createEvent: target("evt-2"),
      calendarKey: "acc-1 primary",
      notePath: "Projekte/Release.md",
      title: "Release",
      day: "2026-08-12",
      dateField: "faellig",
    });
    expect(res.uid).toBe("evt-2");
    expect(res.anchored).toBe(false);
  });
});

const anchor = (over: Partial<EntryEventAnchor> = {}): EntryEventAnchor => ({
  uid: "evt-1",
  account: "acc-1",
  calendar: "primary",
  dateField: "faellig",
  start: "2026-08-12",
  ...over,
});

const row = (uid: string, accountId = "acc-1"): PimEventRow => ({ uid, accountId }) as unknown as PimEventRow;
const known = new Set(["acc-1"]);

describe("reconcileEntryEvents", () => {
  it("direction 1: the appointment moved -> the entry's date follows", () => {
    const out = reconcileEntryEvents([anchor()], [row("evt-1")], known, () => "2026-08-20", () => undefined);
    expect(out.moves).toEqual([{ dateField: "faellig", day: "2026-08-20" }]);
    expect(out.keep[0]!.start).toBe("2026-08-20");
    expect(out.dropped).toEqual([]);
  });

  it("an unmoved appointment writes nothing", () => {
    const out = reconcileEntryEvents([anchor()], [row("evt-1")], known, () => "2026-08-12", () => undefined);
    expect(out.moves).toEqual([]);
    expect(out.keep).toEqual([anchor()]);
  });

  it("direction 3: the appointment is gone -> the anchor drops, the note stays", () => {
    const out = reconcileEntryEvents([anchor()], [], known, () => "", () => undefined);
    expect(out.dropped).toHaveLength(1);
    expect(out.keep).toEqual([]);
    // Nothing here deletes a note — the caller only ever rewrites frontmatter.
    expect(out.moves).toEqual([]);
  });

  it("does not confuse 'I did not look there' with 'it is gone'", () => {
    // An account that was not loaded keeps its anchors. Otherwise a briefly
    // unreachable account would erase every link it owns.
    const out = reconcileEntryEvents([anchor({ account: "acc-2" })], [], known, () => "", () => undefined);
    expect(out.dropped).toEqual([]);
    expect(out.keep).toHaveLength(1);
  });

  it("matches per ACCOUNT, so the same uid in two accounts cannot cross", () => {
    const out = reconcileEntryEvents([anchor()], [row("evt-1", "acc-2")], known, () => "2026-09-01", () => undefined);
    expect(out.moves).toEqual([]);
    expect(out.dropped).toHaveLength(1);
  });

  it("carries a time when the appointment has one", () => {
    const out = reconcileEntryEvents([anchor()], [row("evt-1")], known, () => "2026-08-12", () => 9 * 60 + 15);
    expect(out.moves[0]).toMatchObject({ day: "2026-08-12", minutes: 9 * 60 + 15 });
    expect(entryDateValue(out.moves[0]!)).toBe("2026-08-12T09:15");
  });

  it("writes a bare day for an all-day appointment", () => {
    // "T00:00" would turn a day into a midnight appointment.
    expect(entryDateValue({ day: "2026-08-12" })).toBe("2026-08-12");
  });
});

describe("readEntryEvents", () => {
  it("ignores malformed anchors rather than throwing", () => {
    const bad = `---\nplainva:\n  events:\n    - nope\n    - uid: ""\n    - uid: ok\n---\n`;
    // Only the one with a uid AND a date column survives; "ok" has no column.
    expect(readEntryEvents(bad)).toEqual([]);
    expect(readEntryEvents("# no frontmatter")).toEqual([]);
  });
});
