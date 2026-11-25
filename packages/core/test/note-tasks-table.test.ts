import { beforeEach, describe, expect, it } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import type { BatchStatement } from "../src/db/IDatabaseAdapter.js";
import { initializeSchema } from "../src/db/Schema.js";
import { fillNoteTasks, TASK_READING } from "../src/db/noteTasks.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { fixtureFiles } from "../scripts/perf/fixtureVault.js";
import { initializeSchema as initializeSchemaV090 } from "./fixtures/v090/Schema.js";
import { VaultIndexer as VaultIndexerV090 } from "./fixtures/v090/VaultIndexer.js";
import {
  counted,
  expectEveryMixAnswersAsTheScan,
  expectSameAsScan,
  notesWithoutRow,
  random,
  randomNote,
  randomPath,
  steppingClock,
  writeRandomNotes,
} from "./helpers/taskListing.js";

/**
 * The task table of the index (db/noteTasks.ts): `listTasks` answers from it
 * exactly what it answered when it scanned the text of every note — proven
 * against that reading, kept word for word (`helpers/taskListing.ts`), over a
 * generated vault, over random notes through saves, renames and deletions,
 * over every state the table can be in, and with the frozen indexer and
 * schema of 0.9.0 (`fixtures/v090/`) writing to the same database.
 */

beforeEach(() => {
  expect.hasAssertions();
});

async function indexed(files: MemoryVaultAdapter) {
  const db = await realSqlite();
  await initializeSchema(db);
  const indexer = new VaultIndexer(files, db, { monotonicNow: steppingClock() });
  await indexer.indexVaultFull();
  return { db, indexer };
}

const orphans = `SELECT count(*) AS n FROM note_tasks t WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.rowid = t.file_rowid)`;
const taskTrigger = `SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name = 'files_tasks_go'`;

describe("the task table answers as the scan of every note did", () => {
  it("over the generated vault of the performance measurement", async () => {
    const files = new MemoryVaultAdapter(1_000);
    for (const file of fixtureFiles({ count: 400, longTableNote: false })) {
      if (typeof file.data === "string") await files.writeTextFile(file.path, file.data);
      else await files.writeBinaryFile(file.path, file.data);
    }
    const { db } = await indexed(files);
    expect(await notesWithoutRow(db)).toBe(0);
    const tasks = await expectSameAsScan(db);
    expect(tasks.length).toBeGreaterThan(400);
  });

  it("over random notes, through saves, renames, deletions and edits from outside", async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = random(seed);
      const files = new MemoryVaultAdapter(1_000);
      const paths: string[] = [];
      for (let i = 0; i < 60; i++) {
        const path = randomPath(r, i);
        if (paths.includes(path)) continue;
        paths.push(path);
        await files.writeTextFile(path, randomNote(r));
      }
      const { db, indexer } = await indexed(files);
      await expectSameAsScan(db);
      const queue = new SyncQueue(db);
      for (let step = 0; step < 40; step++) {
        const at = r.int(0, paths.length - 1);
        const path = paths[at];
        const kind = r.int(0, 4);
        if (kind === 0) {
          await files.writeTextFile(path, randomNote(r));
          await indexer.indexPath(path);
        } else if (kind === 1 && !path.startsWith("Journal/")) {
          const to = path.replace(/\.md$/, ` moved ${step}.md`);
          await files.renameItem(path, to);
          await indexer.relocatePathInIndex(path, to);
          paths[at] = to;
        } else if (kind === 2 && paths.length > 5) {
          await files.deleteItem(path);
          await indexer.indexPath(path);
          paths.splice(at, 1);
        } else if (kind === 3 && !path.startsWith("Journal/")) {
          // The app's own rename: the row's path moves, the full-text row lags until it is read again.
          const to = path.replace(/\.md$/, ` renamed ${step}.md`);
          await files.renameItem(path, to);
          await queue.queueRename(path, to);
          await expectSameAsScan(db, `step ${step}, the rename lags`);
          await indexer.indexPath(to);
          paths[at] = to;
        } else {
          // Changed outside the app: the next full pass reads it.
          await files.writeTextFile(path, randomNote(r));
          await indexer.indexVaultFull();
        }
        await expectSameAsScan(db, `seed ${seed}, step ${step}`);
      }
      expect(await notesWithoutRow(db)).toBe(0);
    }
  });

  it("in every state the table can be in: none, half filled in, another reading, an older build's notes in between", async () => {
    for (const seed of [21, 22, 23]) {
      const files = new MemoryVaultAdapter(1_000);
      await writeRandomNotes(files, seed, 70);
      const { db, indexer } = await indexed(files);
      await expectEveryMixAnswersAsTheScan(db, files, indexer);
    }
  });

  it("over an index from before the table: the same answer at once, and the next full pass fills it in without reading a file", async () => {
    const files = new MemoryVaultAdapter(1_000);
    await writeRandomNotes(files, 7, 80);
    const { db, indexer } = await indexed(files);
    // An index an earlier version built: no task table at all.
    await db.execute(`DROP TRIGGER files_tasks_go`);
    await db.execute(`DROP TABLE note_tasks`);
    await initializeSchema(db);
    expect(await notesWithoutRow(db)).toBeGreaterThan(50);
    await expectSameAsScan(db);

    let reads = 0;
    const read = files.readTextFile.bind(files);
    const readBytes = files.readBinaryFile.bind(files);
    files.readTextFile = async (path) => { reads++; return read(path); };
    files.readBinaryFile = async (path) => { reads++; return readBytes(path); };
    await indexer.indexVaultFull();
    expect(reads).toBe(0);
    expect(await notesWithoutRow(db)).toBe(0);
    await expectSameAsScan(db);
  });

  it("never lets a row count for another text: a number SQLite hands out again", async () => {
    const files = new MemoryVaultAdapter(1_000);
    await files.writeTextFile("A.md", "- [ ] a\n");
    await files.writeTextFile("B.md", "- [ ] b one\n- [ ] b two\n");
    const { db } = await indexed(files);
    // A row left behind at B's number (a REPLACE of an older build, say), and
    // then a new note written at that number without a row of its own.
    const b = (await db.queryOne<{ id: number }>(`SELECT rowid AS id FROM files WHERE path = 'B.md'`))!.id;
    await db.execute(`DROP TRIGGER files_tasks_go`);
    await db.execute(`DELETE FROM files WHERE path = 'B.md'`);
    await files.deleteItem("B.md");
    await files.writeTextFile("C.md", "- [x] c\n");
    await db.execute(
      `INSERT INTO files (rowid, id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, stamp_vouched, sync_state, fts_rowid)
       VALUES (?, 'older:C.md', 'C.md', 'C', 'sha-of-c', 1, 1, 1, 1, 'obsidian', 1, 'synced', 0)`,
      [b],
    );
    await db.execute(`INSERT OR REPLACE INTO fts_notes (content, title, path, seg_content, seg_title, rowid) VALUES ('- [x] c\n', 'C', 'C.md', '', '', ?)`, [-b]);
    const tasks = await expectSameAsScan(db);
    expect(tasks.map((t) => [t.path, t.text])).toEqual([["A.md", "a"], ["C.md", "c"]]);
  });

  it("never lets a row of another reading count, and the next full pass reads it anew", async () => {
    const files = new MemoryVaultAdapter(1_000);
    await files.writeTextFile("A.md", "- [ ] a\n- [x] b\n");
    const { db, indexer } = await indexed(files);
    // What a build with another reading of the same text left: other tasks under the same hash.
    await db.execute(`UPDATE note_tasks SET reading = ?, tasks = '[]'`, [TASK_READING + 1]);
    expect(await notesWithoutRow(db)).toBe(1);
    expect((await expectSameAsScan(db)).map((t) => t.text)).toEqual(["a", "b"]);
    await indexer.indexVaultFull();
    expect(await notesWithoutRow(db)).toBe(0);
    expect(await counted(db, `SELECT count(*) AS n FROM note_tasks WHERE reading = ${TASK_READING} AND tasks <> ''`)).toBe(1);
  });
});

describe("filling the table in", () => {
  it("writes one slice per statement batch, never more: a transaction on the phone holds a single slice", async () => {
    const files = new MemoryVaultAdapter(1_000);
    await writeRandomNotes(files, 31, 90);
    const { db } = await indexed(files);
    const writeAll = async (statements: BatchStatement[]) => { for (const s of statements) await db.execute(s.sql, s.params as unknown[]); };
    await db.execute(`DELETE FROM note_tasks`);
    const batches: number[] = [];
    const filled = await fillNoteTasks(db, {
      slice: 20,
      write: async (statements: BatchStatement[]) => {
        batches.push(statements.length);
        await writeAll(statements);
      },
    });
    expect(filled).toBeGreaterThan(40);
    expect(Math.max(...batches)).toBeLessThanOrEqual(20);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(filled);
    expect(await notesWithoutRow(db)).toBe(0);
  });

  it("stops between its slices once the vault is closed, and the next open goes on where it ended", async () => {
    const files = new MemoryVaultAdapter(1_000);
    await writeRandomNotes(files, 32, 90);
    const { db } = await indexed(files);
    const writeAll = async (statements: BatchStatement[]) => { for (const s of statements) await db.execute(s.sql, s.params as unknown[]); };
    await db.execute(`DELETE FROM note_tasks`);
    const missing = await notesWithoutRow(db);
    const closing = new AbortController();
    let slices = 0;
    await expect(fillNoteTasks(db, {
      slice: 10,
      signal: closing.signal,
      write: async (statements) => {
        await writeAll(statements);
        slices++;
        if (slices === 2) closing.abort(new Error("the vault is closed"));
      },
    })).rejects.toThrow(/the vault is closed/);
    expect(slices).toBe(2);
    expect(await notesWithoutRow(db)).toBe(missing - 20);
    await expectSameAsScan(db, "after a close half way");
    // The next open: a full pass of a new indexer goes on with the rest.
    const indexer = new VaultIndexer(files, db, { monotonicNow: steppingClock() });
    await indexer.indexVaultFull();
    expect(await notesWithoutRow(db)).toBe(0);
  });

  it("runs only once the full pass has written everything it writes", async () => {
    const files = new MemoryVaultAdapter(1_000);
    await writeRandomNotes(files, 33, 40);
    const db = await realSqlite();
    await initializeSchema(db);
    const steps: string[] = [];
    // The fill writes on the adapter itself, its own statement (`fillNoteTasks`); the pass in its transactions.
    const execute = db.execute.bind(db);
    db.execute = async (sql, params) => {
      if (/INTO note_tasks/.test(sql) && /WHERE rowid = \? AND sha256 IS \?/.test(sql)) steps.push("fill");
      return execute(sql, params);
    };
    const transaction = db.transaction.bind(db);
    db.transaction = async (fn) => { steps.push("pass"); return transaction(fn); };
    await db.execute(`DELETE FROM note_tasks`);
    // An index of this vault without the table's rows: the first pass writes notes and fills in the rest.
    const indexer = new VaultIndexer(files, db, { monotonicNow: steppingClock(), hearsNoChanges: true });
    await indexer.indexVaultFull();
    await db.execute(`DELETE FROM note_tasks WHERE file_rowid % 2 = 0`);
    await files.writeTextFile("Late.md", "- [ ] written before the second pass\n");
    steps.length = 0;
    await indexer.indexVaultFull();
    const firstFill = steps.indexOf("fill");
    expect(firstFill).toBeGreaterThan(0);
    expect(steps.slice(firstFill)).toEqual(steps.slice(firstFill).map(() => "fill"));
    expect(await notesWithoutRow(db)).toBe(0);
  });
});

describe("a database a 0.9.0 device opens (frozen schema and indexer of the tag)", () => {
  it("opens it, indexes, deletes, moves and rebuilds without a failure; its deletions take the rows along", async () => {
    const files = new MemoryVaultAdapter(1_000);
    await writeRandomNotes(files, 41, 50);
    await files.writeTextFile("Keep/Old.md", "- [ ] kept\n");
    await files.writeTextFile("Keep/Gone.md", "- [ ] to delete\n");
    const { db } = await indexed(files);
    expect(await counted(db, `SELECT count(*) AS n FROM note_tasks`)).toBeGreaterThan(0);

    // The downgrade: 0.9.0 opens the database with the table and the trigger in it.
    await initializeSchemaV090(db);
    const older = new VaultIndexerV090(files, db, { monotonicNow: steppingClock() });
    await older.indexVaultFull();
    await files.writeTextFile("Keep/Old.md", "- [x] kept, ticked on 0.9.0\n- [ ] and one more\n");
    await older.indexPath("Keep/Old.md");
    await files.deleteItem("Keep/Gone.md");
    await older.indexPath("Keep/Gone.md");
    await files.renameItem("Keep/Old.md", "Moved/Old.md");
    await older.relocatePathInIndex("Keep/Old.md", "Moved/Old.md");
    await files.writeTextFile("Keep/New.md", "- [ ] new on 0.9.0\n");
    await older.indexVaultFull();
    // No row stands for a file that is gone.
    expect(await counted(db, orphans)).toBe(0);
    await expectSameAsScan(db, "after 0.9.0 wrote");
    await older.rebuildIndex();
    await older.indexVaultFull();
    expect(await counted(db, orphans)).toBe(0);
    await expectSameAsScan(db, "after 0.9.0 rebuilt");

    // Back on this build: the same answer, and whole again after its pass.
    await initializeSchema(db);
    const indexer = new VaultIndexer(files, db, { monotonicNow: steppingClock() });
    await expectSameAsScan(db, "back on this build");
    await indexer.indexVaultFull();
    expect(await notesWithoutRow(db)).toBe(0);
    const tasks = await expectSameAsScan(db, "whole again");
    expect(tasks.filter((t) => t.path === "Moved/Old.md").map((t) => t.text)).toEqual(["kept, ticked on 0.9.0", "and one more"]);
  });

  it("where an older build makes `files` anew and the trigger goes with it: the check of the row carries until this build puts the trigger back", async () => {
    const files = new MemoryVaultAdapter(1_000);
    await writeRandomNotes(files, 42, 40);
    const { db } = await indexed(files);
    // `files` made anew: the trigger on it is gone with the table.
    await db.execute(`DROP TABLE files`);
    expect(await counted(db, taskTrigger)).toBe(0);
    await initializeSchemaV090(db);
    const older = new VaultIndexerV090(files, db, { monotonicNow: steppingClock() });
    await older.indexVaultFull();
    // Rows of before stand under numbers the new rows take again; only those of the same text count.
    const first = (await db.queryOne<{ path: string }>(`SELECT path FROM files WHERE path LIKE '%.md' ORDER BY rowid LIMIT 1`))!.path;
    await files.writeTextFile(first, "- [ ] another text at the first number\n");
    await older.indexVaultFull();
    await expectSameAsScan(db, "without the trigger");
    await initializeSchema(db);
    expect(await counted(db, taskTrigger)).toBe(1);
    await new VaultIndexer(files, db, { monotonicNow: steppingClock() }).indexVaultFull();
    expect(await notesWithoutRow(db)).toBe(0);
    await expectSameAsScan(db, "trigger back");
  });
});
