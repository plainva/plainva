import { describe, it, expect } from "vitest";
import { loadAnchoredNotes, runEntryEventSync } from "./entryEventSync";
import type { PimEventRow } from "@plainva/core";

/**
 * The write-back of the writing connection (S19). Every assertion here is a way
 * to lose someone's data if it is wrong, so each has a red counter-proof noted
 * in the loop's § 5.
 */

const NOTE = `---
type: Note
okf_version: "1.0"
faellig: 2026-08-12
plainva:
  pim:
    uid: remote-task-1
  events:
    - uid: evt-1
      account: acc-1
      calendar: primary
      dateField: faellig
      start: 2026-08-12
---

# Release
`;

const NAMESPACE = JSON.stringify({
  pim: { uid: "remote-task-1" },
  events: [{ uid: "evt-1", account: "acc-1", calendar: "primary", dateField: "faellig", start: "2026-08-12" }],
});

function deps(over: {
  note?: string;
  namespace?: string;
  event?: PimEventRow | null;
  window?: { startDay: string; endDay: string };
} = {}) {
  const files = new Map<string, string>([["Projekte/Release.md", over.note ?? NOTE]]);
  return {
    files,
    deps: {
      adapter: {
        readTextFile: async (p: string) => {
          const v = files.get(p);
          if (v === undefined) throw new Error("not found");
          return v;
        },
        writeTextFile: async (p: string, c: string) => void files.set(p, c),
      } as never,
      db: {
        query: async () => [{ path: "Projekte/Release.md", value: over.namespace ?? NAMESPACE }],
      },
      cache: {
        listAccounts: async () => [{ id: "acc-1", enabled: true }],
        getEventByUid: async () => over.event ?? null,
      },
      window: over.window ?? { startDay: "2026-07-01", endDay: "2027-06-01" },
    },
  };
}

const movedTo = (day: string, allDay = true): PimEventRow =>
  ({
    uid: "evt-1",
    accountId: "acc-1",
    calendarId: "primary",
    allDay,
    start: allDay ? { date: day } : { ts: new Date(`${day}T09:15:00`).getTime() },
    end: allDay ? { date: day } : { ts: new Date(`${day}T10:15:00`).getTime() },
  }) as unknown as PimEventRow;

describe("loadAnchoredNotes", () => {
  it("reads the anchors from the INDEX, not from disk", async () => {
    const map = await loadAnchoredNotes({ query: async () => [{ path: "a.md", value: NAMESPACE }] });
    expect([...map.keys()]).toEqual(["a.md"]);
    expect(map.get("a.md")).toHaveLength(1);
  });

  it("skips notes without the anchor and malformed namespace JSON", async () => {
    const map = await loadAnchoredNotes({
      query: async () => [
        { path: "icon-only.md", value: JSON.stringify({ icon: "star" }) },
        { path: "broken.md", value: "{events:" },
        { path: "empty.md", value: JSON.stringify({ events: [] }) },
      ],
    });
    expect(map.size).toBe(0);
  });
});

describe("runEntryEventSync — direction 1: the appointment moved", () => {
  it("writes the new day into the entry's own date column AND updates the anchor", async () => {
    const { files, deps: d } = deps({ event: movedTo("2026-08-20") });
    const res = await runEntryEventSync(d);
    expect(res.changedNotes).toEqual(["Projekte/Release.md"]);
    const out = files.get("Projekte/Release.md")!;
    expect(out).toContain("faellig: 2026-08-20");
    expect(out).not.toContain("faellig: 2026-08-12");
    // The anchor moved with it — otherwise the next cycle would write again.
    expect(out).toContain("start: 2026-08-20");
    // And the task reconciler's own anchor is untouched.
    expect(out).toContain("remote-task-1");
  });

  it("carries a time when the appointment has one", async () => {
    const { files, deps: d } = deps({ event: movedTo("2026-08-20", false) });
    await runEntryEventSync(d);
    expect(files.get("Projekte/Release.md")!).toContain("2026-08-20T09:15");
  });

  it("writes nothing when the appointment did not move", async () => {
    const { files, deps: d } = deps({ event: movedTo("2026-08-12") });
    const before = files.get("Projekte/Release.md");
    const res = await runEntryEventSync(d);
    expect(res.changedNotes).toEqual([]);
    expect(files.get("Projekte/Release.md")).toBe(before);
  });
});

describe("runEntryEventSync — direction 3: the appointment is gone", () => {
  it("drops the anchor and leaves the note otherwise alone", async () => {
    const { files, deps: d } = deps({ event: null });
    const res = await runEntryEventSync(d);
    expect(res.changedNotes).toEqual(["Projekte/Release.md"]);
    const out = files.get("Projekte/Release.md")!;
    expect(out).not.toContain("evt-1");
    // The date column keeps its value — a deleted appointment is not a reason
    // to forget when something is due.
    expect(out).toContain("faellig: 2026-08-12");
    // And the note itself is still there, with its body.
    expect(out).toContain("# Release");
    expect(out).toContain("remote-task-1");
  });

  it("keeps an anchor whose day lies OUTSIDE the loaded window", async () => {
    // The cache holds past 60d / future 400d. An appointment from two years ago
    // is absent because nobody looked, not because it is gone — dropping the
    // anchor there would silently unlink every older entry.
    const { files, deps: d } = deps({ event: null, window: { startDay: "2026-09-01", endDay: "2027-06-01" } });
    const res = await runEntryEventSync(d);
    expect(res.changedNotes).toEqual([]);
    expect(files.get("Projekte/Release.md")!).toContain("evt-1");
  });

  it("keeps anchors of an account that is switched off", async () => {
    const { files, deps: d } = deps({ event: null });
    d.cache.listAccounts = async () => [{ id: "acc-1", enabled: false }];
    const res = await runEntryEventSync(d);
    expect(res.changedNotes).toEqual([]);
    expect(files.get("Projekte/Release.md")!).toContain("evt-1");
  });
});

describe("runEntryEventSync — the task reconciler stays untouched", () => {
  it("does not look at notes that only carry a pim anchor", async () => {
    const map = await loadAnchoredNotes({
      query: async () => [{ path: "Task.md", value: JSON.stringify({ pim: { uid: "t-1" } }) }],
    });
    expect(map.size).toBe(0);
  });

  it("reports a per-note failure without stopping the run", async () => {
    const { deps: d } = deps({ event: movedTo("2026-08-20") });
    d.adapter = {
      readTextFile: async () => {
        throw new Error("locked");
      },
      writeTextFile: async () => {},
    } as never;
    const res = await runEntryEventSync(d);
    expect(res.changedNotes).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("Projekte/Release.md");
  });
});
