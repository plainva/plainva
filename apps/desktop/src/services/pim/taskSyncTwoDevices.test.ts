// @vitest-environment node
import { describe, expect, it, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  PimCacheRepository,
  initializeSchema,
  type IDatabaseAdapter,
  type IPimTarget,
  type PimTask,
  PimConflictError,
} from "@plainva/core";
import { runTaskSync, type TaskSyncAdapter, type TaskSyncOptions } from "./taskSync";

/**
 * Two devices, one vault — the situation the mobile reconciler creates.
 *
 * What is genuinely new is not multi-device use (the anchor was built for it)
 * but two reconcilers running at once. The shape matters: each device has its
 * OWN pim_task_state, because that table lives in the local index database.
 * Shared are only the vault (through file sync) and the provider. So the
 * questions here are not about the reconcile — taskSync.test.ts covers that —
 * but about what one device does when it meets the other's work with an empty
 * state table of its own.
 *
 * This does not replace the measurement on real hardware. It pins the
 * mechanisms that measurement would otherwise have to discover by accident.
 */

class NodeSqliteAdapter implements IDatabaseAdapter {
  private db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync(":memory:");
  }
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as any[]));
  }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as any[])) as T[];
  }
  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }
  async transaction<T>(fn: (a: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

const TASK_DB = [
  "properties:",
  "  note.status:",
  "    plainva:",
  "      input: status",
  "      options:",
  "        - value: Offen",
  "        - value: Erledigt",
  "views:",
  "  - type: table",
  "    name: Tabelle",
  "    order:",
  "      - file.name",
  "      - note.status",
  "filters:",
  "  and:",
  '    - file.folder == "Aufgaben"',
  "",
].join("\n");

/** THE shared vault: both devices read and write the same files. */
function sharedVault(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const adapter: TaskSyncAdapter = {
    readTextFile: async (p) => {
      const c = files.get(p);
      if (c === undefined) throw new Error("not found: " + p);
      return c;
    },
    writeTextFile: async (p, c) => {
      files.set(p, c);
    },
    exists: async (p) => files.has(p),
    createDir: async () => {},
  };
  return { adapter, files };
}

function fakeTarget(updateResult: { etag?: string } | Error = { etag: '"pushed"' }): IPimTarget {
  const boom = async () => {
    throw new Error("not under test");
  };
  return {
    provider: "caldav",
    listCalendars: boom,
    pullEvents: boom,
    listTaskLists: boom,
    pullTasks: boom,
    createEvent: boom,
    updateEvent: boom,
    deleteEvent: boom,
    createTask: boom,
    updateTask: vi.fn(async () => {
      if (updateResult instanceof Error) throw updateResult;
      return updateResult;
    }),
    deleteTask: vi.fn(async () => {}),
  } as unknown as IPimTarget;
}

function rt(p: Partial<PimTask> & { uid: string }): PimTask {
  return { listId: "l1", title: "Task", completed: false, ...p };
}

/** One device: its own database, its own cache, its own account id. */
async function device(accountId: string) {
  const db = new NodeSqliteAdapter();
  await initializeSchema(db);
  const cache = new PimCacheRepository(db);
  await cache.upsertAccount({ id: accountId, provider: "caldav", label: accountId, config: {}, enabled: true });
  await cache.replaceTaskLists(accountId, [{ id: "l1", name: "Aufgaben" }]);
  await cache.setTaskListSelected(accountId, "l1", true);
  return { db, cache, accountId };
}

/** The anchor index each device builds from the vault it can currently see. */
function anchorsOf(files: Map<string, string>): Map<string, unknown[]> {
  const map = new Map<string, unknown[]>();
  let ctime = 1000;
  for (const [path, content] of files) {
    if (!path.endsWith(".md")) continue;
    const uid = /uid: (\S+)/.exec(content)?.[1];
    if (!uid) continue;
    map.set(uid, [...(map.get(uid) ?? []), { path, uid, list: "l1", ctime: ctime++ }]);
  }
  return map;
}

function optsFor(
  dev: Awaited<ReturnType<typeof device>>,
  vault: ReturnType<typeof sharedVault>,
  target: IPimTarget | null,
  extra: Partial<TaskSyncOptions> = {}
): TaskSyncOptions {
  return {
    adapter: vault.adapter,
    cache: dev.cache,
    buildTarget: async () => target,
    taskDbPath: "Aufgaben.base",
    noteType: "Task",
    allNotePaths: [...vault.files.keys()].filter((p) => p.endsWith(".md")),
    anchorsByUid: anchorsOf(vault.files) as TaskSyncOptions["anchorsByUid"],
    ...extra,
  };
}

describe("two reconcilers on one vault", () => {
  let A: Awaited<ReturnType<typeof device>>;
  let B: Awaited<ReturnType<typeof device>>;

  beforeEach(async () => {
    // Different account ids on purpose: every reconnect mints a new one, so two
    // devices practically never agree on it. The anchor must not care.
    A = await device("device-a");
    B = await device("device-b");
  });

  const noteIn = (vault: ReturnType<typeof sharedVault>) =>
    [...vault.files.keys()].filter((p) => p.endsWith(".md"));

  it("the second device ADOPTS what the first imported — no second note", async () => {
    const task = rt({ uid: "u1", title: "Steuern einreichen", etag: '"e1"' });
    await A.cache.replaceTasks(A.accountId, "l1", [task]);
    await B.cache.replaceTasks(B.accountId, "l1", [task]);
    const vault = sharedVault({ "Aufgaben.base": TASK_DB });

    const first = await runTaskSync(optsFor(A, vault, null));
    expect(first.createdNotes).toHaveLength(1);

    // The note has synced across; B has never seen this task before and has an
    // empty state table of its own.
    const second = await runTaskSync(optsFor(B, vault, null));

    expect(second.createdNotes).toEqual([]);
    expect(second.adoptedNotes).toHaveLength(1);
    expect(noteIn(vault)).toHaveLength(1);
  });

  it("and if the note has not arrived yet, the gate holds the line", async () => {
    // The second defence. File sync lags behind the task cache, so B knows the
    // task while the note is still on its way — importing now is the duplicate.
    const task = rt({ uid: "u1", title: "Steuern einreichen", etag: '"e1"' });
    await A.cache.replaceTasks(A.accountId, "l1", [task]);
    await B.cache.replaceTasks(B.accountId, "l1", [task]);
    const vault = sharedVault({ "Aufgaben.base": TASK_DB });

    await runTaskSync(optsFor(A, vault, null));
    // B's view of the vault is still empty — it has not pulled the note.
    const stale = sharedVault({ "Aufgaben.base": TASK_DB });
    const second = await runTaskSync(optsFor(B, stale, null, { mayCreateNotes: false }));

    expect(second.createdNotes).toEqual([]);
    expect(second.deferredCreates).toBe(1);
  });

  it("a simultaneous push does not clobber: the loser keeps its base and retries", async () => {
    const task = rt({ uid: "u1", title: "Steuern einreichen", etag: '"e1"' });
    const vault = sharedVault({ "Aufgaben.base": TASK_DB });
    await A.cache.replaceTasks(A.accountId, "l1", [task]);
    await runTaskSync(optsFor(A, vault, null));
    await B.cache.replaceTasks(B.accountId, "l1", [task]);
    await runTaskSync(optsFor(B, vault, null));

    // Somebody renames the task locally. Both devices see the same file, so
    // both will try to push the SAME change — that is the race.
    const notePath = noteIn(vault)[0];
    vault.files.set(
      notePath,
      vault.files.get(notePath)!.replace("# Steuern einreichen", "# Steuern einreichen 2026")
    );

    // A wins the race; B meets an etag it no longer holds.
    const winner = fakeTarget({ etag: '"e2"' });
    const loser = fakeTarget(new PimConflictError("etag moved"));
    const aRes = await runTaskSync(optsFor(A, vault, winner));
    const bRes = await runTaskSync(optsFor(B, vault, loser));

    expect(aRes.pushed).toBe(1);
    expect(bRes.conflicts).toBe(1);
    // The loser keeps the OLD base, so its next cycle re-merges against fresh
    // remote data instead of pushing over the winner.
    const states = await B.cache.getTaskStates(B.accountId, "l1");
    expect(states[0].baseFields?.title).toBe("Steuern einreichen");
    // A, which won, DID move its base forward.
    const aStates = await A.cache.getTaskStates(A.accountId, "l1");
    expect(aStates[0].baseFields?.title).toBe("Steuern einreichen 2026");
    // And nobody rewrote the note behind the reader's back.
    expect(vault.files.get(notePath)).toContain("# Steuern einreichen 2026");
  });

  it("a note deleted on one device never resurrects on the other", async () => {
    // A deletes it (confirmed, so the provider follows on A's side). B only
    // ever sees a file that is gone — which is NOT a confirmed deletion, so it
    // must touch nothing remote, and it must not re-import either.
    const task = rt({ uid: "u1", title: "Steuern einreichen", etag: '"e1"' });
    const vault = sharedVault({ "Aufgaben.base": TASK_DB });
    await A.cache.replaceTasks(A.accountId, "l1", [task]);
    await B.cache.replaceTasks(B.accountId, "l1", [task]);
    await runTaskSync(optsFor(A, vault, null));
    await runTaskSync(optsFor(B, vault, null));

    const notePath = noteIn(vault)[0];
    vault.files.delete(notePath);

    const target = fakeTarget();
    const bRes = await runTaskSync(optsFor(B, vault, target));

    expect(target.deleteTask).not.toHaveBeenCalled();
    expect(bRes.deletedRemote).toBe(0);
    // The state row survives WITHOUT a note path — that is the tombstone, and
    // it is what stops the next cycle from importing the task all over again.
    const states = await B.cache.getTaskStates(B.accountId, "l1");
    expect(states).toHaveLength(1);
    expect(states[0].notePath).toBeNull();

    // And a later cycle does not bring the note back.
    const again = await runTaskSync(optsFor(B, vault, target));
    expect(again.createdNotes).toEqual([]);
    expect(noteIn(vault)).toEqual([]);
  });
});
