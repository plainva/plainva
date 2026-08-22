import { describe, expect, it, beforeEach } from "vitest";
import { PimCacheRepository } from "../src/pim/PimCacheRepository.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";

/**
 * Moving one account's cached rows onto another — the write half of merging two
 * sign-ins that turned out to be the same account.
 *
 * This runs against REAL SQLite (node:sqlite) on purpose. Every rule under test
 * is SQL semantics: `UPDATE OR IGNORE` skipping a primary-key collision, the
 * `ON DELETE CASCADE` on pim_calendars that makes the ORDER matter, and the
 * orphan sweep that would quietly eat a task anchor the move forgot. A
 * recording mock would accept all of it and prove none of it — the same trap
 * the mobile fakes fell into.
 *
 * The stake is `pim_task_state`: it is the ONLY thing tying a task note to the
 * task it came from. Lose a row and the reconcile no longer recognises the
 * note, imports the task a second time, and stops propagating its deletion.
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

let db: any;
let repo: PimCacheRepository;

/** The account that has been here a while, with a full local state. */
const OLD = "old-acct";
/** The one a fresh connect just minted. */
const NEW = "new-acct";

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  // Foreign keys are off by default in SQLite; the cascade only bites with them on.
  db.exec("PRAGMA foreign_keys = ON;");
  const adapter = new NodeSqliteAdapter(db);
  await initializeSchema(adapter);
  repo = new PimCacheRepository(adapter);

  await repo.upsertAccount({ id: OLD, provider: "google", label: "me@example.com", config: {}, enabled: true });
  await repo.upsertAccount({ id: NEW, provider: "google", label: "me@example.com", config: {}, enabled: true });
});

async function taskStateRows(): Promise<Array<{ account_id: string; uid: string; note_path: string | null }>> {
  return db.prepare(`SELECT account_id, uid, note_path FROM pim_task_state ORDER BY account_id, uid`).all();
}

describe("reassignAccountRows", () => {
  it("moves the task anchors — without them the reconcile imports every task twice", async () => {
    await repo.upsertTaskState({
      accountId: NEW,
      listId: "list1",
      uid: "t1",
      notePath: "Tasks/Steuern.md",
      remoteEtag: "e1",
      baseFields: null,
    });

    await repo.reassignAccountRows(NEW, OLD);

    expect(await taskStateRows()).toEqual([
      { account_id: OLD, uid: "t1", note_path: "Tasks/Steuern.md" },
    ]);
  });

  it("lets the TARGET win a collision — its row is the one with the history", async () => {
    // Same task known to both: the old account has learned where the note is,
    // the fresh one has half a cycle behind it and knows nothing.
    await repo.upsertTaskState({
      accountId: OLD,
      listId: "list1",
      uid: "t1",
      notePath: "Tasks/Steuern.md",
      remoteEtag: "old-etag",
      baseFields: null,
    });
    await repo.upsertTaskState({
      accountId: NEW,
      listId: "list1",
      uid: "t1",
      notePath: null,
      remoteEtag: "fresh-etag",
      baseFields: null,
    });

    await repo.reassignAccountRows(NEW, OLD);

    const rows = await taskStateRows();
    expect(rows).toHaveLength(1);
    // Had the source won, the note path would be gone and the note orphaned.
    expect(rows[0]).toEqual({ account_id: OLD, uid: "t1", note_path: "Tasks/Steuern.md" });
    const etag = db.prepare(`SELECT remote_etag FROM pim_task_state WHERE account_id = ?`).get(OLD);
    expect(etag.remote_etag).toBe("old-etag");
  });

  it("leaves nothing behind under the old id, collision or not", async () => {
    await repo.upsertTaskState({ accountId: OLD, listId: "l", uid: "shared", notePath: "A.md", remoteEtag: null, baseFields: null });
    await repo.upsertTaskState({ accountId: NEW, listId: "l", uid: "shared", notePath: null, remoteEtag: null, baseFields: null });
    await repo.upsertTaskState({ accountId: NEW, listId: "l", uid: "only-fresh", notePath: "B.md", remoteEtag: null, baseFields: null });

    await repo.reassignAccountRows(NEW, OLD);

    const rows = await taskStateRows();
    expect(rows.map((r) => r.account_id)).toEqual([OLD, OLD]);
    expect(rows.map((r) => r.uid).sort()).toEqual(["only-fresh", "shared"]);
  });

  it("moves calendars, task lists, events, tasks and cursors, not just the anchors", async () => {
    await repo.replaceCalendars(NEW, [{ id: "cal1", name: "Privat" }]);
    await repo.replaceTaskLists(NEW, [{ id: "list1", name: "Aufgaben" }]);
    await repo.replaceTasks(NEW, "list1", [{ uid: "t1", listId: "list1", title: "Steuern", completed: false }]);
    await repo.setScopeState(NEW, "calendars", { cursor: "c-42", lastSyncTs: 1, lastError: null });

    await repo.reassignAccountRows(NEW, OLD);

    expect((await repo.listCalendars(OLD)).map((c) => c.id)).toEqual(["cal1"]);
    expect((await repo.listTaskLists(OLD)).map((l) => l.id)).toEqual(["list1"]);
    expect((await repo.listTasks(OLD, "list1")).map((t) => t.uid)).toEqual(["t1"]);
    expect((await repo.getScopeState(OLD, "calendars"))?.cursor).toBe("c-42");
    expect(await repo.listCalendars(NEW)).toEqual([]);
  });

  it("survives the orphan sweep — a moved row belongs to a live account", async () => {
    // The sweep is what makes a forgotten row DISAPPEAR rather than linger: it
    // deletes everything whose account is gone. Moving first is the whole point.
    await repo.upsertTaskState({ accountId: NEW, listId: "l", uid: "t1", notePath: "A.md", remoteEtag: null, baseFields: null });

    await repo.reassignAccountRows(NEW, OLD);
    await repo.deleteAccount(NEW);
    await repo.pruneOrphanedRows();

    expect(await taskStateRows()).toEqual([{ account_id: OLD, uid: "t1", note_path: "A.md" }]);
  });

  it("is a no-op when both ids are the same", async () => {
    await repo.upsertTaskState({ accountId: OLD, listId: "l", uid: "t1", notePath: "A.md", remoteEtag: null, baseFields: null });
    await repo.reassignAccountRows(OLD, OLD);
    expect(await taskStateRows()).toEqual([{ account_id: OLD, uid: "t1", note_path: "A.md" }]);
  });

  it("keeps the account rows themselves apart — the caller deletes the old one", async () => {
    await repo.reassignAccountRows(NEW, OLD);
    expect((await repo.listAccounts()).map((a) => a.id).sort()).toEqual([NEW, OLD].sort());
  });
});
