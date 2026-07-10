import {
  BackupVaultAdapter,
  ConflictAwareVaultAdapter,
  DEFAULT_BACKUP_RETENTION,
  initializeSchema,
  QueueingVaultAdapter,
  SyncQueue,
  SyncStateRepository,
  VaultIndexer,
  VaultQueryService,
  type IVaultAdapter,
  type SearchResult,
  type VaultFileInfo,
} from "@plainva/core";
import { CapacitorVaultAdapter } from "../adapters/CapacitorVaultAdapter";
import { CapacitorSqliteAdapter } from "../adapters/CapacitorSqliteAdapter";
import { Directory, Filesystem } from "@capacitor/filesystem";
import {
  getActiveVaultEntry,
  removeVault,
  setActiveVault,
  LOCAL_VAULT_ID,
  type VaultEntry,
} from "./vaultRegistry";
import { purgeCredentials, stopSync } from "./syncService";

/**
 * Mobile vault bootstrap (M2/M3): a real sandbox vault behind the SAME
 * adapter chain as the desktop — raw → backup snapshots → sync queue →
 * conflict-aware three-way merge — plus the shared indexer/query service on
 * SQLite. The SQLite plugin has no plain-web backing store, so in the
 * browser the app runs chainless with search and sync disabled; natively
 * the full stack is live.
 */

export interface MobileVault {
  /** Registry id of this vault ("local" or a connection id). */
  vaultId: string;
  /** Raw sandbox adapter (listing, binary reads). */
  adapter: CapacitorVaultAdapter;
  /** App-facing adapter: the conflict-aware chain natively, raw on the web. */
  files: IVaultAdapter;
  backup: BackupVaultAdapter | null;
  syncQueue: SyncQueue | null;
  syncRepo: SyncStateRepository | null;
  indexer: VaultIndexer | null;
  queryService: VaultQueryService | null;
  searchAvailable: boolean;
  /** Lets locally created files enqueue for push (called once sync starts). */
  enableSyncEnqueue(): void;
  /** Ends the initial-index enqueue deferral (3c) after the first pull. */
  markFirstSyncComplete(): void;
  /** Re-indexes pulled paths so tree and search reflect remote changes. */
  reindexPaths(paths: string[]): Promise<void>;
  /** Closes the per-vault database (used when switching vaults). */
  dispose(): Promise<void>;
}

const OKF = (type: string, title: string, body: string) =>
  `---\ntype: ${type}\nokf_version: "1.0"\n---\n\n# ${title}\n\n${body}\n`;

const SEEDS: Array<[string, string]> = [
  [
    "Willkommen.md",
    OKF(
      "Note",
      "Willkommen",
      "Dein mobiler Plainva-Vault — echte Dateien in der App-Sandbox.\n\n- Der Editor ist DERSELBE wie am Desktop (`@plainva/ui`).\n- Tippe auf **+** für eine neue Notiz.\n- Wiki-Links funktionieren: [[Plainva Mobile]]\n\n> Sync: Mehr → Vault & Sync (WebDAV/Nextcloud).",
    ),
  ],
  ["Inbox/Erste Idee.md", OKF("Note", "Erste Idee", "Schnell erfasst, später einsortiert.")],
  [
    "Projekte/Plainva Mobile.md",
    OKF(
      "Note",
      "Plainva Mobile",
      "Companion-App: erfassen, lesen, finden.\n\n- [x] M1 Gerüst\n- [x] M2 Adapter\n- [ ] M3 Sync\n\nZurück zu [[Willkommen]].",
    ),
  ],
];

const isInternal = (path: string) => path.startsWith(".plainva") || path.includes(".CONFLICT");

let bootPromise: Promise<MobileVault> | null = null;

export function getMobileVault(): Promise<MobileVault> {
  if (!bootPromise) bootPromise = getActiveVaultEntry().then(boot);
  return bootPromise;
}

/**
 * Activates another registry vault: stops the sync worker, closes the
 * current per-vault database and reboots. Screens listen for the event and
 * reset their stacks.
 */
export async function switchVault(id: string): Promise<void> {
  const current = bootPromise ? await bootPromise.catch(() => null) : null;
  if (current?.vaultId === id) return;
  stopSync();
  await setActiveVault(id);
  if (current) await current.dispose().catch(() => {});
  bootPromise = null;
  window.dispatchEvent(new CustomEvent("m-vault-switched", { detail: { id } }));
}

/**
 * Deletes a connection vault: device-local container, index database,
 * credential slot and registry entry. The cloud storage is never touched.
 */
export async function deleteVault(id: string): Promise<void> {
  if (id === LOCAL_VAULT_ID) throw new Error("the local vault cannot be deleted");
  const current = bootPromise ? await bootPromise.catch(() => null) : null;
  if (current?.vaultId === id) await switchVault(LOCAL_VAULT_ID);
  try {
    await Filesystem.rmdir({ path: `vaults/${id}`, directory: Directory.Data, recursive: true });
  } catch {
    /* container may not exist (never synced) */
  }
  await CapacitorSqliteAdapter.deleteDatabase(`plainva-${id}`).catch(() => {});
  await purgeCredentials(id).catch(() => {});
  await removeVault(id);
}

async function boot(entry: VaultEntry): Promise<MobileVault> {
  const isLocal = entry.id === LOCAL_VAULT_ID;
  // The pre-isolation sandbox keeps its paths; every connection vault gets
  // its own filesystem root and its own database.
  const adapter = new CapacitorVaultAdapter(isLocal ? "vault" : `vaults/${entry.id}`);
  await adapter.initialize();

  if (isLocal && (await adapter.listDir("")).length === 0) {
    for (const [path, text] of SEEDS) await adapter.writeTextFile(path, text);
  }

  // Enqueue guards mirror the desktop: nothing enqueues before sync is
  // configured, and the initial full index defers new-file pushes until the
  // first pull established the remote base (3c — a fresh index must never
  // mass-push over a possibly newer remote).
  let syncEnqueueEnabled = false;
  let deferInitialEnqueue = true;
  let queue: SyncQueue | null = null;

  const enqueueLocal = (path: string) => {
    if (!syncEnqueueEnabled || !queue || isInternal(path)) return;
    void queue.queueWrite(path).catch(() => {});
  };

  let files: IVaultAdapter;
  let backup: BackupVaultAdapter | null;
  let syncRepo: SyncStateRepository | null;
  let indexer: VaultIndexer | null;
  let queryService: VaultQueryService | null;
  let searchAvailable = false;

  let db: CapacitorSqliteAdapter | null = null;
  try {
    db = new CapacitorSqliteAdapter(isLocal ? "plainva-index" : `plainva-${entry.id}`);
    await db.initialize();
    await initializeSchema(db);

    backup = new BackupVaultAdapter(adapter, {
      policy: DEFAULT_BACKUP_RETENTION,
      onBackupError: (p) => console.warn("[mobile] backup snapshot failed", p),
    });
    queue = new SyncQueue(db);
    const queueing = new QueueingVaultAdapter(backup, queue);
    syncRepo = new SyncStateRepository(db);
    files = new ConflictAwareVaultAdapter(queueing, syncRepo, (path, mergedText) => {
      window.dispatchEvent(new CustomEvent("m-auto-merged", { detail: { path, mergedText } }));
    });

    indexer = new VaultIndexer(files, db, {
      onExternalModification: (path) => {
        enqueueLocal(path);
        window.dispatchEvent(new CustomEvent("m-external-update", { detail: { path } }));
      },
      onNewLocalFile: (path) => {
        if (deferInitialEnqueue) return;
        enqueueLocal(path);
      },
      onLocalFileDeleted: (path) => {
        if (!syncEnqueueEnabled || !queue || isInternal(path)) return;
        void queue.queueDelete(path).catch(() => {});
      },
    });
    queryService = new VaultQueryService(db);
    await indexer.indexVaultFull();
    searchAvailable = true;
  } catch (err) {
    console.warn("[mobile] index unavailable (expected on the plain web dev server)", err);
    files = adapter;
    backup = null;
    queue = null;
    syncRepo = null;
    indexer = null;
    queryService = null;
    db = null;
  }

  const v: MobileVault = {
    vaultId: entry.id,
    adapter,
    files,
    backup,
    syncQueue: queue,
    syncRepo,
    indexer,
    queryService,
    searchAvailable,
    enableSyncEnqueue: () => {
      syncEnqueueEnabled = true;
    },
    markFirstSyncComplete: () => {
      deferInitialEnqueue = false;
    },
    reindexPaths: async (paths) => {
      if (!indexer) return;
      for (const p of paths) {
        try {
          await indexer.indexFile(await adapter.getFileInfo(p));
        } catch {
          /* deleted or transient — the next full pass repairs it */
        }
      }
    },
    dispose: async () => {
      if (db) await db.close().catch(() => {});
    },
  };
  return v;
}

export interface FolderListing {
  folders: string[];
  notes: Array<{ path: string; title: string }>;
  /** Read-only databases (M4): .base files in this folder. */
  bases: Array<{ path: string; title: string }>;
}

const noteTitle = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");

export const vaultOps = {
  async listFolder(v: MobileVault, folder: string): Promise<FolderListing> {
    const entries = await v.files.listDir(folder);
    const folders = entries
      .filter((e) => e.isDirectory && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
    const notes = entries
      .filter((e) => !e.isDirectory && /\.md$/i.test(e.name))
      .map((e) => ({ path: e.path, title: noteTitle(e.path) }))
      .sort((a, b) => a.title.localeCompare(b.title));
    const bases = entries
      .filter((e) => !e.isDirectory && /\.base$/i.test(e.name))
      .map((e) => ({ path: e.path, title: e.name.replace(/\.base$/i, "") }))
      .sort((a, b) => a.title.localeCompare(b.title));
    return { folders, notes, bases };
  },

  /** Renames a note within its folder; sync mirrors it via the queueing chain. */
  async rename(v: MobileVault, oldPath: string, newTitle: string): Promise<string> {
    const dir = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/") + 1) : "";
    const newPath = `${dir}${newTitle}.md`;
    if (newPath === oldPath) return oldPath;
    await v.files.renameItem(oldPath, newPath);
    if (v.indexer) {
      await v.indexer.removePathFromIndex(oldPath).catch(() => {});
      try {
        await v.indexer.indexFile(await v.adapter.getFileInfo(newPath));
      } catch {
        /* next full pass repairs it */
      }
    }
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
    return newPath;
  },

  /** Deletes a note; with sync active the deletion reaches the cloud too. */
  async remove(v: MobileVault, path: string): Promise<void> {
    await v.files.deleteItem(path);
    if (v.indexer) await v.indexer.removePathFromIndex(path).catch(() => {});
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
  },

  /* ---- P3: full file/folder operations (all through the sync chain) ---- */

  async createFolder(v: MobileVault, path: string): Promise<void> {
    await v.files.createDir(path);
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
  },

  /** Folder renames/deletes re-run the full index (children change paths). */
  async renameFolder(v: MobileVault, oldPath: string, newName: string): Promise<void> {
    const dir = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/") + 1) : "";
    const newPath = `${dir}${newName}`;
    if (newPath === oldPath) return;
    await v.files.renameItem(oldPath, newPath);
    if (v.indexer) await v.indexer.indexVaultFull().catch(() => {});
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
  },

  async removeFolder(v: MobileVault, path: string): Promise<void> {
    await v.files.deleteItem(path, true);
    if (v.indexer) await v.indexer.indexVaultFull().catch(() => {});
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
  },

  async moveNote(v: MobileVault, path: string, targetFolder: string): Promise<string> {
    const name = path.split("/").pop()!;
    const newPath = targetFolder ? `${targetFolder}/${name}` : name;
    if (newPath === path) return path;
    await v.files.renameItem(path, newPath);
    if (v.indexer) {
      await v.indexer.removePathFromIndex(path).catch(() => {});
      try {
        await v.indexer.indexFile(await v.adapter.getFileInfo(newPath));
      } catch {
        /* next full pass repairs it */
      }
    }
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
    return newPath;
  },

  async duplicateNote(v: MobileVault, path: string): Promise<string> {
    const text = await v.files.readTextFile(path);
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    const base = path.split("/").pop()!.replace(/\.md$/i, "");
    let candidate = `${dir}${base} 2.md`;
    for (let n = 2; await v.files.exists(candidate); n++) {
      candidate = `${dir}${base} ${n + 1}.md`;
    }
    await v.files.writeTextFile(candidate, text);
    if (v.indexer) {
      try {
        await v.indexer.indexFile(await v.adapter.getFileInfo(candidate));
      } catch {
        /* next full pass repairs it */
      }
    }
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
    return candidate;
  },

  /* ---- P3: bookmarks (device-local, .plainva/bookmarks.json) ---- */

  async getBookmarks(v: MobileVault): Promise<string[]> {
    try {
      const raw = await v.adapter.readTextFile(".plainva/bookmarks.json");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
    } catch {
      return [];
    }
  },

  async toggleBookmark(v: MobileVault, path: string): Promise<boolean> {
    const marks = await this.getBookmarks(v);
    const idx = marks.indexOf(path);
    if (idx >= 0) marks.splice(idx, 1);
    else marks.push(path);
    await v.adapter.writeTextFile(".plainva/bookmarks.json", JSON.stringify(marks, null, 2));
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
    return idx < 0;
  },

  async recent(v: MobileVault, limit: number): Promise<Array<{ path: string; title: string }>> {
    const all = await v.files.listDir("", true);
    return all
      .filter((e) => !e.isDirectory && /\.md$/i.test(e.name) && !e.path.startsWith("."))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((e) => ({ path: e.path, title: noteTitle(e.path) }));
  },

  async read(v: MobileVault, path: string): Promise<string> {
    return v.files.readTextFile(path);
  },

  async save(v: MobileVault, path: string, text: string): Promise<void> {
    await v.files.writeTextFile(path, text);
    if (v.indexer) {
      try {
        const info: VaultFileInfo = await v.adapter.getFileInfo(path);
        await v.indexer.indexFile(info);
      } catch {
        /* index lag is acceptable; the next full pass repairs it */
      }
    }
  },

  async createNote(v: MobileVault, folder: string, type: string): Promise<string> {
    for (let n = 1; ; n++) {
      const title = `Notiz ${n}`;
      const path = `${folder}/${title}.md`;
      if (!(await v.files.exists(path))) {
        await this.save(v, path, OKF(type, title, ""));
        return path;
      }
    }
  },

  async ensureNote(v: MobileVault, path: string, type: string, title: string): Promise<string> {
    if (!(await v.files.exists(path))) await this.save(v, path, OKF(type, title, ""));
    return path;
  },

  async resolveWikiTarget(v: MobileVault, target: string): Promise<string | null> {
    const name = target.split("#")[0].split("|")[0].trim().toLowerCase();
    const all = await v.files.listDir("", true);
    for (const e of all) {
      if (e.isDirectory || !/\.md$/i.test(e.name)) continue;
      if (noteTitle(e.path).toLowerCase() === name) return e.path;
    }
    return null;
  },

  async search(v: MobileVault, query: string): Promise<SearchResult[]> {
    if (!v.queryService) return [];
    return v.queryService.searchFullText(query, 30);
  },
};
