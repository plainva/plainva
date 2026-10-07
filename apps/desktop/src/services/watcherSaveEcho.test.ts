// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  VaultIndexer,
  VaultFileNotFoundError,
  initializeSchema,
  type IDatabaseAdapter,
  type IVaultAdapter,
  type VaultFileInfo,
  type VaultListing,
} from "@plainva/core";

vi.mock("@tauri-apps/plugin-fs", () => ({}));
vi.mock("@tauri-apps/api/path", () => ({}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null, Channel: class {} }));

import { mapNativeWatchBatch, type NativeWatchChange } from "../adapters/TauriVaultAdapter";
import { createIncrementalIndexQueue, type EscalationReason, type IndexBatchResult } from "./incrementalIndexQueue";
import { createWatchBatchCollector, toEnqueueArgs } from "./watchBatch";

/**
 * Issue 122 — "Saving makes typing really hard" (Windows, 0.8.4).
 *
 * The whole way of a watcher batch, with the real indexer at the end of it:
 * native events → `mapNativeWatchBatch` → the collector of the debounce window
 * → the index queue → `VaultIndexer` → what the host is told to reload.
 *
 * The event sequences are the ones `notify` 8.2 delivers on Windows
 * (ReadDirectoryChangesW), measured for an atomic save of
 * `Projects\Sub\note.md`: besides the files, the PARENT FOLDER is reported as
 * modified — three times. Before the fix each such report ran a full scan of
 * the vault about a second after every autosave, and the scan reloaded the
 * tree and every view that hangs on it.
 */

class NodeSqliteAdapter implements IDatabaseAdapter {
  private db = new DatabaseSync(":memory:");
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
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

/** A disk in memory: files with content and a modification time, folders by name. */
class MemoryVault implements Partial<IVaultAdapter> {
  files = new Map<string, { content: string; mtime: number }>();
  folders = new Set<string>();
  /** Full recursive listings — what a full scan costs. */
  walks = 0;
  private clock = 1_000;

  mkdir(path: string) {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
  }
  write(path: string, content: string) {
    const slash = path.lastIndexOf("/");
    if (slash > 0) this.mkdir(path.slice(0, slash));
    this.files.set(path, { content, mtime: (this.clock += 1_000) });
  }
  private info(path: string): VaultFileInfo {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const file = this.files.get(path);
    if (file) return { name, path, isDirectory: false, mtime: file.mtime, ctime: file.mtime, size: file.content.length };
    return { name, path, isDirectory: true, mtime: 1, size: 0 };
  }
  async getFileInfo(path: string): Promise<VaultFileInfo> {
    if (path === "" || this.folders.has(path) || this.files.has(path)) return this.info(path);
    throw new VaultFileNotFoundError(path);
  }
  async exists(path: string): Promise<boolean> {
    return path === "" || this.folders.has(path) || this.files.has(path);
  }
  async readTextFile(path: string): Promise<string> {
    const file = this.files.get(path);
    if (!file) throw new VaultFileNotFoundError(path);
    return file.content;
  }
  async readBinaryFile(path: string): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.readTextFile(path));
  }
  async listDir(path = "", recursive = false): Promise<VaultFileInfo[]> {
    return (await this.listDirReport(path, recursive)).files;
  }
  async listDirReport(path = "", recursive = false): Promise<VaultListing> {
    if (path !== "" && !this.folders.has(path)) return { files: [], skipped: [{ path, reason: "unreadable" }] };
    if (path === "" && recursive) this.walks++;
    const prefix = path ? `${path}/` : "";
    const below = (p: string) => p.startsWith(prefix) && (recursive || !p.slice(prefix.length).includes("/"));
    return {
      files: [...this.folders, ...this.files.keys()].filter(below).map((p) => this.info(p)),
      skipped: [],
    };
  }
}

const ROOT = "\\\\?\\C:\\Users\\me\\Vault";
const abs = (rel: string) => `${ROOT}\\${rel.replace(/\//g, "\\")}`;
const change = (kind: string, rel: string): NativeWatchChange => ({ kind, paths: [abs(rel)] });

/**
 * What Windows reports for ONE atomic save of `folder/name` (atomic_write.rs:
 * a temp file beside the note, renamed over it). The temp file's own events
 * are in the list: the native side drops them since this fix, but the
 * frontend must not depend on that.
 */
function atomicSaveOnWindows(folder: string, name: string): NativeWatchChange[] {
  const temp = `${folder}/.plainva-tmp-4120-7-${name}`;
  const note = `${folder}/${name}`;
  return [
    change("modify", folder),
    change("create", temp),
    change("modify", temp),
    change("modify", folder),
    change("remove", note),
    change("modify", folder),
    change("rename", temp),
    change("rename", note),
  ];
}

async function harness() {
  const vault = new MemoryVault();
  const db = new NodeSqliteAdapter();
  await initializeSchema(db);
  const deleted: string[] = [];
  const indexer = new VaultIndexer(vault as unknown as IVaultAdapter, db, { onLocalFileDeleted: (p) => deleted.push(p) });
  const fullScan = vi.spyOn(indexer, "indexVaultFull");
  const flat = vi.spyOn(indexer, "reconcileFolder");
  const results: IndexBatchResult[] = [];
  const escalations: EscalationReason[] = [];
  const queue = createIncrementalIndexQueue({
    indexer,
    exists: (p) => vault.exists(p),
    onBatchDone: (r) => results.push(r),
    onEscalation: (e) => escalations.push(e.reason),
    retryDelayMs: 0,
  });
  /** One debounce window: everything the watcher delivered, handed to the queue at once. */
  const deliver = async (...batches: NativeWatchChange[][]) => {
    const collector = createWatchBatchCollector();
    let relevant = false;
    for (const batch of batches) relevant = collector.add(mapNativeWatchBatch(batch, [ROOT]).events) || relevant;
    if (relevant) queue.enqueue(...toEnqueueArgs(collector.take()));
    await queue.whenIdle();
  };
  /** The versions a host would bump, as VaultContext does. */
  const bumps = () => ({
    structure: results.filter((r) => r.structureChanged).length,
    files: results.filter((r) => !r.structureChanged && r.anyChange).length,
  });
  const rows = async () => (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path);
  return { vault, db, indexer, fullScan, flat, queue, results, escalations, deleted, deliver, bumps, rows };
}

/** A vault with a note four folders deep, opened (one full scan) and at rest. */
async function openedVault() {
  const h = await harness();
  h.vault.write("top.md", "# Top\n");
  h.vault.write("Work/Projects/2026/Sub/note.md", "# Note\n");
  h.vault.write("Work/Projects/2026/Sub/other.md", "# Other\n");
  h.vault.write("Work/Archive/old.md", "# Old\n");
  h.vault.mkdir("Work/Projects/2026/Empty");
  await h.indexer.indexVaultFull("open");
  h.fullScan.mockClear();
  h.vault.walks = 0;
  return h;
}

/** The app saves a note: the bytes land, and the editor indexes the note itself. */
async function appSaves(h: Awaited<ReturnType<typeof harness>>, path: string, content: string) {
  h.vault.write(path, content);
  await h.indexer.indexPath(path);
}

describe("the echo of the app's own save (issue 122)", () => {
  it("runs no full scan and bumps nothing — the folder was only reported as modified", async () => {
    const h = await openedVault();
    await appSaves(h, "Work/Projects/2026/Sub/note.md", "# Note\n\nOne more sentence.\n");

    await h.deliver(atomicSaveOnWindows("Work/Projects/2026/Sub", "note.md"));

    expect(h.fullScan, "an autosave must never walk the vault").not.toHaveBeenCalled();
    expect(h.vault.walks).toBe(0);
    expect(h.escalations).toEqual([]);
    expect(h.bumps()).toEqual({ structure: 0, files: 0 });
    expect(h.results).toHaveLength(1);
    expect(h.results[0]).toMatchObject({ fullScan: false, anyChange: false });
    // The folder got its flat look, and only the folder.
    expect(h.flat.mock.calls.map((c) => c[0])).toEqual(["Work/Projects/2026/Sub"]);
    expect(h.deleted).toEqual([]);
  });

  it("stays quiet for the later echo of a sync client: modify events for the note and every folder above it", async () => {
    // A vault inside a OneDrive folder: seconds after the save the sync client
    // sets the file's sync state and attributes, and the watcher's filter
    // (FILE_NOTIFY_CHANGE_ATTRIBUTES) reports the note and its ancestors as
    // modified again — nothing was created, renamed or removed, and no
    // modification time moved.
    const h = await openedVault();
    await appSaves(h, "Work/Projects/2026/Sub/note.md", "# Note\n\nOne more sentence.\n");
    await h.deliver(atomicSaveOnWindows("Work/Projects/2026/Sub", "note.md"));

    for (let round = 0; round < 3; round++) {
      await h.deliver([
        change("modify", "Work/Projects/2026/Sub/note.md"),
        change("modify", "Work/Projects/2026/Sub"),
        change("modify", "Work/Projects/2026"),
        change("modify", "Work/Projects"),
        change("modify", "Work"),
        change("modify", "Work/Projects/2026/Sub/note.md"),
      ]);
    }

    expect(h.fullScan).not.toHaveBeenCalled();
    expect(h.vault.walks).toBe(0);
    expect(h.escalations).toEqual([]);
    expect(h.bumps()).toEqual({ structure: 0, files: 0 });
    expect(h.results.every((r) => !r.fullScan && !r.anyChange)).toBe(true);
    expect(await h.rows()).toEqual(["Work/Archive/old.md", "Work/Projects/2026/Sub/note.md", "Work/Projects/2026/Sub/other.md", "top.md"]);
  });

  it("the temp file alone is no batch at all", async () => {
    const h = await openedVault();
    const inspect = vi.spyOn(h.indexer, "inspectPath");
    await h.deliver([
      change("create", "Work/.plainva-tmp-4120-8-x.md"),
      change("modify", "Work/.plainva-tmp-4120-8-x.md"),
      change("rename", "Work/.plainva-tmp-4120-8-x.md"),
    ]);
    expect(inspect).not.toHaveBeenCalled();
    expect(h.results).toEqual([]);
  });

  it("a save in the vault root, where no folder is reported, was and stays quiet", async () => {
    const h = await openedVault();
    await appSaves(h, "top.md", "# Top, edited\n");
    await h.deliver([change("create", ".plainva-tmp-4120-9-top.md"), change("remove", "top.md"), change("rename", "top.md")]);
    expect(h.fullScan).not.toHaveBeenCalled();
    expect(h.bumps()).toEqual({ structure: 0, files: 0 });
  });
});

describe("another program writes into the vault", () => {
  it("a file created in a subfolder is indexed without a full scan", async () => {
    const h = await openedVault();
    h.vault.write("Work/Projects/2026/Sub/from-elsewhere.md", "# Elsewhere\n");
    await h.deliver([
      change("create", "Work/Projects/2026/Sub/from-elsewhere.md"),
      change("modify", "Work/Projects/2026/Sub/from-elsewhere.md"),
      change("modify", "Work/Projects/2026/Sub"),
    ]);
    expect(h.fullScan).not.toHaveBeenCalled();
    expect(await h.rows()).toContain("Work/Projects/2026/Sub/from-elsewhere.md");
    expect(h.bumps()).toEqual({ structure: 0, files: 1 });
    expect(h.results[0].paths).toContain("Work/Projects/2026/Sub/from-elsewhere.md");
  });

  it("a file written in place is re-indexed without a full scan", async () => {
    const h = await openedVault();
    h.vault.write("Work/Archive/old.md", "# Old, edited in another editor\n");
    await h.deliver([change("modify", "Work/Archive/old.md"), change("modify", "Work/Archive/old.md")]);
    expect(h.fullScan).not.toHaveBeenCalled();
    expect(h.bumps()).toEqual({ structure: 0, files: 1 });
  });

  it("a file whose own event never came is still found by the folder's flat look", async () => {
    const h = await openedVault();
    h.vault.write("Work/Archive/silent.md", "# Silent\n");
    await h.deliver([change("modify", "Work/Archive")]);
    expect(h.fullScan).not.toHaveBeenCalled();
    expect(await h.rows()).toContain("Work/Archive/silent.md");
    expect(h.bumps()).toEqual({ structure: 0, files: 1 });
  });

  it("an empty folder deleted in Explorer leaves the tree: its parent's flat look sees it gone", async () => {
    const h = await openedVault();
    h.vault.folders.delete("Work/Projects/2026/Empty");
    await h.deliver([change("remove", "Work/Projects/2026/Empty"), change("modify", "Work/Projects/2026")]);
    expect(h.fullScan).not.toHaveBeenCalled();
    expect(h.bumps()).toEqual({ structure: 1, files: 0 });
  });
});

describe("what still escalates to a full scan", () => {
  it("a folder created", async () => {
    const h = await openedVault();
    h.vault.write("Work/Copied/a.md", "# A\n");
    h.vault.write("Work/Copied/b.md", "# B\n");
    await h.deliver([change("create", "Work/Copied"), change("modify", "Work")]);
    expect(h.fullScan).toHaveBeenCalledTimes(1);
    expect(h.fullScan).toHaveBeenCalledWith("watcher: folder created or renamed");
    expect(h.escalations).toEqual(["folder created or renamed"]);
    expect(await h.rows()).toEqual(expect.arrayContaining(["Work/Copied/a.md", "Work/Copied/b.md"]));
    // The folder list changed: the tree's structure reloads.
    expect(h.bumps()).toEqual({ structure: 1, files: 0 });
  });

  it("a folder renamed — also when a modification of the same folder is in the window", async () => {
    const h = await openedVault();
    const moved = [...h.vault.files].filter(([p]) => p.startsWith("Work/Archive/"));
    for (const [p, f] of moved) {
      h.vault.files.delete(p);
      h.vault.files.set(p.replace("Work/Archive/", "Work/Attic/"), f);
    }
    h.vault.folders.delete("Work/Archive");
    h.vault.mkdir("Work/Attic");
    await h.deliver(
      [change("modify", "Work/Attic")],
      [change("rename", "Work/Archive"), change("rename", "Work/Attic"), change("modify", "Work/Attic"), change("modify", "Work")],
    );
    expect(h.fullScan).toHaveBeenCalledTimes(1);
    expect(await h.rows()).toEqual(["Work/Attic/old.md", "Work/Projects/2026/Sub/note.md", "Work/Projects/2026/Sub/other.md", "top.md"]);
    // The old place is purged, and its deletion reaches the sync layer.
    expect(h.deleted).toEqual(["Work/Archive/old.md"]);
    expect(h.bumps().structure).toBe(1);
  });

  it("a folder removed with its notes: purged, and every deletion reported", async () => {
    const h = await openedVault();
    for (const p of [...h.vault.files.keys()]) if (p.startsWith("Work/Projects/")) h.vault.files.delete(p);
    for (const p of [...h.vault.folders]) if (p.startsWith("Work/Projects")) h.vault.folders.delete(p);
    await h.deliver([change("remove", "Work/Projects"), change("modify", "Work")]);
    expect(h.fullScan).toHaveBeenCalledTimes(1);
    expect(h.escalations).toEqual(["folder removed or moved away"]);
    expect(await h.rows()).toEqual(["Work/Archive/old.md", "top.md"]);
    expect(h.deleted.sort()).toEqual(["Work/Projects/2026/Sub/note.md", "Work/Projects/2026/Sub/other.md"]);
  });

  it("a folder that is gone by the time its modification is looked at", async () => {
    const h = await openedVault();
    for (const p of [...h.vault.files.keys()]) if (p.startsWith("Work/Archive/")) h.vault.files.delete(p);
    h.vault.folders.delete("Work/Archive");
    await h.deliver([change("modify", "Work/Archive")]);
    expect(h.fullScan).toHaveBeenCalledTimes(1);
    expect(h.deleted).toEqual(["Work/Archive/old.md"]);
  });

  it("the rescan marker: a watcher error, a rescan notice, a path outside the vault", async () => {
    for (const batch of [
      [{ kind: "error", paths: [], message: "queue overflow" }],
      [{ kind: "rescan", paths: [] }],
      [{ kind: "modify", paths: ["D:\\Elsewhere\\x.md"] }],
    ] as NativeWatchChange[][]) {
      const h = await openedVault();
      await h.deliver(batch);
      expect(h.fullScan).toHaveBeenCalledTimes(1);
      expect(h.fullScan).toHaveBeenCalledWith("watcher: rescan requested");
      // The scan found the vault as it was: nothing reloads.
      expect(h.bumps()).toEqual({ structure: 0, files: 0 });
    }
  });

  it("a batch above the incremental limit", async () => {
    const h = await openedVault();
    const many: NativeWatchChange[] = [];
    for (let i = 0; i < 51; i++) {
      h.vault.write(`Work/Archive/bulk-${i}.md`, `# ${i}\n`);
      many.push(change("create", `Work/Archive/bulk-${i}.md`));
    }
    await h.deliver(many);
    expect(h.fullScan).toHaveBeenCalledTimes(1);
    expect(h.escalations).toEqual(["batch above the limit"]);
    expect(h.bumps()).toEqual({ structure: 0, files: 1 });
    expect(h.results[0].paths).toBeNull();
  });
});

describe("a full scan that finds the vault as it was", () => {
  it("tells the host to reload nothing", async () => {
    const h = await openedVault();
    h.queue.enqueue([""], { source: "watcher" });
    await h.queue.whenIdle();
    expect(h.fullScan).toHaveBeenCalledTimes(1);
    expect(h.results).toEqual([{ fullScan: true, anyChange: false, paths: null }]);
  });
});
