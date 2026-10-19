// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import {
  BackupVaultAdapter, ConflictAwareVaultAdapter, DEFAULT_BACKUP_RETENTION, QueueingVaultAdapter, SyncQueue, SyncStateRepository,
  formatQueueEntryReport, type IDatabaseAdapter, type QueueEntryReport,
} from "@plainva/core";
import { LocalVaultAdapter } from "../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../packages/core/test/helpers/realSqlite";
import { sourceFile } from "./test-sourceTree";

/**
 * What the change in the core means for the desktop (finding 2026-10-12): a
 * write whose entry in the sync queue fails after the file is saved is a
 * write.
 *
 * The phone's database refused a second transaction while one was open; the
 * desktop's adapter has always queued them (`TauriDatabaseAdapter`: a lock in
 * front of a pool, each statement committed by itself). So on the desktop an
 * entry rarely fails — but it can: a statement that finds the database locked
 * by another connection for longer than the pool waits (the native batch of
 * the calendar cache or of a cold index runs on a connection of its own), or a
 * vault closing under a write. What followed was the phone's story: the editor
 * heard "not saved" for a saved file, the chain did not take note of its own
 * write, and nothing was queued. Now the entry is made up for while the save
 * waits, the vault context hears of it once it is there
 * (`plainva-sync-queued`, which starts a sync soon), and the diagnostics name
 * an entry that is made up for or given up — one given up 30 seconds after its
 * change fails the save as before, so that the index announces the file (the
 * core's queueing-vault-adapter-owed test).
 *
 * The database here is a real SQLite behind what the desktop's adapter does
 * with a transaction — a lock, no BEGIN — that finds the queue's table locked
 * as often as a test says. The pool answers a lock only after it has waited
 * five seconds (sqlx's busy timeout, which tauri-plugin-sql's pool keeps): the
 * test's clock moves on by that much before the statement fails, so the entry
 * is tried again at its next time after that, 5.25 seconds after the change.
 */

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** What the pool waits for a lock before it answers. */
const POOL_BUSY_WAIT_MS = 5_000;
/** The test's clock: what the adapter measures its times with. */
let clock = 0;

/** `TauriDatabaseAdapter.transaction`: a lock and nothing else — and an INSERT into the queue that can find the table locked. */
function desktopDatabase(inner: IDatabaseAdapter) {
  let tail: Promise<unknown> = Promise.resolve();
  let locked = 0;
  const database: IDatabaseAdapter = {
    initialize: () => inner.initialize(),
    close: () => inner.close(),
    async execute(sql, params) {
      if (locked > 0 && /INSERT INTO offline_queue/.test(sql)) {
        locked -= 1;
        clock += POOL_BUSY_WAIT_MS;
        throw new Error("error returned from database: (code: 5) database is locked");
      }
      return inner.execute(sql, params);
    },
    query: (sql, params) => inner.query(sql, params),
    queryOne: (sql, params) => inner.queryOne(sql, params),
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      const turn = tail.then(fn);
      tail = turn.catch(() => {});
      return turn;
    },
  };
  return { database, lockNext: (times: number) => { locked = times; } };
}

let root: string, disk: LocalVaultAdapter, db: IDatabaseAdapter, lockNext: (times: number) => void;
let repo: SyncStateRepository, vaultAdapter: ConflictAwareVaultAdapter, queueing: QueueingVaultAdapter;
let reports: string[], told: number, merges: number;
const toldOnce = () => { told += 1; };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-desktop-queue-entry-"));
  disk = new LocalVaultAdapter(root);
  await disk.initialize();
  const sqlite = desktopDatabase(await realSqlite());
  db = sqlite.database;
  lockNext = sqlite.lockNext;
  reports = []; told = 0; merges = 0;
  window.addEventListener("plainva-sync-queued", toldOnce);
  // VaultContext: the files, above them versions, the sync queue and the conflict check.
  const backup = new BackupVaultAdapter(disk, { policy: DEFAULT_BACKUP_RETENTION });
  repo = new SyncStateRepository(db, backup, "desktop-a");
  clock = 0;
  queueing = new QueueingVaultAdapter(backup, new SyncQueue(db), {
    onEntry: (report: QueueEntryReport) => reports.push(formatQueueEntryReport(report)),
    now: () => clock,
  });
  vaultAdapter = new ConflictAwareVaultAdapter(queueing, repo, () => { merges += 1; }, repo, "external-folder");
});

afterEach(async () => {
  window.removeEventListener("plainva-sync-queued", toldOnce);
  await queueing.dispose();
  await db.close();
  await rm(root, { recursive: true, force: true });
});

const queued = async () =>
  (await db.query<{ operation: string; file_path: string }>("SELECT operation, file_path FROM offline_queue ORDER BY id")).map((op) => `${op.operation} ${op.file_path}`);

describe("on the desktop, an entry of the sync queue that finds the database locked", () => {
  it("does not fail the save: the save returns once the entry is made up for — the chain knows the note, and the vault context has heard of it", async () => {
    const synced = "# Letter\n\nDear Ada,\n";
    await disk.writeTextFile("Letter.md", synced);
    await repo.updateLocalHashAndBaseText("Letter.md", sha(synced), synced);

    lockNext(1);
    const typed = `${synced}thank you for`;
    // It used to reject: "database is locked", for a note that was saved.
    await vaultAdapter.writeTextFile("Letter.md", typed);
    expect(await disk.readTextFile("Letter.md")).toBe(typed);
    expect((await repo.getSyncState("Letter.md"))?.local_sha256).toBe(sha(typed));
    expect(await queued()).toEqual(["write Letter.md"]);
    expect(told).toBe(1);
    expect(reports).toEqual(["a write entry of the sync queue was written after 2 attempts — it had failed after the change was on disk"]);

    // Typing on is an ordinary save: nothing to merge, no conflict copy.
    const typedOn = `${typed} the letter.\n`;
    await vaultAdapter.writeTextFile("Letter.md", typedOn);
    expect(await disk.readTextFile("Letter.md")).toBe(typedOn);
    expect(merges).toBe(0);
    expect(await vaultAdapter.listConflictSessions()).toEqual([]);
    expect((await readdir(root)).filter((name) => name.includes(".CONFLICT"))).toEqual([]);
  });

  it("the vault context hands its chain the reporter: a made-up or lost entry is a line in the diagnostics", () => {
    const context = ts.createSourceFile("VaultContext.tsx", sourceFile("apps/desktop/src/contexts/VaultContext.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const built: string[] = [];
    (function visit(node: ts.Node) {
      if (ts.isNewExpression(node) && node.expression.getText(context) === "QueueingVaultAdapter") built.push(node.getText(context));
      ts.forEachChild(node, visit);
    })(context);
    expect(built).toHaveLength(1);
    expect(built[0]).toMatch(/onEntry: \(report\) => logDiagnostic\("sync", formatQueueEntryReport\(report\)\)/);
  });
});
