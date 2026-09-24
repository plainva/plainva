import { beforeEach, describe, expect, it } from "vitest";
import { PimCacheRepository } from "../src/pim/PimCacheRepository.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";

/**
 * Re-saving an account keeps its calendars, task lists and their selection
 * (finding 2026-09-24, E2).
 *
 * `upsertAccount` wrote with `INSERT OR REPLACE`. SQLite resolves that conflict
 * by deleting the old row, and with foreign keys ON — as both shells run — the
 * delete cascaded to `pim_calendars` and `pim_tasklists`. Every re-save emptied
 * them: the connect wizard right after connecting ("0 calendars found"), every
 * settings sync, every profile import. The next pull brought the lists back,
 * all selected again, so task lists switched off came back into the vault.
 *
 * The earlier cache tests ran with foreign keys OFF, which is why they never
 * saw it. This file runs them ON, like the app.
 */

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
    return (this.db.prepare(sql).all(...(params as never[])) as T[])[0] ?? null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

describe("re-saving a PIM account with foreign keys on", () => {
  let repo: PimCacheRepository;
  const google = { id: "g1", provider: "google" as const, label: "m.muster@gmail.com", config: { clientId: "c" }, enabled: false };

  beforeEach(async () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec("PRAGMA foreign_keys = ON;");
    const db = new NodeSqliteAdapter(raw);
    await initializeSchema(db);
    repo = new PimCacheRepository(db);
    await repo.upsertAccount(google);
    await repo.replaceCalendars("g1", [
      { id: "primary", name: "Marco" },
      { id: "holidays", name: "Feiertage" },
      { id: "family", name: "Familie" },
    ]);
    await repo.replaceTaskLists("g1", [
      { id: "inbox", name: "Meine Aufgaben" },
      { id: "shopping", name: "Einkauf" },
    ]);
    // The person's choices, which must outlive every re-save.
    await repo.setCalendarSelected("g1", "holidays", false);
    await repo.setTaskListSelected("g1", "shopping", false);
  });

  const selection = async () => ({
    calendars: (await repo.listCalendars("g1")).map((c) => [c.id, c.selected]).sort(),
    taskLists: (await repo.listTaskLists("g1")).map((l) => [l.id, l.selected]).sort(),
  });
  const expected = {
    calendars: [["family", true], ["holidays", false], ["primary", true]],
    taskLists: [["inbox", true], ["shopping", false]],
  };

  it.each([
    // cloudAccountsActions.bindConnectResult: switch the calendar on after connecting.
    ["the connect wizard enabling the account", { ...google, enabled: true }],
    // pimAccounts / pimService: a fresh label and identity after sign-in.
    ["a sign-in renaming it", { ...google, label: "Marco (Google)", config: { clientId: "c", plainvaVerifiedProviderIdentity: { provider: "google", subject: "1" } } }],
    // settingsProfile / mobileSettingsSync / profileImportJournal: the same row again.
    ["a settings sync writing the unchanged row", { ...google }],
  ])("keeps calendars, task lists and their selection through %s", async (_why, row) => {
    await repo.upsertAccount(row);
    expect(await selection()).toEqual(expected);
    const [stored] = await repo.listAccounts();
    expect(stored).toEqual({ ...row, config: row.config });
  });

  it("still removes everything when the account itself is deleted", async () => {
    await repo.deleteAccount("g1");
    expect(await repo.listCalendars("g1")).toEqual([]);
    expect(await repo.listTaskLists("g1")).toEqual([]);
  });
});
