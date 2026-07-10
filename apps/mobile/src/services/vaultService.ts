import {
  initializeSchema,
  VaultIndexer,
  VaultQueryService,
  type SearchResult,
  type VaultFileInfo,
} from "@plainva/core";
import { CapacitorVaultAdapter } from "../adapters/CapacitorVaultAdapter";
import { CapacitorSqliteAdapter } from "../adapters/CapacitorSqliteAdapter";

/**
 * Mobile vault bootstrap (M2): a real sandbox vault (Capacitor filesystem —
 * IndexedDB on the web dev server) plus the shared core indexer/query
 * service on SQLite. The SQLite plugin has no plain-web backing store, so
 * in the browser initialize() fails and the app runs with search disabled;
 * natively (Android/iOS) the full FTS index is live.
 */

export interface MobileVault {
  adapter: CapacitorVaultAdapter;
  indexer: VaultIndexer | null;
  queryService: VaultQueryService | null;
  searchAvailable: boolean;
}

const OKF = (type: string, title: string, body: string) =>
  `---\ntype: ${type}\nokf_version: "1.0"\n---\n\n# ${title}\n\n${body}\n`;

const SEEDS: Array<[string, string]> = [
  [
    "Willkommen.md",
    OKF(
      "Note",
      "Willkommen",
      "Dein mobiler Plainva-Vault (M2) — echte Dateien in der App-Sandbox.\n\n- Der Editor ist DERSELBE wie am Desktop (`@plainva/ui`).\n- Tippe auf **+** für eine neue Notiz.\n- Wiki-Links funktionieren: [[Plainva Mobile]]\n\n> Sync kommt mit M3.",
    ),
  ],
  ["Inbox/Erste Idee.md", OKF("Note", "Erste Idee", "Schnell erfasst, später einsortiert.")],
  [
    "Projekte/Plainva Mobile.md",
    OKF(
      "Note",
      "Plainva Mobile",
      "Companion-App: erfassen, lesen, finden.\n\n- [x] M1 Gerüst\n- [ ] M2 Adapter\n- [ ] M3 Sync\n\nZurück zu [[Willkommen]].",
    ),
  ],
];

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

  let indexer: VaultIndexer | null;
  let queryService: VaultQueryService | null;
  let searchAvailable = false;
  try {
    const db = new CapacitorSqliteAdapter("plainva-index");
    await db.initialize();
    await initializeSchema(db);
    indexer = new VaultIndexer(adapter, db);
    queryService = new VaultQueryService(db);
    await indexer.indexVaultFull();
    searchAvailable = true;
  } catch (err) {
    console.warn("[mobile] index unavailable (expected on the plain web dev server)", err);
    indexer = null;
    queryService = null;
  }

  return { adapter, indexer, queryService, searchAvailable };
}

export interface FolderListing {
  folders: string[];
  notes: Array<{ path: string; title: string }>;
}

const noteTitle = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");

export const vaultOps = {
  async listFolder(v: MobileVault, folder: string): Promise<FolderListing> {
    const entries = await v.adapter.listDir(folder);
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
    const all = await v.adapter.listDir("", true);
    return all
      .filter((e) => !e.isDirectory && /\.md$/i.test(e.name) && !e.path.startsWith("."))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((e) => ({ path: e.path, title: noteTitle(e.path) }));
  },

  async read(v: MobileVault, path: string): Promise<string> {
    return v.adapter.readTextFile(path);
  },

  async save(v: MobileVault, path: string, text: string): Promise<void> {
    await v.adapter.writeTextFile(path, text);
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
      if (!(await v.adapter.exists(path))) {
        await this.save(v, path, OKF(type, title, ""));
        return path;
      }
    }
  },

  async ensureNote(v: MobileVault, path: string, type: string, title: string): Promise<string> {
    if (!(await v.adapter.exists(path))) await this.save(v, path, OKF(type, title, ""));
    return path;
  },

  async resolveWikiTarget(v: MobileVault, target: string): Promise<string | null> {
    const name = target.split("#")[0].split("|")[0].trim().toLowerCase();
    const all = await v.adapter.listDir("", true);
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
