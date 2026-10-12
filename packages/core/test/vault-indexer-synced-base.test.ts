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
 * The index and the merge base a sync recorded (finding 2026-10-09).
 *
 * A `sync_state` row carries two things that are easy to take for one: what
 * the app last saw on this device (`local_sha256`) and the common ancestor
 * with the remote (`base_sha256`, `base_text`). The first is the index's to
 * renew. The second belongs to the sync — and the index wrote over it
 * whenever it met a file with a row and no index entry, because it took such
 * a row for the leftover of a deleted file ("orphaned"). That is also what a
 * live file looks like for a while: one a pull just wrote, every file after
 * the index was dropped to be rebuilt, a table that was just moved. The file's
 * current text became its merge base; a local change that had not gone up yet
 * then counted as already contained in the remote, and the next change from
 * another device replaced it without a conflict copy.
 *
 * Real SQLite, real files; the two-device flows are in
 * `sync/merge-base-and-index.test.ts`.
 */

const sha = async (data: string | Uint8Array): Promise<string> => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

let root: string;
let vault: LocalVaultAdapter;
let db: IDatabaseAdapter;
let repo: SyncStateRepository;
let indexer: VaultIndexer;
let fresh: string[];
let foreign: string[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-synced-base-"));
  vault = new LocalVaultAdapter(root);
  await vault.initialize();
  db = await realSqlite();
  repo = new SyncStateRepository(db);
  fresh = [];
  foreign = [];
  indexer = new VaultIndexer(vault, db, {
    onNewLocalFile: (p) => fresh.push(p),
    onExternalModification: (p) => foreign.push(p),
  });
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

const row = (p: string) => db.queryOne<{ path: string; mode: string; ctime: number }>("SELECT path, mode, ctime FROM files WHERE path = ?", [p]);
const paths = async () => (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path);

/** What a sync leaves behind for a file it wrote or uploaded: local marker, base and remote marker agree. */
async function synced(p: string, text: string): Promise<void> {
  await repo.updateLocalHashAndBaseText(p, await sha(text), text);
  await repo.updateBaseState(p, await sha(text), "etag-1");
  await repo.updateRemoteState(p, "etag-1", null, 1);
}

describe("indexFile takes every kind of file", () => {
  it("indexes a settings file, a database and an image like the routes that look for themselves", async () => {
    const ini = "[view]\r\nzoom=1\r\n";
    const base = "views:\n  - type: table\n    name: Table\n";
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    await vault.writeTextFile("Settings.ini", ini);
    await vault.writeTextFile("Projects/Plan.base", base);
    await vault.writeBinaryFile("Projects/shot.png", png);
    await vault.writeTextFile("Note.md", "# Note\n");

    // It used to answer false for the first three and do nothing.
    expect(await indexer.indexFile(await vault.getFileInfo("Settings.ini"))).toBe(true);
    expect(await indexer.indexFile(await vault.getFileInfo("Projects/Plan.base"))).toBe(true);
    expect(await indexer.indexFile(await vault.getFileInfo("Projects/shot.png"))).toBe(true);
    expect(await indexer.indexFile(await vault.getFileInfo("Note.md"))).toBe(true);

    expect((await row("Settings.ini"))?.mode).toBe("attachment");
    expect((await row("Projects/Plan.base"))?.mode).toBe("attachment");
    expect((await row("Projects/shot.png"))?.mode).toBe("attachment");
    expect((await row("Note.md"))?.mode).toBe("obsidian");
    // A file nobody synced gets its baseline: text with a merge base, bytes with their hash.
    expect(await repo.getSyncState("Settings.ini")).toMatchObject({ local_sha256: await sha(ini), base_text: ini, base_sha256: null });
    expect(await repo.getSyncState("Projects/Plan.base")).toMatchObject({ local_sha256: await sha(base), base_text: base });
    expect(await repo.getSyncState("Projects/shot.png")).toMatchObject({ local_sha256: await sha(png), base_text: null });
    // …and is announced, so the shell can queue it for upload.
    expect(fresh).toEqual(["Settings.ini", "Projects/Plan.base", "Projects/shot.png", "Note.md"]);
    expect(foreign).toEqual([]);
  });

  it("says a file that is no note changed exactly when the index did not know it", async () => {
    await vault.writeTextFile("Data.csv", "id;name\n1;Ada\n");
    expect(await indexer.indexFile(await vault.getFileInfo("Data.csv"))).toBe(true);
    await vault.writeTextFile("Data.csv", "id;name\n1;Ada\n2;Grace\n");
    // Nothing a tree or a list draws changes for a table that got a row.
    expect(await indexer.indexFile(await vault.getFileInfo("Data.csv"))).toBe(false);
    expect(fresh).toEqual(["Data.csv"]);
  });

  it("leaves alone what no other route indexes either", async () => {
    await vault.writeTextFile(".plainva/sync/settings.json", "{}");
    await vault.writeTextFile(".obsidian/app.json", "{}");
    await vault.writeTextFile(".obsidian/Readme.md", "# internal\n");
    await vault.createDir("Folder");
    for (const p of [".plainva/sync/settings.json", ".obsidian/app.json", ".obsidian/Readme.md", "Folder"]) {
      expect(await indexer.indexFile(await vault.getFileInfo(p)), p).toBe(false);
    }
    expect(await paths()).toEqual([]);
    expect(fresh).toEqual([]);
  });
});

describe("a merge base the sync recorded is never the index's to write", () => {
  const before = "one\ntwo\nthree\n";
  const now = "one here\ntwo\nthree\n";
  const routes: Array<[string, (p: string) => Promise<unknown>]> = [
    ["a save or a pull telling the index (indexFile)", async (p) => indexer.indexFile(await vault.getFileInfo(p))],
    ["an event at the path (indexPath)", (p) => indexer.indexPath(p)],
    ["the full scan", () => indexer.indexVaultFull()],
    ["a folder re-read", () => indexer.reconcileFolder("")],
  ];

  for (const file of ["Note.md", "Settings.ini"]) {
    for (const [name, route] of routes) {
      it(`${file}, found by ${name}: the row has no index entry yet, the file changed since the sync wrote it`, async () => {
        // A sync wrote the file and its row; no pass has looked at it. Then it changed here.
        await synced(file, before);
        await vault.writeTextFile(file, now);

        await route(file);

        const state = await repo.getSyncState(file);
        // The common ancestor with the remote is still the text the sync stored —
        // it used to be replaced by the changed text, which made the change
        // look as if the remote already had it.
        expect(state?.base_text).toBe(before);
        expect(state?.base_sha256).toBe(await sha(before));
        expect(state?.remote_etag).toBe("etag-1");
        // What the app saw last IS renewed, and the file is handed to the shell for upload.
        expect(state?.local_sha256).toBe(await sha(now));
        expect(fresh).toEqual([file]);
        expect(foreign).toEqual([]);
        expect(await row(file)).not.toBeNull();
      });
    }
  }

  it("the same row once the index knows the file: a foreign change is reported, nothing is rewritten", async () => {
    await vault.writeTextFile("Settings.ini", before);
    await indexer.indexVaultFull();
    await synced("Settings.ini", before);
    fresh.length = 0;
    await vault.writeTextFile("Settings.ini", now);
    await indexer.indexFile(await vault.getFileInfo("Settings.ini"));
    expect(await repo.getSyncState("Settings.ini")).toMatchObject({ base_text: before, local_sha256: await sha(before) });
    expect(foreign).toEqual(["Settings.ini"]);
    expect(fresh).toEqual([]);
  });

  it("a row nobody synced is the leftover of a deleted file, as before: the new file gets its own baseline", async () => {
    // "Notiz 1" was deleted, its row stayed, and a new note took the name
    // (feedback Build 91, P1). No sync ever recorded a base for it.
    await repo.updateLocalHashAndBaseText("Inbox/Notiz 1.md", await sha("# Notiz 1\n\nalt"), "# Notiz 1\n\nalt");
    await vault.writeTextFile("Inbox/Notiz 1.md", "# Notiz 1\n\nneu");
    await indexer.indexFile(await vault.getFileInfo("Inbox/Notiz 1.md"));
    expect(await repo.getSyncState("Inbox/Notiz 1.md")).toMatchObject({
      local_sha256: await sha("# Notiz 1\n\nneu"),
      base_text: "# Notiz 1\n\nneu",
      base_sha256: null,
    });
    expect(fresh).toEqual(["Inbox/Notiz 1.md"]);
    expect(foreign).toEqual([]);
  });

  it("the index dropped to be rebuilt: every row keeps its base, and a change that waits for its upload keeps its ancestor", async () => {
    await vault.writeTextFile("Note.md", before);
    await vault.writeTextFile("Settings.ini", before);
    await vault.writeTextFile("Local only.md", "never synced\n");
    await indexer.indexVaultFull();
    await synced("Note.md", before);
    await synced("Settings.ini", before);
    // Both changed here; the upload has not happened yet.
    await vault.writeTextFile("Note.md", now);
    await vault.writeTextFile("Settings.ini", now);
    await repo.updateLocalHash("Note.md", await sha(now));
    await repo.updateLocalHash("Settings.ini", await sha(now));

    // The desktop's "rebuild the index" (VaultContext.rebuildIndex).
    await db.execute("DELETE FROM files");
    await db.execute("DELETE FROM fts_notes");
    await indexer.indexVaultFull("index rebuild");

    expect(await paths()).toEqual(["Local only.md", "Note.md", "Settings.ini"]);
    expect(await repo.getSyncState("Note.md")).toMatchObject({ base_text: before, base_sha256: await sha(before), local_sha256: await sha(now) });
    expect(await repo.getSyncState("Settings.ini")).toMatchObject({ base_text: before, base_sha256: await sha(before), local_sha256: await sha(now) });
    // The file no sync ever saw has nothing to keep: its text is its baseline.
    expect(await repo.getSyncState("Local only.md")).toMatchObject({ base_text: "never synced\n", base_sha256: null });
  });
});

describe("a file that is no note, moved in the app, stays the file it was", () => {
  const move = async (from: string, to: string) => {
    // What a move in the app does: the disk, the queued MOVE (which carries the
    // index row and the sync row to the new path, the row keeping its old id),
    // and the index following.
    await vault.createDir(to.slice(0, to.lastIndexOf("/")));
    await vault.renameItem(from, to);
    await new SyncQueue(db).queueRename(from, to);
    await indexer.relocatePathInIndex(from, to);
  };

  for (const [shell, reindex] of [
    ["the desktop (indexPath)", (p: string) => indexer.indexPath(p)],
    ["the phone (indexFile)", async (p: string) => indexer.indexFile(await vault.getFileInfo(p))],
  ] as const) {
    it(`${shell}: not announced as new, its creation time and its merge base stay`, async () => {
      const before = "id;name\n1;Ada\n";
      const now = "id;name\n1;Ada\n2;Grace\n";
      await vault.writeTextFile("Data.csv", before);
      await indexer.indexVaultFull();
      await synced("Data.csv", before);
      // A row was added here and has not gone up yet.
      await vault.writeTextFile("Data.csv", now);
      await repo.updateLocalHash("Data.csv", await sha(now));
      await db.execute("UPDATE files SET ctime = 111 WHERE path = ?", ["Data.csv"]);
      fresh.length = 0;

      await move("Data.csv", "Archive/Data.csv");
      await reindex("Archive/Data.csv");

      expect(await paths()).toEqual(["Archive/Data.csv"]);
      // It read as a brand-new file: announced for an upload beside the queued
      // MOVE, its creation time reset — and its merge base replaced by the
      // text with the row that had not gone up.
      expect(fresh).toEqual([]);
      expect(foreign).toEqual([]);
      expect((await row("Archive/Data.csv"))?.ctime).toBe(111);
      expect(await repo.getSyncState("Archive/Data.csv")).toMatchObject({
        base_text: before,
        base_sha256: await sha(before),
        local_sha256: await sha(now),
      });
      expect(await repo.getSyncState("Data.csv")).toBeNull();
    });
  }
});
