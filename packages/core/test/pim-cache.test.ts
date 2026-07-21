import { describe, expect, it, beforeEach } from "vitest";
import { PimCacheRepository } from "../src/pim/PimCacheRepository.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import type { PimEvent } from "../src/pim/types.ts";

/** Real-SQLite integration of the PIM cache (node:sqlite, like the query
 * casing regression) — the windowed replace + the selected/enabled filters
 * are SQL semantics that a recording mock cannot prove. */

const { DatabaseSync } = (await import("node:sqlite")) as any;

class NodeSqliteAdapter implements IDatabaseAdapter {
  constructor(private db: any) {}
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = this.db.prepare(sql).all(...(params as never[])) as T[];
    return rows[0] ?? null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

function ev(uid: string, startIso: string, endIso: string, extra: Partial<PimEvent> = {}): PimEvent {
  return {
    uid,
    calendarId: "cal1",
    title: uid,
    start: { ts: Date.parse(startIso) },
    end: { ts: Date.parse(endIso) },
    allDay: false,
    ...extra,
  };
}

describe("PimCacheRepository", () => {
  let repo: PimCacheRepository;
  let db: NodeSqliteAdapter;

  beforeEach(async () => {
    db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    repo = new PimCacheRepository(db);
    await repo.upsertAccount({ id: "acc1", provider: "caldav", label: "Nextcloud", config: { url: "https://x" }, enabled: true });
    await repo.replaceCalendars("acc1", [{ id: "cal1", name: "Privat", color: "#00aa00" }]);
  });

  it("round-trips accounts with config JSON and deletes them with every cached object", async () => {
    const accounts = await repo.listAccounts();
    expect(accounts).toEqual([{ id: "acc1", provider: "caldav", label: "Nextcloud", config: { url: "https://x" }, enabled: true }]);

    await repo.replaceEventWindow("acc1", "cal1", 0, Date.parse("2027-01-01T00:00:00Z"), [ev("e1", "2026-08-01T10:00:00Z", "2026-08-01T11:00:00Z")]);
    await repo.replaceTaskLists("acc1", [{ id: "l1", name: "Aufgaben" }]);
    await repo.replaceTasks("acc1", "l1", [{ uid: "t1", listId: "l1", title: "T", completed: false }]);
    await repo.setScopeState("acc1", "events:cal1", { lastSyncTs: 5 });

    await repo.deleteAccount("acc1");
    expect(await repo.listAccounts()).toEqual([]);
    expect(await repo.listCalendars()).toEqual([]);
    expect(await repo.listEvents(0, Date.parse("2027-01-01T00:00:00Z"))).toEqual([]);
    expect(await repo.listTasks("acc1", "l1")).toEqual([]);
    expect(await repo.getScopeState("acc1", "events:cal1")).toBeNull();
  });

  it("replaces exactly the window and keeps rows outside it", async () => {
    const aug = [ev("aug1", "2026-08-05T10:00:00Z", "2026-08-05T11:00:00Z")];
    const sep = [ev("sep1", "2026-09-05T10:00:00Z", "2026-09-05T11:00:00Z")];
    await repo.replaceEventWindow("acc1", "cal1", Date.parse("2026-08-01T00:00:00Z"), Date.parse("2026-09-01T00:00:00Z"), aug);
    await repo.replaceEventWindow("acc1", "cal1", Date.parse("2026-09-01T00:00:00Z"), Date.parse("2026-10-01T00:00:00Z"), sep);

    // A fresh August pull no longer contains aug1 (deleted remotely) — the
    // window replace drops it while September stays untouched.
    await repo.replaceEventWindow("acc1", "cal1", Date.parse("2026-08-01T00:00:00Z"), Date.parse("2026-09-01T00:00:00Z"), [
      ev("aug2", "2026-08-06T10:00:00Z", "2026-08-06T11:00:00Z"),
    ]);
    const all = await repo.listEvents(0, Date.parse("2027-01-01T00:00:00Z"));
    expect(all.map((e) => e.uid).sort()).toEqual(["aug2", "sep1"]);
  });

  it("listEvents filters deselected calendars, disabled accounts, cancelled events and series masters", async () => {
    await repo.replaceEventWindow("acc1", "cal1", 0, Date.parse("2027-01-01T00:00:00Z"), [
      ev("plain", "2026-08-01T10:00:00Z", "2026-08-01T11:00:00Z", { attendees: ["Anna"], etag: '"1"', blockOf: "source-uid" }),
      ev("master", "2026-08-03T09:00:00Z", "2026-08-03T09:15:00Z", { recurrence: "RRULE:FREQ=WEEKLY" }),
      ev("inst", "2026-08-03T09:00:00Z", "2026-08-03T09:15:00Z", { seriesMaster: "master" }),
      ev("gone", "2026-08-04T09:00:00Z", "2026-08-04T10:00:00Z", { status: "cancelled" }),
    ]);
    let rows = await repo.listEvents(0, Date.parse("2027-01-01T00:00:00Z"));
    expect(rows.map((e) => e.uid).sort()).toEqual(["inst", "plain"]);
    expect(rows.find((e) => e.uid === "plain")!.attendees).toEqual(["Anna"]);
    expect(rows.find((e) => e.uid === "plain")!.blockOf).toBe("source-uid");

    await repo.setCalendarSelected("acc1", "cal1", false);
    rows = await repo.listEvents(0, Date.parse("2027-01-01T00:00:00Z"));
    expect(rows).toEqual([]);

    await repo.setCalendarSelected("acc1", "cal1", true);
    await repo.upsertAccount({ id: "acc1", provider: "caldav", label: "Nextcloud", config: {}, enabled: false });
    rows = await repo.listEvents(0, Date.parse("2027-01-01T00:00:00Z"));
    expect(rows).toEqual([]);
  });

  it("getEventByUid returns the MASTER row that listEvents excludes (series-scope actions)", async () => {
    await repo.replaceEventWindow("acc1", "cal1", 0, Date.parse("2027-01-01T00:00:00Z"), [
      ev("master", "2026-08-03T09:00:00Z", "2026-08-03T09:15:00Z", { recurrence: "RRULE:FREQ=WEEKLY", etag: '"m1"', href: "https://x/series.ics" }),
      ev("inst", "2026-08-10T09:00:00Z", "2026-08-10T09:15:00Z", { seriesMaster: "master" }),
    ]);
    const master = await repo.getEventByUid("acc1", "cal1", "master");
    expect(master?.recurrence).toBe("RRULE:FREQ=WEEKLY");
    expect(master?.etag).toBe('"m1"');
    expect(master?.href).toBe("https://x/series.ics");
    expect(await repo.getEventByUid("acc1", "cal1", "missing")).toBeNull();
  });

  it("keeps the user's calendar/tasklist selection across refreshes", async () => {
    await repo.setCalendarSelected("acc1", "cal1", false);
    await repo.replaceCalendars("acc1", [
      { id: "cal1", name: "Privat (umbenannt)" },
      { id: "cal2", name: "Neu" },
    ]);
    const cals = await repo.listCalendars("acc1");
    expect(cals.find((c) => c.id === "cal1")!.selected).toBe(false); // preserved
    expect(cals.find((c) => c.id === "cal2")!.selected).toBe(true); // default on

    await repo.replaceTaskLists("acc1", [{ id: "l1", name: "A" }]);
    expect((await repo.listTaskLists("acc1"))[0].selected).toBe(false); // task lists default OFF
    await repo.setTaskListSelected("acc1", "l1", true);
    await repo.replaceTaskLists("acc1", [{ id: "l1", name: "A2" }]);
    expect((await repo.listTaskLists("acc1"))[0].selected).toBe(true);
  });

  it("stores tasks and scope state round-trip", async () => {
    await repo.replaceTaskLists("acc1", [{ id: "l1", name: "Aufgaben" }]);
    await repo.replaceTasks("acc1", "l1", [
      { uid: "t1", listId: "l1", title: "Angebot", due: "2026-08-01", completed: false, etag: "e", updatedTs: 123, notes: "N" },
    ]);
    const tasks = await repo.listTasks("acc1", "l1");
    expect(tasks[0]).toMatchObject({ uid: "t1", title: "Angebot", due: "2026-08-01", completed: false, etag: "e", updatedTs: 123, notes: "N" });

    await repo.setScopeState("acc1", "events:cal1", { cursor: "tok", lastSyncTs: 42, lastError: null });
    expect(await repo.getScopeState("acc1", "events:cal1")).toEqual({ cursor: "tok", lastSyncTs: 42, lastError: null });
  });

  it("round-trips per-event colour and RSVP details, deriving selfResponse", async () => {
    const range = Date.parse("2027-01-01T00:00:00Z");
    await repo.replaceEventWindow("acc1", "cal1", 0, range, [
      ev("e1", "2026-08-01T10:00:00Z", "2026-08-01T11:00:00Z", {
        color: "#f4511e",
        rsvps: [
          { name: "Chef", email: "chef@x.org", status: "accepted", organizer: true },
          { name: "Me", email: "me@x.org", status: "declined", self: true },
        ],
      }),
    ]);
    const [row] = await repo.listEvents(0, range);
    expect(row.color).toBe("#f4511e");
    expect(row.rsvps).toEqual([
      { name: "Chef", email: "chef@x.org", status: "accepted", organizer: true },
      { name: "Me", email: "me@x.org", status: "declined", self: true },
    ]);
    expect(row.selfResponse).toBe("declined");
    const single = await repo.getEventByUid("acc1", "cal1", "e1");
    expect(single?.color).toBe("#f4511e");
    expect(single?.selfResponse).toBe("declined");
  });
});
