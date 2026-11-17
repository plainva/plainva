import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer, type VaultIndexerOptions } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { VaultFileNotFoundError } from "../src/vault/IVaultAdapter.js";
import { noteIndexChange } from "../src/db/indexChanges.js";

/**
 * A reading changed in the database since it began is set aside and read
 * again (db/indexChanges.ts, `VaultIndexer.changesSince`) — whoever changed
 * it: the app moving a folder, the sync having sent that move already, the
 * encrypted workspace's own queue, a save recording its hash, the app
 * removing a file the index held no row for.
 *
 * The full scan reads a file before the transaction that writes its row.
 * Rules tied to one writer each left gaps: a new file read in a folder the
 * app then moved came back as a row at its old path, which the next scan reported deleted — the sync then
 * deletes it on the server; and a reading of the text before a save, written
 * after the save recorded its hash, reported the app's own save as a foreign
 * change.
 *
 * Real files and a real SQLite. The scan's read of one file is held with its
 * answer until the test lets it go, so the change lands between the read and
 * the write.
 */

let root: string;
let raw: LocalVaultAdapter;
let db: IDatabaseAdapter;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-changed-since-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

/** The vault, with the next read of `held` made at once and its answer held until `release()`. */
function holdingReadOf(held: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reached!: () => void;
  const reading = new Promise<void>((resolve) => { reached = resolve; });
  let armed = true;
  const vault = new Proxy(raw, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (key !== "readBinaryFile" && key !== "readTextFile") return value.bind(target);
      return async (p: string, ...rest: unknown[]) => {
        const answer = await (value as (...a: unknown[]) => Promise<unknown>).call(target, p, ...rest);
        if (armed && p === held) {
          armed = false;
          reached();
          await gate;
        }
        return answer;
      };
    },
  });
  return { vault, release, reading };
}

const rows = async () => (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((row) => row.path);
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** An indexer over `vault` that notes what it reports. */
function reporting(vault: LocalVaultAdapter, options: VaultIndexerOptions = {}) {
  const deleted: string[] = [];
  const mods: string[] = [];
  const indexer = new VaultIndexer(vault, db, {
    onLocalFileDeleted: (p) => deleted.push(p),
    onExternalModification: (p) => mods.push(p),
    ...options,
  });
  return { indexer, deleted, mods };
}

describe("a reading moved away in the database since it began is not written back", () => {
  /** The app moves folder A to B while the scan has read the new file A/n.md; `record` writes what the app's flow writes besides the move of the rows. */
  async function folderMovedDuringTheRead(record: () => Promise<void>) {
    await raw.writeTextFile("A/old.md", "# old\n");
    await new VaultIndexer(raw, db).indexVaultFull();
    // New, not indexed yet.
    await raw.writeTextFile("A/n.md", "# n\n\nfresh\n");
    const { vault, release, reading } = holdingReadOf("A/n.md");
    const { indexer, deleted } = reporting(vault);
    const scan = indexer.indexVaultFull();
    await reading;
    await fs.rename(path.join(root, "A"), path.join(root, "B"));
    await record();
    await indexer.relocatePathInIndex("A", "B");
    release();
    await scan;
    expect(await rows(), "no row for a file that is not there").toEqual(["B/old.md"]);
    // The next scan finds the moved file, and nothing gone.
    await indexer.indexVaultFull("folder moved in the app");
    expect(await rows()).toEqual(["B/n.md", "B/old.md"]);
    expect(deleted, "no deletion reported, none queued for the server").toEqual([]);
  }

  it("a folder moved in the app, its move already sent by the sync", async () => {
    await folderMovedDuringTheRead(async () => {
      await new SyncQueue(db).queueRename("A", "B");
      // The sync sent the move up and removed its entry while the scan was still reading.
      await db.execute("DELETE FROM offline_queue WHERE operation = 'rename'");
    });
  });

  it("a folder moved in the app in an encrypted workspace, whose moves wait in the workspace's own queue", async () => {
    await folderMovedDuringTheRead(async () => {
      await db.execute("INSERT INTO workspace_queue (operation, path, new_path, queued_at) VALUES ('rename', 'A', 'B', 0)");
    });
  });

  it("a folder moved in a vault that has no sync at all", async () => {
    await folderMovedDuringTheRead(async () => {});
  });

  /** The app moves `from` to `to` while the scan has read `held`, a new file no row of the index moves with. */
  async function movedWithoutARow(seed: string[], held: string, from: string, to: string, expected: string[]) {
    await raw.writeTextFile("keep.md", "# keep\n");
    await new VaultIndexer(raw, db).indexVaultFull();
    for (const file of seed) await raw.writeTextFile(file, "# new\n");
    const { vault, release, reading } = holdingReadOf(held);
    const { indexer, deleted } = reporting(vault);
    const scan = indexer.indexVaultFull();
    await reading;
    await fs.rename(path.join(root, from), path.join(root, to));
    await indexer.relocatePathInIndex(from, to);
    release();
    await scan;
    expect(await rows(), "no row for a file that is not there").not.toContain(held);
    await indexer.indexVaultFull();
    expect(await rows()).toEqual(expected);
    expect(deleted).toEqual([]);
  }

  it("a new file the app renames while the scan reads it", async () => {
    await movedWithoutARow(["X.md"], "X.md", "X.md", "Y.md", ["Y.md", "keep.md"]);
  });

  it("a folder of new files only, moved by the app while the scan reads one of them", async () => {
    await movedWithoutARow(["A/n.md"], "A/n.md", "A", "B", ["B/n.md", "keep.md"]);
  });

  it("a new file the app removes while the scan reads it", async () => {
    await raw.writeTextFile("Notes/keep.md", "# keep\n");
    await new VaultIndexer(raw, db).indexVaultFull();
    await raw.writeTextFile("Notes/new.md", "# new\n");
    const { vault, release, reading } = holdingReadOf("Notes/new.md");
    const { indexer, deleted } = reporting(vault);
    const scan = indexer.indexVaultFull();
    await reading;
    await fs.rm(path.join(root, "Notes/new.md"));
    await indexer.removePathFromIndex("Notes/new.md");
    release();
    await scan;
    expect(await rows()).toEqual(["Notes/keep.md"]);
    deleted.length = 0;
    await indexer.indexVaultFull();
    expect(deleted).toEqual([]);
  });
});

describe("a reading older than a save's recorded hash is not written over it", () => {
  it("rebuilding the index while a note is saved reports no foreign change", async () => {
    await raw.writeTextFile("X.md", "# X\n\nv1\n");
    const own = new Map<string, string>();
    const { vault, release, reading } = holdingReadOf("X.md");
    const { indexer, mods } = reporting(vault, { isOwnWrite: (p, h) => own.get(p) === h });
    // A first scan; the hold is for the rebuild's read.
    await new VaultIndexer(raw, db).indexVaultFull();
    const rebuild = indexer.rebuildIndex();
    await reading;
    // The save: the file, the adapter's memory of its own write, the hash it recorded.
    await raw.writeTextFile("X.md", "# X\n\nv2\n");
    own.set("X.md", sha("# X\n\nv2\n"));
    await new SyncStateRepository(db).updateLocalHash("X.md", sha("# X\n\nv2\n"));
    release();
    await rebuild;
    // The save's own pass.
    await indexer.indexFile(await raw.getFileInfo("X.md"));
    expect(mods, "the app's own save is no foreign change").toEqual([]);
    expect((await new VaultQueryService(db).searchFullText("v2")).map((hit) => hit.path)).toEqual(["X.md"]);
  });

  it("an orphaned sync row does not end up naming a text that is no longer on disk", async () => {
    await raw.writeTextFile("X.md", "# X\n\nv1\n");
    // The sync knows the file; the index holds no row for it (a file of another device, an index rebuilt).
    await new SyncStateRepository(db).updateLocalHash("X.md", sha("# X\n\nv0\n"));
    const { vault, release, reading } = holdingReadOf("X.md");
    const { indexer, mods } = reporting(vault);
    const scan = indexer.indexVaultFull();
    await reading;
    await raw.writeTextFile("X.md", "# X\n\nv2\n");
    await new SyncStateRepository(db).updateLocalHash("X.md", sha("# X\n\nv2\n"));
    release();
    await scan;
    const state = await db.queryOne<{ local_sha256: string }>("SELECT local_sha256 FROM sync_state WHERE path = 'X.md'");
    expect(state?.local_sha256, "the hash names the text on disk").toBe(sha("# X\n\nv2\n"));
    expect(mods).toEqual([]);
  });
});

describe("a look that finds a file gone sets a reading aside only where it removes something", () => {
  it("the watcher finds a note gone and then back: the scan's reading of it stands", async () => {
    await raw.writeTextFile("N.md", "# N\n\nold words\n");
    await new VaultIndexer(raw, db).indexVaultFull();
    await raw.writeTextFile("N.md", "# N\n\nnew words\n");
    await fs.utimes(path.join(root, "N.md"), new Date(), new Date(Date.now() + 60_000));
    const { vault, release, reading } = holdingReadOf("N.md");
    // The watcher's first look misses the file — a save that replaces it, a share that blinked —, its second finds it.
    let missedOnce = false;
    const blinking = new Proxy(vault, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (key !== "getFileInfo" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
        return async (p: string) => {
          if (p === "N.md" && !missedOnce) {
            missedOnce = true;
            throw new VaultFileNotFoundError(p);
          }
          return (value as (p: string) => Promise<unknown>).call(target, p);
        };
      },
    });
    const indexer = new VaultIndexer(blinking, db);
    const scan = indexer.indexVaultFull();
    await reading;
    expect(await indexer.indexPath("N.md")).toBe("unchanged");
    release();
    await scan;
    expect((await new VaultQueryService(db).searchFullText("new")).map((hit) => hit.path)).toEqual(["N.md"]);
  });
});

describe("the change journal does not grow without end", () => {
  it("a full scan trims it once it has grown, and leaves a small one alone", async () => {
    await raw.writeTextFile("N.md", "# N\n");
    const indexer = new VaultIndexer(raw, db);
    await indexer.indexVaultFull();
    const count = async () => Number((await db.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM index_changes"))?.n ?? 0);
    await noteIndexChange(["a.md", "b.md"], db);
    const small = await count();
    await indexer.indexVaultFull();
    expect(await count(), "a small journal is left alone: an unchanged scan writes nothing").toBe(small);
    await noteIndexChange(Array.from({ length: 5000 }, (_, i) => `n${i}.md`), db);
    await indexer.indexVaultFull();
    expect(await count()).toBe(0);
  });
});

/** The vault, with `onRead(path, readings)` run after every read of a file, `readings` counting this file's reads so far. */
function eventsOnReads(onRead: (p: string, readings: number) => Promise<void>) {
  const readings = new Map<string, number>();
  const vault = new Proxy(raw, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (key !== "readBinaryFile" && key !== "readTextFile") return value.bind(target);
      return async (p: string, ...rest: unknown[]) => {
        const answer = await (value as (...a: unknown[]) => Promise<unknown>).call(target, p, ...rest);
        const n = (readings.get(p) ?? 0) + 1;
        readings.set(p, n);
        await onRead(p, n);
        return answer;
      };
    },
  });
  return { vault, readings };
}

describe("ordinary changes beside a reading do not keep it out of the index", () => {
  /**
   * Ten notes arrive while the app is closed; the open's scan reads them, and
   * during the first readings and again during the second, `event` changes
   * something else in their folder. Every one of them is in the index after
   * the scan, which calls the index complete.
   */
  async function twoEventsInTheFolder(event: (indexer: VaultIndexer, nth: number) => Promise<void>, setUp: () => Promise<void> = async () => {}) {
    await raw.writeTextFile("Daily/old1.md", "# old1\n");
    await raw.writeTextFile("Daily/old2.md", "# old2\n");
    await raw.writeTextFile("Daily/today.md", "# today\n");
    await new VaultIndexer(raw, db).indexVaultFull();
    await setUp();
    for (let i = 0; i < 10; i++) await raw.writeTextFile(`Daily/new${i}.md`, `# new ${i}\n\nfresh${i}\n`);
    let events = 0;
    let indexer!: VaultIndexer;
    const { vault, readings } = eventsOnReads(async (p, n) => {
      if (!p.startsWith("Daily/new")) return;
      // During the first readings of the new notes, and during their second ones, if any.
      if ((events === 0 && n === 1) || (events === 1 && n === 2)) await event(indexer, ++events);
    });
    const news: string[] = [];
    indexer = new VaultIndexer(vault, db, { onNewLocalFile: (p) => news.push(p) });
    await indexer.indexVaultFull("open");
    const fresh = (await rows()).filter((p) => p.startsWith("Daily/new"));
    expect(fresh, "every new note has its row").toHaveLength(10);
    expect(news.filter((p) => p.startsWith("Daily/new")), "and is announced to the sync").toHaveLength(10);
    expect((await new VaultQueryService(db).searchFullText("fresh3")).map((hit) => hit.path)).toEqual(["Daily/new3.md"]);
    expect(await indexer.indexComplete()).toBe(true);
    return { readings };
  }

  it("two renames in the app, in the folder of the new notes", async () => {
    const queue = new SyncQueue(db);
    await twoEventsInTheFolder(async (indexer, nth) => {
      const from = `Daily/old${nth}.md`;
      const to = `Daily/old${nth}-renamed.md`;
      await raw.renameItem(from, to);
      await queue.queueRename(from, to);
      await indexer.relocatePathInIndex(from, to);
      await indexer.indexPath(to);
    });
    expect(await rows(), "the rename is followed").toContain("Daily/old1-renamed.md");
  });

  it("an encrypted workspace recording two revisions of the note beside them", async () => {
    const record = (revision: number) => db.execute(
      `INSERT INTO workspace_object (object_id, path, current_revision_id, payload_hash, plaintext_sha256, content_kind, deleted, author_member_id, created_at, modified_at)
       VALUES ('today', 'Daily/today.md', ?, ?, ?, 'text', 0, 'me', '2026-11-17', '2026-11-17')
       ON CONFLICT(object_id) DO UPDATE SET current_revision_id = excluded.current_revision_id, payload_hash = excluded.payload_hash, plaintext_sha256 = excluded.plaintext_sha256`,
      [`r${revision}`, `p${revision}`, sha(`today ${revision}`)]);
    await twoEventsInTheFolder(async (_indexer, nth) => { await record(nth); }, async () => { await record(0); });
  });
});

describe("a reading set aside again and again is read again, or the index says it is not complete", () => {
  it("a note changed during its first two readings stands with its third", async () => {
    await raw.writeTextFile("keep.md", "# keep\n");
    await new VaultIndexer(raw, db).indexVaultFull();
    await raw.writeTextFile("N.md", "# N\n\nthird time\n");
    const { vault, readings } = eventsOnReads(async (p, n) => {
      if (p === "N.md" && n <= 2) await noteIndexChange(["N.md"], db);
    });
    const indexer = new VaultIndexer(vault, db);
    await indexer.indexVaultFull();
    expect(readings.get("N.md")).toBe(3);
    expect(await rows()).toEqual(["N.md", "keep.md"]);
    expect(await indexer.indexComplete()).toBe(true);
  });

  it("a note changed during every reading of the scan is named, and the index is not complete until a scan gets it", async () => {
    await raw.writeTextFile("keep.md", "# keep\n");
    await new VaultIndexer(raw, db).indexVaultFull();
    await raw.writeTextFile("N.md", "# N\n\nbusy\n");
    let busy = true;
    const { vault } = eventsOnReads(async (p) => {
      if (busy && p === "N.md") await noteIndexChange(["N.md"], db);
    });
    const indexer = new VaultIndexer(vault, db);
    const report = await indexer.indexVaultFull();
    expect(await rows()).toEqual(["keep.md"]);
    expect(report.skipped, "the scan names what it left out").toEqual([{ path: "N.md", reason: "changing" }]);
    expect(await indexer.indexComplete(), "and does not call the index complete").toBe(false);
    busy = false;
    await indexer.indexVaultFull();
    expect(await rows()).toEqual(["N.md", "keep.md"]);
    expect(await indexer.indexComplete()).toBe(true);
  });

  it("a single path whose every reading is set aside leaves the index not complete", async () => {
    await raw.writeTextFile("keep.md", "# keep\n");
    await new VaultIndexer(raw, db).indexVaultFull();
    await raw.writeTextFile("N.md", "# N\n\nbusy\n");
    let busy = true;
    const { vault } = eventsOnReads(async (p) => {
      if (busy && p === "N.md") await noteIndexChange(["N.md"], db);
    });
    const indexer = new VaultIndexer(vault, db);
    await indexer.indexPath("N.md");
    expect(await rows()).toEqual(["keep.md"]);
    expect(await indexer.indexComplete()).toBe(false);
    busy = false;
    await indexer.indexVaultFull();
    expect(await rows()).toEqual(["N.md", "keep.md"]);
    expect(await indexer.indexComplete()).toBe(true);
  });
});
