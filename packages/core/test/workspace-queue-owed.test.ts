import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import type { QueueEntryReport } from "../src/vault/owedQueueEntries.ts";
import { WorkspaceQueueingVaultAdapter } from "../src/workspace/queueingVaultAdapter.ts";
import { SqlWorkspaceStateStore } from "../src/workspace/state.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { beforeEveryWrite, realSqlite } from "./helpers/realSqlite.ts";

/**
 * The encrypted workspace's queue loses no entry (Datensicherheit D2).
 *
 * `WorkspaceQueueingVaultAdapter` changes the disk first and queues the
 * signed-workspace mutation second, like the vault's chain. An entry that
 * failed used to fail the write at once — for a file that was written — and
 * a deletion or rename of a folder that failed on its third child had queued
 * the first two and nothing after. And a second attempt queued the same
 * mutation again. Now the entry is made up for while the write waits
 * (`OwedQueueEntries`, shared with `QueueingVaultAdapter`), the store takes the
 * same mutation twice as one, and only an entry given up fails the write and
 * is reported. While it is owed, the store answers for it (`hasPendingForPath`):
 * the workspace's worker does not bring back a file whose deletion waits.
 */

let root: string;
let disk: LocalVaultAdapter;
let db: IDatabaseAdapter;
let state: SqlWorkspaceStateStore;
let reports: QueueEntryReport[];
const made: WorkspaceQueueingVaultAdapter[] = [];
/** Refuses the next `times` inserts into the workspace's queue — a locked or closing database. */
let refusals = 0;
let refused = 0;

const workspace = (options: ConstructorParameters<typeof WorkspaceQueueingVaultAdapter>[2] = {}) => {
  const adapter = new WorkspaceQueueingVaultAdapter(disk, state, { onEntry: (report) => reports.push(report), retryAtMs: [5, 15, 35], ...options });
  made.push(adapter);
  return adapter;
};
/** Waits until `done` holds — never a fixed time: a loaded machine is slow. */
const until = async (done: () => boolean, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error(`waited in vain for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
const queued = async () => (await state.listQueue()).map((entry) => `${entry.operation} ${entry.path}${entry.newPath ? ` -> ${entry.newPath}` : ""}`);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-workspace-owed-"));
  disk = new LocalVaultAdapter(root);
  await disk.initialize();
  db = await realSqlite();
  beforeEveryWrite(db, (sql) => {
    if (refusals > 0 && /INSERT INTO workspace_queue/.test(sql)) {
      refusals -= 1;
      refused += 1;
      throw new Error("database is locked");
    }
  });
  state = new SqlWorkspaceStateStore(db);
  reports = [];
  refusals = 0;
  refused = 0;
});

afterEach(async () => {
  refusals = 0;
  for (const each of made.splice(0)) await each.flush();
  await disk.dispose();
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe("an entry of the encrypted workspace's queue that fails after the change is on disk", () => {
  it("does not fail the write: it is made up for, exactly once, and the write returns once it is queued", async () => {
    const adapter = workspace();
    refusals = 1;
    // It used to reject here: "database is locked", for a file that was written.
    await adapter.writeTextFile("Note.md", "the text");
    expect(await disk.readTextFile("Note.md")).toBe("the text");
    expect(refused).toBe(1);
    expect(await queued()).toEqual(["write Note.md"]);
    expect(reports).toEqual([{ outcome: "made-up", kind: "write", attempts: 2 }]);
  });

  it("a folder deleted while the third entry fails: every path is queued, each once", async () => {
    const adapter = workspace();
    for (const name of ["a.md", "b.md", "c.md"]) await adapter.writeTextFile(`Folder/${name}`, name);
    const before = (await queued()).length;
    // Deleted longest path first: Folder/c.md, Folder/b.md, Folder/a.md, Folder.
    let inserts = 0;
    beforeEveryWrite(db, (sql) => {
      if (/INSERT INTO workspace_queue/.test(sql) && ++inserts === 3) throw new Error("database is locked");
    });
    await adapter.deleteItem("Folder", true);
    const deletes = (await queued()).slice(before);
    expect([...deletes].sort()).toEqual(["delete Folder", "delete Folder/a.md", "delete Folder/b.md", "delete Folder/c.md"]);
    expect(reports.at(-1)).toEqual({ outcome: "made-up", kind: "delete", attempts: 2 });
  });

  it("a folder moved while an entry fails: every move is queued, each once", async () => {
    const adapter = workspace();
    await adapter.writeTextFile("Old/a.md", "a");
    await adapter.writeTextFile("Old/b.md", "b");
    const before = (await queued()).length;
    let inserts = 0;
    beforeEveryWrite(db, (sql) => {
      if (/INSERT INTO workspace_queue/.test(sql) && ++inserts === 2) throw new Error("database is locked");
    });
    await adapter.renameItem("Old", "New");
    expect((await queued()).slice(before)).toEqual(["rename Old -> New", "rename Old/a.md -> New/a.md", "rename Old/b.md -> New/b.md"]);
  });

  it("an entry that keeps failing is given up: then the write fails, and the report names the database's words", async () => {
    let now = 0;
    const adapter = workspace({ now: () => now, giveUpAfterMs: 1_000, retryAtMs: [5] });
    refusals = 1_000;
    const write = adapter.writeTextFile("Note.md", "the text").then(() => "saved", (error: Error) => error.message);
    await new Promise((resolve) => setTimeout(resolve, 20));
    now = 2_000;
    expect(await write).toBe("database is locked");
    // On disk it is — the index announces it on its next pass.
    expect(await disk.readTextFile("Note.md")).toBe("the text");
    expect(await queued()).toEqual([]);
    expect(reports.at(-1)).toMatchObject({ outcome: "lost", kind: "write" });
  });

  it("while a deletion is owed, the store answers for it: the worker does not bring the file back (D4)", async () => {
    const adapter = workspace({ retryAtMs: [60_000] });
    await adapter.writeTextFile("Gone.md", "gone");
    refusals = 1;
    const deleting = adapter.deleteItem("Gone.md");
    await until(() => refused === 1, "the entry's first attempt");
    // Not in the queue yet — its next attempt is a minute away.
    expect(await queued()).toEqual(["write Gone.md"]);
    expect(await state.hasPendingForPath("Gone.md")).toBe(true);
    expect(await state.listQueuedPaths()).toContain("Gone.md");
    await adapter.flush();
    await deleting;
    expect(await queued()).toEqual(["write Gone.md", "delete Gone.md"]);
  });

  it("a vault that closes ends what it owes: `dispose` gives every entry its last attempt and no longer answers for it", async () => {
    const adapter = workspace({ retryAtMs: [60_000] });
    refusals = 1;
    const write = adapter.writeTextFile("Note.md", "the text");
    await until(() => refused === 1, "the entry's first attempt");
    await adapter.dispose();
    await write;
    expect(await queued()).toEqual(["write Note.md"]);
    expect(await state.hasPendingForPath("Other.md")).toBe(false);
  });
});
