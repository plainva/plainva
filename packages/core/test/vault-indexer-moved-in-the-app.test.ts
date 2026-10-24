import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";

/**
 * A full scan and a file the app moved (findings 2026-10-12).
 *
 * A move in the app is three steps: the disk, the queued MOVE — which carries
 * the index rows and the sync rows to the new path in its own transaction, the
 * rows keeping the id of their old path (`SyncQueue.queueRename`) — and, once
 * the shell gets there, the index following (`relocatePathInIndex`). The full
 * scan met such a file wrongly in two ways:
 *
 *  - WHILE the scan was under way. It had read the index before the move and
 *    listed the disk after it: the old path was missing, so the scan reported
 *    it gone — a remote DELETE queued behind the MOVE, and for a big folder
 *    the question whether to delete that many files — and the files at the new
 *    path it took for new: an upload announced for each, the creation time
 *    replaced. The rule for passes that overlap ("a pass leaves alone what
 *    another touched since it began") did not reach here: the rows had moved
 *    in the queue's transaction, and the index heard of it only when the shell
 *    called — on the desktop after the scan had decided, because the scan's
 *    turn at the database comes right behind the queue's.
 *  - AFTER the move, as the scan every folder move ends in. It looked a row up
 *    by the id of the path it now has; a moved row still carries the id of the
 *    old one. Not found, the file lost its stored creation time (the pinboard
 *    orders cards nobody arranged by it) and its mark that an upload waits.
 *    The single path has asked by id and then by path since issue 113.
 *
 * Real files, a real SQLite on one connection, the real queue.
 */

const sha = async (text: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

let root: string;
let vault: LocalVaultAdapter;
let db: IDatabaseAdapter;
let repo: SyncStateRepository;
let queue: SyncQueue;
let indexer: VaultIndexer;
let fresh: string[];
let foreign: string[];
let gone: string[];

const hooks = () => ({
  onNewLocalFile: (p: string) => void fresh.push(p),
  onExternalModification: (p: string) => void foreign.push(p),
  onLocalFileDeleted: (p: string) => void gone.push(p),
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-moved-in-the-app-"));
  vault = new LocalVaultAdapter(root);
  await vault.initialize();
  db = await realSqlite();
  repo = new SyncStateRepository(db);
  queue = new SyncQueue(db);
  fresh = [];
  foreign = [];
  gone = [];
  indexer = new VaultIndexer(vault, db, hooks());
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

const FILES: Record<string, string> = {
  "a.md": "# a\n",
  "b.md": "# b\n\nsee [[a]]\n",
  "c.md": "# c\n",
  "data.csv": "id;name\n1;Ada\n",
};
const under = (folder: string) => Object.keys(FILES).map((name) => `${folder}/${name}`).sort();
/** A creation time no file system reports: what the index stored when it first saw the file. */
const CREATED = 111;

const rows = async () =>
  db.query<{ path: string; ctime: number; sync_state: string }>("SELECT path, ctime, sync_state FROM files ORDER BY path");
const queued = async () =>
  (await db.query<{ operation: string; file_path: string; new_path: string | null }>(
    "SELECT operation, file_path, new_path FROM offline_queue ORDER BY id",
  )).map((r) => `${r.operation} ${r.file_path}${r.new_path ? ` -> ${r.new_path}` : ""}`);
const found = async (term: string) =>
  (await db.query<{ path: string }>("SELECT path FROM fts_notes WHERE fts_notes MATCH ? ORDER BY path", [term])).map((r) => r.path);

/** A folder the sync knows: identical here and on the remote, every file indexed, each with its stored creation time. */
async function syncedFolder(folder = "Projekt"): Promise<void> {
  await vault.writeTextFile("Keep.md", "# Keep\n");
  for (const [name, text] of Object.entries(FILES)) await vault.writeTextFile(`${folder}/${name}`, text);
  await indexer.indexVaultFull();
  for (const [name, text] of Object.entries(FILES)) {
    const p = `${folder}/${name}`;
    await repo.updateLocalHashAndBaseText(p, await sha(text), text);
    await repo.updateBaseState(p, await sha(text), "etag-1");
    await repo.updateRemoteState(p, "etag-1", null, 1);
  }
  await db.execute("UPDATE files SET ctime = ? WHERE path <> 'Keep.md'", [CREATED]);
  fresh.length = 0;
  foreign.length = 0;
  gone.length = 0;
}

/** The move itself, as the adapter chain makes it: the disk, then the queued MOVE that takes the rows along. */
async function moveOnDiskAndInTheQueue(from: string, to: string): Promise<void> {
  const parent = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
  if (parent) await vault.createDir(parent);
  await vault.renameItem(from, to);
  await queue.queueRename(from, to);
}

/** Lets something happen once in the next full scan: after the scan read the index, right before and right after it lists the disk. */
function aroundTheScanListing(before: () => Promise<void>, after: () => Promise<void> = async () => {}): void {
  const list = vault.listDir.bind(vault);
  vault.listDir = async (...args) => {
    vault.listDir = list;
    await before();
    const listing = await list(...args);
    await after();
    return listing;
  };
}

/** Everything the moved folder must still be once the index has settled. */
async function expectTheFolderMoved(to: string): Promise<void> {
  expect(await rows()).toEqual([
    ...under(to).map((p) => ({ path: p, ctime: CREATED, sync_state: "local_ahead" })),
    { path: "Keep.md", ctime: (await rows()).find((r) => r.path === "Keep.md")!.ctime, sync_state: "synced" },
  ].sort((x, y) => (x.path < y.path ? -1 : 1)));
  // Nothing the sync has to hear of but the MOVE that is queued.
  expect(gone, "no path was reported gone").toEqual([]);
  expect(fresh, "no file was announced as new").toEqual([]);
  expect(foreign, "no file was reported as changed elsewhere").toEqual([]);
  expect(await found("Ada"), "the search knows no table").toEqual([]);
  expect(await found("see"), "the search finds the note where it is").toEqual([`${to}/b.md`]);
}

describe("a folder the app moves while a full scan is under way", () => {
  it("the scan decides before the index is told (the desktop): the old paths are not reported gone, the files not announced as new", async () => {
    await syncedFolder();
    // The scan has read the index when the move lands: the disk, and the
    // queue's transaction that re-keys the rows. The scan lists the disk next.
    aroundTheScanListing(() => moveOnDiskAndInTheQueue("Projekt", "Archiv/Projekt"));
    await indexer.indexVaultFull("return to the app");
    // Only now does the shell get to tell the index — and to run the scan of its own.
    await indexer.relocatePathInIndex("Projekt", "Archiv/Projekt");
    await indexer.indexVaultFull("folder moved in the app");

    await expectTheFolderMoved("Archiv/Projekt");
    expect(await queued()).toEqual(["rename Projekt -> Archiv/Projekt"]);
  });

  it("the index is told before the scan lists the disk: the same", async () => {
    await syncedFolder();
    aroundTheScanListing(async () => {
      await moveOnDiskAndInTheQueue("Projekt", "Archiv/Projekt");
      await indexer.relocatePathInIndex("Projekt", "Archiv/Projekt");
    });
    await indexer.indexVaultFull("return to the app");
    await indexer.indexVaultFull("folder moved in the app");

    await expectTheFolderMoved("Archiv/Projekt");
  });

  it("the index is told first and moves the rows itself (no queue took them along): the same", async () => {
    await syncedFolder();
    aroundTheScanListing(async () => {
      await vault.createDir("Archiv");
      await vault.renameItem("Projekt", "Archiv/Projekt");
      await indexer.relocatePathInIndex("Projekt", "Archiv/Projekt");
    });
    await indexer.indexVaultFull("return to the app");

    expect(gone).toEqual([]);
    expect((await rows()).filter((r) => r.path !== "Keep.md").map((r) => [r.path, r.ctime])).toEqual(
      under("Archiv/Projekt").map((p) => [p, CREATED]),
    );
  });

  it("moved after the scan listed the disk: the scan saw the old place, says nothing, and the shell's own scan re-reads the files", async () => {
    await syncedFolder();
    aroundTheScanListing(async () => {}, () => moveOnDiskAndInTheQueue("Projekt", "Archiv/Projekt"));
    await indexer.indexVaultFull("return to the app");
    expect(gone).toEqual([]);
    expect(fresh).toEqual([]);

    await indexer.relocatePathInIndex("Projekt", "Archiv/Projekt");
    await indexer.indexVaultFull("folder moved in the app");
    await expectTheFolderMoved("Archiv/Projekt");
  });

  it("a single note renamed while the scan is under way", async () => {
    await syncedFolder();
    aroundTheScanListing(() => moveOnDiskAndInTheQueue("Projekt/a.md", "Projekt/alpha.md"));
    await indexer.indexVaultFull("return to the app");
    await indexer.relocatePathInIndex("Projekt/a.md", "Projekt/alpha.md");
    await indexer.indexPath("Projekt/alpha.md");

    expect(gone).toEqual([]);
    expect(fresh).toEqual([]);
    expect(await db.queryOne("SELECT ctime, sync_state FROM files WHERE path = ?", ["Projekt/alpha.md"]))
      .toEqual({ ctime: CREATED, sync_state: "local_ahead" });
    expect(await db.queryOne("SELECT path FROM files WHERE path = ?", ["Projekt/a.md"])).toBeNull();
  });

  it("a folder that moves a second time, before any pass has read it at its first new place", async () => {
    await syncedFolder();
    await moveOnDiskAndInTheQueue("Projekt", "Archiv/Projekt");
    await indexer.relocatePathInIndex("Projekt", "Archiv/Projekt");
    // The rows sit at the first destination, each still under the id of the
    // path it came from, when a scan begins and the folder moves on.
    aroundTheScanListing(() => moveOnDiskAndInTheQueue("Archiv/Projekt", "Archiv/2026"));
    await indexer.indexVaultFull("return to the app");
    await indexer.relocatePathInIndex("Archiv/Projekt", "Archiv/2026");
    await indexer.indexVaultFull("folder moved in the app");

    await expectTheFolderMoved("Archiv/2026");
  });

  it("a file that really went is still reported, beside a folder that moved", async () => {
    await syncedFolder();
    aroundTheScanListing(async () => {
      await moveOnDiskAndInTheQueue("Projekt", "Archiv/Projekt");
      // Another program removes a note at the same time.
      await fs.rm(path.join(root, "Keep.md"));
    });
    await indexer.indexVaultFull("return to the app");
    expect(gone).toEqual(["Keep.md"]);
    expect(await db.queryOne("SELECT path FROM files WHERE path = ?", ["Keep.md"])).toBeNull();
  });

  it("a file moved in the app and then deleted outside it is reported under the path it had last", async () => {
    await syncedFolder();
    aroundTheScanListing(async () => {
      await moveOnDiskAndInTheQueue("Projekt", "Archiv/Projekt");
      await fs.rm(path.join(root, "Archiv/Projekt/c.md"));
    });
    await indexer.indexVaultFull("return to the app");
    // The scan under way knew the note at its old path only: it says nothing about it …
    expect(gone).toEqual([]);
    // … and the next one, which reads the row where the move left it, reports it there.
    await indexer.indexVaultFull("folder moved in the app");
    expect(gone).toEqual(["Archiv/Projekt/c.md"]);
  });
});

describe("a folder that is re-read while the app moves files into it", () => {
  // The other way round: a folder re-read lists the disk FIRST and reads the
  // index after. Rows the app moved in between the two sit at paths the
  // listing does not have — and were taken for files that vanished: removed
  // from the index and reported gone under their NEW path, a remote DELETE
  // behind the MOVE for files that lay where the row said.
  for (const [how, recursive] of [["with everything below it", true], ["flat, as the watcher's parent check does it", false]] as const) {
    it(`${how}: the files that arrived are not reported gone`, async () => {
      await syncedFolder();
      await vault.writeTextFile("Archiv/old.md", "# old\n");
      await indexer.indexVaultFull();
      fresh.length = 0;

      aroundTheScanListing(async () => {}, () => moveOnDiskAndInTheQueue("Projekt", "Archiv/Projekt"));
      const report = await indexer.reconcileFolder("Archiv", { recursive });

      expect(report.removed).toEqual([]);
      expect(gone).toEqual([]);
      expect((await rows()).filter((r) => r.path.startsWith("Archiv/Projekt/")).map((r) => [r.path, r.ctime])).toEqual(
        under("Archiv/Projekt").map((p) => [p, CREATED]),
      );
    });
  }

  it("a file that was moved in and then deleted outside the app is reported at the path it had last", async () => {
    await syncedFolder();
    await moveOnDiskAndInTheQueue("Projekt", "Archiv/Projekt");
    await indexer.relocatePathInIndex("Projekt", "Archiv/Projekt");
    // Nobody has read the rows at their new place when another program removes one of the files.
    await fs.rm(path.join(root, "Archiv/Projekt/c.md"));
    const report = await indexer.reconcileFolder("Archiv");

    expect(report.removed).toEqual(["Archiv/Projekt/c.md"]);
    expect(gone).toEqual(["Archiv/Projekt/c.md"]);
  });
});

describe("the scan a folder move ends in", () => {
  it("finds a moved row by its path: the creation time and the waiting upload stay", async () => {
    await syncedFolder();
    // What both shells do for a folder moved in the app.
    await moveOnDiskAndInTheQueue("Projekt", "Archiv/Projekt");
    await indexer.relocatePathInIndex("Projekt", "Archiv/Projekt");
    await indexer.indexVaultFull("folder moved in the app");

    await expectTheFolderMoved("Archiv/Projekt");
    // A row found again has the id of the path it is at.
    const ids = await db.query<{ id: string; path: string }>("SELECT id, path FROM files WHERE path LIKE 'Archiv/%' ORDER BY path");
    for (const r of ids) expect(r.id, r.path).toBe(await sha(r.path));
  });

  it("…also for a folder that moved twice before any scan looked", async () => {
    await syncedFolder();
    await moveOnDiskAndInTheQueue("Projekt", "Archiv/Projekt");
    await indexer.relocatePathInIndex("Projekt", "Archiv/Projekt");
    await moveOnDiskAndInTheQueue("Archiv/Projekt", "Archiv/2026");
    await indexer.relocatePathInIndex("Archiv/Projekt", "Archiv/2026");
    await indexer.indexVaultFull("folder moved in the app");

    await expectTheFolderMoved("Archiv/2026");
  });

  it("a file that takes a moved file's old name is a file of its own", async () => {
    await syncedFolder();
    await moveOnDiskAndInTheQueue("Projekt/a.md", "Projekt/alpha.md");
    await indexer.relocatePathInIndex("Projekt/a.md", "Projekt/alpha.md");
    // Before any pass has looked at the renamed note, another program writes a new one under the old name.
    await fs.writeFile(path.join(root, "Projekt/a.md"), "# a, another\n", "utf8");
    await indexer.indexVaultFull("return to the app");

    const state = Object.fromEntries((await rows()).map((r) => [r.path, r]));
    expect(state["Projekt/alpha.md"]).toMatchObject({ ctime: CREATED, sync_state: "local_ahead" });
    expect(state["Projekt/a.md"]?.ctime).not.toBe(CREATED);
    expect(fresh).toEqual(["Projekt/a.md"]);
    expect(gone).toEqual([]);
  });

  it("…also where the index hears of the new file alone (the watcher, the phone's door): the moved file keeps its row", async () => {
    await syncedFolder();
    await moveOnDiskAndInTheQueue("Projekt/a.md", "Projekt/alpha.md");
    await indexer.relocatePathInIndex("Projekt/a.md", "Projekt/alpha.md");
    await fs.writeFile(path.join(root, "Projekt/a.md"), "# a, another\n", "utf8");
    // The moved row still carries the id of its old path; the new file's write
    // used to delete that id first — and with it the moved note's row.
    await indexer.indexFile(await vault.getFileInfo("Projekt/a.md"));

    const state = Object.fromEntries((await rows()).map((r) => [r.path, r]));
    expect(state["Projekt/alpha.md"]).toMatchObject({ ctime: CREATED, sync_state: "local_ahead" });
    expect(state["Projekt/a.md"]).toBeDefined();
    expect(fresh).toEqual(["Projekt/a.md"]);

    // The next scan reads the moved note at its place: not new, not gone.
    await indexer.indexVaultFull("return to the app");
    const after = Object.fromEntries((await rows()).map((r) => [r.path, r]));
    expect(after["Projekt/alpha.md"]).toMatchObject({ ctime: CREATED, sync_state: "local_ahead" });
    expect(fresh).toEqual(["Projekt/a.md"]);
    expect(gone).toEqual([]);
  });
});
