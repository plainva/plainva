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

/**
 * Files that answer a change the way the vault's chain does at a note with an
 * open conflict (finding 2026-10-12): the note takes it, and so does the user's
 * own version — another text, which the index never read. What the change
 * throws for the note is the caller's; for the user's version it is swallowed
 * and that version stays as it is (`changeOf` in the core).
 */
function twoVersions(d: ReturnType<typeof deps>["deps"], note: string, own: string) {
  const texts = { note, own };
  d.adapter = {
    readTextFile: async () => texts.note,
    writeTextFile: async (_p: string, c: string) => void (texts.note = c),
    updateTextFile: async (_p: string, change: (text: string) => string | null) => {
      const before = texts.note;
      const mineBefore = texts.own;
      const next = change(before);
      let mine: string | null;
      try {
        mine = change(mineBefore);
      } catch {
        mine = null;
      }
      texts.note = next ?? before;
      texts.own = mine ?? mineBefore;
      return { before, text: texts.note, changed: texts.note !== before, conflict: { workingCopyPath: "Projekte/Release.CONFLICT-1.md", changed: texts.own !== mineBefore } };
    },
  } as never;
  return texts;
}

const SECOND = `    - uid: evt-2
      account: acc-1
      calendar: primary
      dateField: termin
      start: 2026-09-01
`;
/** The note with a second scheduled date, as the user's own version carries it. */
const withSecond = (start: string) =>
  NOTE.replace("faellig: 2026-08-12\n", `faellig: 2026-08-12\ntermin: ${start}\n`)
    .replace("---\n\n# Release", `${SECOND.replace("2026-09-01", start)}---\n\n# Release`)
    .replace("# Release\n", "# Release\n\nTyped at this desk.\n");

describe("runEntryEventSync — the anchors are changed in the text that carries them", () => {
  it("a moved appointment moves in the user's own version too, and an anchor only that version has stays", async () => {
    const { deps: d } = deps({ event: movedTo("2026-08-20") });
    const texts = twoVersions(d, NOTE, withSecond("2026-09-01"));
    const res = await runEntryEventSync(d);
    expect(res.errors).toEqual([]);
    expect(texts.note).toContain("faellig: 2026-08-20");
    expect(texts.note).toContain("start: 2026-08-20");
    // The user's version: the same move …
    expect(texts.own).toContain("faellig: 2026-08-20");
    expect(texts.own).toContain("start: 2026-08-20");
    expect(texts.own).not.toContain("2026-08-12");
    // … and everything only it holds.
    expect(texts.own).toContain("evt-2");
    expect(texts.own).toContain("dateField: termin");
    expect(texts.own).toContain("start: 2026-09-01");
    expect(texts.own).toContain("termin: 2026-09-01");
    expect(texts.own).toContain("Typed at this desk.");
  });

  it("an anchor this run did not move keeps the start it has in the user's own version", async () => {
    const two = JSON.stringify({
      events: [
        { uid: "evt-1", account: "acc-1", calendar: "primary", dateField: "faellig", start: "2026-08-12" },
        { uid: "evt-2", account: "acc-1", calendar: "primary", dateField: "termin", start: "2026-09-01" },
      ],
    });
    const { deps: d } = deps({ namespace: two });
    // The first appointment moved; the second stands where the note's anchor says.
    d.cache.getEventByUid = (async (_account: string, _calendar: string, uid: string) =>
      uid === "evt-1" ? movedTo("2026-08-20") : { ...movedTo("2026-09-01"), uid: "evt-2" }) as never;
    // In the user's own version the second one stands on another day — written there, with its date, by whoever moved it.
    const texts = twoVersions(d, withSecond("2026-09-01").replace("\nTyped at this desk.\n", ""), withSecond("2026-09-05"));
    const res = await runEntryEventSync(d);
    expect(res.errors).toEqual([]);
    expect(texts.note).toContain("start: 2026-08-20");
    expect(texts.note).toContain("start: 2026-09-01");
    expect(texts.own).toContain("start: 2026-08-20");
    // Its date column was not written here, so its anchor is not either.
    expect(texts.own).toContain("termin: 2026-09-05");
    expect(texts.own).toContain("start: 2026-09-05");
    expect(texts.own).not.toContain("start: 2026-09-01");
  });

  it("a moved anchor that stands on another day in the user's own version is that version's own: neither date nor start", async () => {
    const { deps: d } = deps({ event: movedTo("2026-08-20") });
    // Moved at this desk, to a day the note on the other side does not know of.
    const elsewhere = NOTE.replace("faellig: 2026-08-12", "faellig: 2026-08-15").replace("start: 2026-08-12", "start: 2026-08-15");
    const texts = twoVersions(d, NOTE, elsewhere);
    const res = await runEntryEventSync(d);
    expect(res.errors).toEqual([]);
    expect(texts.note).toContain("start: 2026-08-20");
    expect(texts.own).toBe(elsewhere);
  });

  it("an anchor written without a start gets its date and its start in one cycle, and the next cycle finds nothing to do", async () => {
    const bare = NOTE.replace("      start: 2026-08-12\n", "");
    const namespace = JSON.stringify({ events: [{ uid: "evt-1", account: "acc-1", calendar: "primary", dateField: "faellig" }] });
    const first = deps({ note: bare, namespace, event: movedTo("2026-08-20") });
    expect((await runEntryEventSync(first.deps)).changedNotes).toEqual(["Projekte/Release.md"]);
    const healed = first.files.get("Projekte/Release.md")!;
    expect(healed).toContain("faellig: 2026-08-20");
    expect(healed).toContain("start: 2026-08-20");
    // As the index reads the note afterwards: the anchor stands where its appointment is.
    const after = JSON.stringify({ events: [{ uid: "evt-1", account: "acc-1", calendar: "primary", dateField: "faellig", start: "2026-08-20" }] });
    const second = deps({ note: healed, namespace: after, event: movedTo("2026-08-20") });
    expect((await runEntryEventSync(second.deps)).changedNotes).toEqual([]);
    expect(second.files.get("Projekte/Release.md")).toBe(healed);
  });

  it("a version whose properties cannot be written keeps its anchor where it was: the move is not forgotten there", async () => {
    const { deps: d } = deps({ event: movedTo("2026-08-20") });
    // A value the property writer refuses (a number as the title): the date cannot go into this version.
    const unwritable = NOTE.replace("type: Note\n", "type: Note\ntitle: 2026\n");
    const texts = twoVersions(d, NOTE, unwritable);
    const res = await runEntryEventSync(d);
    expect(res.errors).toEqual([]);
    expect(texts.note).toContain("faellig: 2026-08-20");
    expect(texts.note).toContain("start: 2026-08-20");
    // Date and anchor go together or not at all. An anchor moved without its date would say the entry is where its
    // appointment is, and no later cycle would write the date.
    expect(texts.own).toBe(unwritable);
    expect(res.changedNotes).toEqual(["Projekte/Release.md"]);
  });

  it("a version that does not carry the moved anchor keeps its date", async () => {
    const { deps: d } = deps({ event: movedTo("2026-08-20") });
    // In the user's own version the entry is not in the calendar: the date there is the user's.
    const unlinked = NOTE.replace(/ {2}events:\n(?: {4,}.*\n)+/, "");
    expect(unlinked).not.toContain("evt-1");
    const texts = twoVersions(d, NOTE, unlinked);
    const res = await runEntryEventSync(d);
    expect(res.errors).toEqual([]);
    expect(texts.note).toContain("faellig: 2026-08-20");
    expect(texts.own).toBe(unlinked);
  });

  it("names the user's own version for the index where it took the change", async () => {
    const { deps: d } = deps({ event: movedTo("2026-08-20") });
    twoVersions(d, NOTE, withSecond("2026-09-01"));
    const res = await runEntryEventSync(d);
    expect(res.changedNotes).toEqual(["Projekte/Release.md", "Projekte/Release.CONFLICT-1.md"]);
  });

  it("an appointment that is gone drops its anchor from both, and the user's version keeps the one only it has", async () => {
    const { deps: d } = deps({ event: null });
    const texts = twoVersions(d, NOTE, withSecond("2026-09-01"));
    const res = await runEntryEventSync(d);
    expect(res.errors).toEqual([]);
    expect(texts.note).not.toContain("evt-1");
    expect(texts.own).not.toContain("evt-1");
    expect(texts.own).toContain("evt-2");
    expect(texts.own).toContain("termin: 2026-09-01");
    expect(texts.own).toContain("Typed at this desk.");
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
