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

/**
 * Mobile vault bootstrap (M2/M3): a real sandbox vault behind the SAME
 * adapter chain as the desktop — raw → backup snapshots → sync queue →
 * conflict-aware three-way merge — plus the shared indexer/query service on
 * SQLite. The SQLite plugin has no plain-web backing store, so in the
 * browser the app runs chainless with search and sync disabled; natively
 * the full stack is live.
 */

export interface MobileVault {
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
  if (!bootPromise) bootPromise = boot();
  return bootPromise;
}

async function boot(): Promise<MobileVault> {
  const adapter = new CapacitorVaultAdapter();
  await adapter.initialize();

  if ((await adapter.listDir("")).length === 0) {
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

  try {
    const db = new CapacitorSqliteAdapter("plainva-index");
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
  }

  const v: MobileVault = {
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
  };
  return v;
}

export interface FolderListing {
  folders: string[];
  notes: Array<{ path: string; title: string }>;
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
    return { folders, notes };
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
