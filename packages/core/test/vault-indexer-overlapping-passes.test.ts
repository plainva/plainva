import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { VaultFileNotFoundError } from "../src/vault/IVaultAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";

/**
 * Passes over the index overlap (finding 2026-10-12).
 *
 * A full scan runs for seconds and lets go in between; a single path a save,
 * a pull or the watcher follows comes in meanwhile, and so does the app
 * removing a file. Three things went wrong where two passes met:
 *  - What a pass found to announce was kept once for all passes. Every pass
 *    emptied the lists on its way in, so a single path that met a scan threw
 *    away what the scan had found so far, and those files were not announced.
 *  - A scan decides from what it read when it began and removes and reports
 *    at its end. A pass that removed the same row in between had reported it
 *    already; the second report reached a host whose "the sync worker removed
 *    that itself" answers once, and queued a remote deletion. And a file that
 *    came back after the scan had listed the disk lost its fresh row and was
 *    reported gone while it lay there.
 *  - A single path removed its row with plain statements. Inside somebody
 *    else's open transaction the removal was reported, and came back when
 *    that transaction was rolled back.
 *
 * Real files and a real SQLite on one connection: like the phone's database
 * it refuses a second transaction while one is open. One test wraps it so that
 * a second transaction waits instead, as the desktop's adapter does.
 */

let root: string;
let vault: LocalVaultAdapter;
let db: IDatabaseAdapter;
let indexer: VaultIndexer;
let fresh: string[];
let foreign: string[];
let gone: string[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-overlapping-passes-"));
  vault = new LocalVaultAdapter(root);
  await vault.initialize();
  db = await realSqlite();
  fresh = [];
  foreign = [];
  gone = [];
  indexer = new VaultIndexer(vault, db, {
    onNewLocalFile: (p) => fresh.push(p),
    onExternalModification: (p) => foreign.push(p),
    onLocalFileDeleted: (p) => gone.push(p),
  });
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

const onDisk = (p: string) => path.join(root, p);
const row = (p: string) => db.queryOne<{ path: string }>("SELECT path FROM files WHERE path = ?", [p]);
const nothing = async () => {};

/** Lets something happen once in the next full scan: after the scan read the index, right before and right after it lists the disk. */
function aroundTheScanListing(before: () => Promise<void>, after: () => Promise<void> = nothing): void {
  const list = vault.listDir.bind(vault);
  vault.listDir = async (...args) => {
    vault.listDir = list;
    await before();
    const listing = await list(...args);
    await after();
    return listing;
  };
}

/** Runs `work` once inside the next pass's transaction: before the file read as the `nth` is read. */
function beforeTheNthRead(nth: number, work: () => Promise<void>): void {
  const read = vault.readTextFile.bind(vault);
  let count = 0;
  vault.readTextFile = async (p) => {
    if (++count === nth) await work();
    return read(p);
  };
}

/** The same database with the desktop adapter's manners: a second transaction waits for the first. */
function waiting(inner: IDatabaseAdapter): IDatabaseAdapter {
  let last: Promise<unknown> = Promise.resolve();
  return {
    ...inner,
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      const run = last.then(() => inner.transaction(fn));
      last = run.catch(() => undefined);
      return run;
    },
  };
}

describe("what a pass found is its own", () => {
  const names = Array.from({ length: 12 }, (_, i) => `n${String(i + 1).padStart(2, "0")}.md`);

  it("a single path that meets a full scan does not take the scan's new files along", async () => {
    for (const name of names) await vault.writeTextFile(name, `# ${name}\n`);
    await vault.writeTextFile("Settings.ini", "[view]\nzoom=1\n");
    const settings = await vault.getFileInfo("Settings.ini");

    // Five notes into the scan a save arrives. Its transaction is refused — one
    // is open — and it used to have emptied the scan's list before it asked.
    beforeTheNthRead(6, async () => {
      await expect(indexer.indexFile(settings)).rejects.toThrow();
    });
    await indexer.indexVaultFull();

    expect([...fresh].sort()).toEqual(["Settings.ini", ...names]);
  });

  it("…nor the changes the scan found in files it knew", async () => {
    for (const name of names) await vault.writeTextFile(name, `# ${name}\n`);
    await indexer.indexVaultFull();
    expect(fresh).toHaveLength(names.length);
    // Another program changes every note.
    for (const name of names) {
      await fs.writeFile(onDisk(name), `# ${name}\n\nchanged elsewhere\n`, "utf8");
      await fs.utimes(onDisk(name), new Date(), new Date(Date.now() + 5000));
    }
    await vault.writeTextFile("Settings.ini", "[view]\nzoom=1\n");
    const settings = await vault.getFileInfo("Settings.ini");

    beforeTheNthRead(6, async () => {
      await expect(indexer.indexFile(settings)).rejects.toThrow();
    });
    await indexer.indexVaultFull();

    expect([...foreign].sort()).toEqual(names);
  });

  it("…also where the single path waits for the scan instead of being refused: each file is announced, and once", async () => {
    const patient = new VaultIndexer(vault, waiting(db), { onNewLocalFile: (p) => fresh.push(p) });
    for (const name of names) await vault.writeTextFile(name, `# ${name}\n`);
    await vault.writeTextFile("Settings.ini", "[view]\nzoom=1\n");
    const settings = await vault.getFileInfo("Settings.ini");

    const save: { done?: Promise<boolean> } = {};
    beforeTheNthRead(6, async () => {
      save.done = patient.indexFile(settings);
      // The save has got as far as it can: it waits for the scan's transaction.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await patient.indexVaultFull();
    await save.done;

    // The scan announced the settings file with its own finds; the save that came after found nothing new.
    expect([...fresh].sort()).toEqual(["Settings.ini", ...names]);
  });

  it("a pass that failed half-way announces nothing, and leaves nothing behind for the next one", async () => {
    await vault.writeTextFile("Folder/a.md", "# a\n");
    await vault.writeTextFile("Folder/b.md", "# b\n");
    await vault.writeTextFile("c.md", "# c\n");
    // The folder's second note vanishes between the look and the read: the pass is
    // rolled back as a whole, the first note with it — and what it had found so far
    // goes with the pass.
    beforeTheNthRead(2, () => Promise.reject(new VaultFileNotFoundError("Folder")));
    await expect(indexer.reconcileFolder("Folder")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    expect(fresh).toEqual([]);
    expect(await row("Folder/a.md")).toBeNull();

    await indexer.indexFile(await vault.getFileInfo("c.md"));
    expect(fresh).toEqual(["c.md"]);
  });
});

describe("a file that went is reported once", () => {
  beforeEach(async () => {
    await vault.writeTextFile("Keep.md", "# Keep\n");
    await vault.writeTextFile("Old.md", "# Old\n");
    await vault.writeTextFile("Old.ini", "[old]\n");
    await indexer.indexVaultFull();
    gone.length = 0;
  });

  it("by the single path that got there first, not again by the full scan that had read the index before", async () => {
    await fs.rm(onDisk("Old.md"));
    await fs.rm(onDisk("Old.ini"));
    // The scan has read the index — both files in it — when the single paths
    // arrive (a pull telling the index what it removed, the watcher).
    aroundTheScanListing(async () => {
      expect(await indexer.indexPath("Old.md")).toBe("removed");
      expect(await indexer.indexPath("Old.ini")).toBe("removed");
      expect(gone).toEqual(["Old.md", "Old.ini"]);
    });
    const report = await indexer.indexVaultFull();

    // The scan found them vanished as well and used to say so a second time.
    expect(gone).toEqual(["Old.md", "Old.ini"]);
    expect(report.removed).toBe(0);
    expect(await row("Old.md")).toBeNull();
    expect(await row("Keep.md")).not.toBeNull();
  });

  it("by the app that removed it, not again by a scan under way", async () => {
    aroundTheScanListing(async () => {
      await fs.rm(onDisk("Old.md"));
      await indexer.removePathFromIndex("Old.md");
    });
    await indexer.indexVaultFull();
    expect(gone).toEqual(["Old.md"]);
  });

  it("by the folder that was reconciled, not again by a scan under way", async () => {
    await fs.rm(onDisk("Old.ini"));
    aroundTheScanListing(async () => {
      expect((await indexer.reconcileFolder("", { recursive: false })).removed).toEqual(["Old.ini"]);
    });
    await indexer.indexVaultFull();
    expect(gone).toEqual(["Old.ini"]);
  });

  it("by the app that removed it, not again by a folder re-read under way", async () => {
    await fs.rm(onDisk("Old.ini"));
    // Another program changed a note of the folder, so the re-read has a file to read…
    await fs.writeFile(onDisk("Keep.md"), "# Keep\n\nchanged elsewhere\n", "utf8");
    await fs.utimes(onDisk("Keep.md"), new Date(), new Date(Date.now() + 5000));
    // …and while it reads, the app removes the file the re-read has already missed.
    beforeTheNthRead(1, () => indexer.removePathFromIndex("Old.ini"));
    await indexer.reconcileFolder("", { recursive: false });
    expect(gone).toEqual(["Old.ini"]);
    expect(foreign).toEqual(["Keep.md"]);
  });

  it("by the full scan, not again by a single path that waited behind it (a database that makes the second wait)", async () => {
    const patient = new VaultIndexer(vault, waiting(db), { onLocalFileDeleted: (p) => gone.push(p) });
    await fs.rm(onDisk("Old.md"));
    // Another program changed a note, so the scan has a file to read inside its transaction…
    await fs.writeFile(onDisk("Keep.md"), "# Keep\n\nchanged elsewhere\n", "utf8");
    await fs.utimes(onDisk("Keep.md"), new Date(), new Date(Date.now() + 5000));
    const late: { path?: Promise<string> } = {};
    // …and while it reads, the watcher's single path for the missing file arrives and waits its turn.
    beforeTheNthRead(1, async () => {
      late.path = patient.indexPath("Old.md");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await patient.indexVaultFull();
    expect(await late.path).toBe("unchanged");
    expect(gone).toEqual(["Old.md"]);
  });
});

describe("a pass leaves alone what another pass indexed since it began", () => {
  beforeEach(async () => {
    await vault.writeTextFile("Keep.md", "# Keep\n");
    await vault.writeTextFile("Old.md", "# Old\n");
    await vault.writeTextFile("Old.ini", "[old]\n");
    await indexer.indexVaultFull();
    gone.length = 0;
  });

  for (const name of ["Old.md", "Old.ini"]) {
    it(`${name}: back on disk after the scan listed it missing, it keeps its row and is not reported gone`, async () => {
      aroundTheScanListing(
        async () => {
          // Removed (a pull, another program), and the single path that followed said so.
          await fs.rm(onDisk(name));
          expect(await indexer.indexPath(name)).toBe("removed");
        },
        async () => {
          // The scan has listed the disk without the file when it is created again and indexed.
          await vault.writeTextFile(name, "back again\n");
          await indexer.indexFile(await vault.getFileInfo(name));
        },
      );
      await indexer.indexVaultFull();

      // The scan's list said "vanished" about a file that lies there: its fresh
      // row was removed, and the file reported gone a second time.
      expect(await row(name)).not.toBeNull();
      expect(gone).toEqual([name]);
    });
  }

  it("a file that came back and went again is left to the next scan, which reports it", async () => {
    await fs.rm(onDisk("Old.md"));
    aroundTheScanListing(async () => {
      expect(await indexer.indexPath("Old.md")).toBe("removed");
      // Back under the same name, indexed, and gone again before the scan lists the disk.
      await vault.writeTextFile("Old.md", "# Old, once more\n");
      await indexer.indexFile(await vault.getFileInfo("Old.md"));
      await fs.rm(onDisk("Old.md"));
    });
    await indexer.indexVaultFull();
    // The scan under way cannot tell this from the case above; it keeps its hands off.
    expect(gone).toEqual(["Old.md"]);
    expect(await row("Old.md")).not.toBeNull();

    await indexer.indexVaultFull();
    expect(gone).toEqual(["Old.md", "Old.md"]);
    expect(await row("Old.md")).toBeNull();
  });

  const askers = {
    "a save or a pull telling the index (indexFile)": async () => indexer.indexFile(await vault.getFileInfo("Old.md")),
    "an event at the path (indexPath)": () => indexer.indexPath("Old.md"),
  };
  for (const [asker, ask] of Object.entries(askers)) {
    it(`a file that comes back while the scan is already writing is not reported gone — asked for by ${asker}`, async () => {
      await fs.rm(onDisk("Old.md"));
      // Another program changed a note, so the scan has something to write…
      await fs.writeFile(onDisk("Keep.md"), "# Keep\n\nchanged elsewhere\n", "utf8");
      await fs.utimes(onDisk("Keep.md"), new Date(), new Date(Date.now() + 5000));
      // …and has decided to remove the missing file's row when the file is back and
      // the index is asked. On one connection that pass is refused — it still says
      // that somebody saw the file.
      beforeTheNthRead(1, async () => {
        await vault.writeTextFile("Old.md", "# Old, back\n");
        await fs.utimes(onDisk("Old.md"), new Date(), new Date(Date.now() + 9000));
        await expect(ask()).rejects.toThrow();
      });
      await indexer.indexVaultFull();
      // The scan reported the file gone while it lay there. The row it had
      // decided on is gone all the same…
      expect(gone).toEqual([]);
      expect(await row("Old.md")).toBeNull();

      // …and the next pass over the path gives the file its row back.
      await ask();
      expect(await row("Old.md")).not.toBeNull();
      expect(gone).toEqual([]);
    });
  }

  it("a single path that found the file gone and then had to wait looks again: a file that is back keeps its row", async () => {
    const shared = waiting(db);
    const patient = new VaultIndexer(vault, shared, { onLocalFileDeleted: (p) => gone.push(p) });
    await fs.rm(onDisk("Old.md"));
    // Somebody holds the database.
    const gate: { open: () => void } = { open: () => undefined };
    const held = shared.transaction(() => new Promise<void>((resolve) => { gate.open = resolve; }));
    // The single path has seen that the file is missing, and waits its turn…
    const looked = new Promise<void>((resolve) => {
      const real = vault.getFileInfo.bind(vault);
      vault.getFileInfo = async (p) => {
        try {
          return await real(p);
        } finally {
          vault.getFileInfo = real;
          resolve();
        }
      };
    });
    const single = patient.indexPath("Old.md");
    await looked;
    // …and the file comes back meanwhile. Nobody tells the index.
    await vault.writeTextFile("Old.md", "# Old, back\n");
    gate.open();
    await held;

    // It removed the row and reported the file gone, on the strength of a look that was seconds old.
    expect(await single).toBe("unchanged");
    expect(gone).toEqual([]);
    expect(await row("Old.md")).not.toBeNull();
  });

  it("a scan that began after all of it says what it finds itself", async () => {
    await fs.rm(onDisk("Old.md"));
    expect(await indexer.indexPath("Old.md")).toBe("removed");
    // The row is back by a way that does not pass the index routes (a move the
    // app made), and the file is not: the next scan removes the row and reports
    // — nothing an earlier pass did holds it back.
    await indexer.relocatePathInIndex("Old.ini", "Old.md");
    await fs.rm(onDisk("Old.ini"));
    await indexer.indexVaultFull();
    expect(gone).toEqual(["Old.md", "Old.md"]);
  });
});

describe("a removal is reported when its row is gone for good", () => {
  it("a single path does not remove inside somebody else's transaction: it is refused, and says nothing", async () => {
    await vault.writeTextFile("Old.md", "# Old\n");
    await indexer.indexVaultFull();
    await fs.rm(onDisk("Old.md"));

    // Somebody else's transaction is open (on the phone: a full scan) and fails in the end.
    await expect(db.transaction(async () => {
      await expect(indexer.indexPath("Old.md")).rejects.toThrow();
      throw new Error("rolled back");
    })).rejects.toThrow("rolled back");
    // The removal used to ride in that transaction: reported, and back with the rollback.
    expect(gone).toEqual([]);
    expect(await row("Old.md")).not.toBeNull();

    // Its caller comes again.
    expect(await indexer.indexPath("Old.md")).toBe("removed");
    expect(gone).toEqual(["Old.md"]);
    expect(await row("Old.md")).toBeNull();
  });

  it("…nor does it take a removal somebody has not committed yet for done", async () => {
    await vault.writeTextFile("Old.md", "# Old\n");
    await indexer.indexVaultFull();
    await fs.rm(onDisk("Old.md"));

    // A full scan has removed the row inside its transaction, and fails before it commits.
    await expect(db.transaction(async () => {
      await db.execute("DELETE FROM files WHERE path = ?", ["Old.md"]);
      await expect(indexer.indexPath("Old.md")).rejects.toThrow();
      throw new Error("rolled back");
    })).rejects.toThrow("rolled back");
    // Asked with a plain statement, the single path read "nothing here" and was
    // done — and nobody came back when the row did.
    expect(gone).toEqual([]);
    expect(await row("Old.md")).not.toBeNull();

    expect(await indexer.indexPath("Old.md")).toBe("removed");
    expect(gone).toEqual(["Old.md"]);
  });
});
