import {
  isInternalPath,
  isPlainvaManagedIndex,
  isReservedOkfName,
  type VaultQueryService,
} from "@plainva/core";
import { generateIndexForFolder, type IndexMdAdapter } from "./indexMd";

/**
 * Automatic refresh of Plainva-managed index.md files (plan UI-UX-Paket P11).
 * Operation-driven, not watcher-driven — the file operations report themselves
 * via the `plainva-file-ops` window event AFTER their reindex, the updater
 * debounces per batch and rewrites only listings that (a) already exist and
 * (b) carry the managed marker, and only while the vault is OKF-active (root
 * index.md with okf_version frontmatter). Structurally loop-free: writing an
 * index.md is itself a reserved-name path and never queues a refresh.
 */

export type FileOp =
  | { type: "create" | "delete"; path: string; isFolder?: boolean }
  | { type: "move"; from: string; to: string; isFolder?: boolean };

/** Fire-and-forget dispatch used by all file-operation call sites. */
export function notifyFileOps(ops: FileOp[]): void {
  if (ops.length > 0) {
    window.dispatchEvent(new CustomEvent("plainva-file-ops", { detail: { ops } }));
  }
}

const normalize = (p: string): string => p.replace(/\\/g, "/");
const parentOf = (p: string): string => {
  const n = normalize(p);
  const i = n.lastIndexOf("/");
  return i < 0 ? "" : n.slice(0, i);
};
const basenameOf = (p: string): string => normalize(p).split("/").pop() ?? p;

/** Folders whose managed index.md should refresh for the given operations. */
export function affectedFolders(ops: FileOp[]): Set<string> {
  const out = new Set<string>();
  const consider = (path: string | undefined, isFolder: boolean | undefined) => {
    if (!path || isInternalPath(path)) return;
    if (!isFolder) {
      const name = basenameOf(path);
      // Listings only show .md files; index.md/log.md writes never cascade.
      if (!name.toLowerCase().endsWith(".md")) return;
      if (isReservedOkfName(name)) return;
    }
    out.add(parentOf(path));
  };
  for (const op of ops) {
    if (op.type === "move") {
      consider(op.from, op.isFolder);
      consider(op.to, op.isFolder);
      // A renamed/moved folder also refreshes its own listing (heading = name).
      if (op.isFolder && !isInternalPath(op.to)) out.add(normalize(op.to));
    } else {
      consider(op.path, op.isFolder);
    }
  }
  return out;
}

export interface IndexAutoUpdaterDeps {
  adapter: IndexMdAdapter;
  queryService: VaultQueryService;
  /** Heading of the vault-root listing. */
  vaultName: () => string;
  /** Localized heading of the subfolder section. */
  subfoldersHeading: () => string;
  /** Called per rewritten index.md (tree refresh + editor reload). */
  onWritten?: (indexPath: string) => void;
  debounceMs?: number;
}

export interface IndexAutoUpdater {
  notify(ops: FileOp[]): void;
  /** Runs the pending refreshes now (tests and teardown). */
  flush(): Promise<{ updated: string[] }>;
  dispose(): void;
}

export function createIndexAutoUpdater(deps: IndexAutoUpdaterDeps): IndexAutoUpdater {
  const pendingFolders = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let running: Promise<{ updated: string[] }> | null = null;
  let okfActiveCache: { value: boolean; at: number } | null = null;

  // OKF-active = root index.md with okf_version frontmatter (SPEC §11), cached
  // briefly — every batch would otherwise re-read the root file.
  const okfActive = async (): Promise<boolean> => {
    const now = Date.now();
    if (okfActiveCache && now - okfActiveCache.at < 60_000) return okfActiveCache.value;
    let value: boolean;
    try {
      const rootIndex = await deps.adapter.readTextFile("index.md");
      const fm = rootIndex.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      value = !!fm && /(^|\r?\n)\s*okf_version\s*:/.test(fm[1]);
    } catch {
      value = false;
    }
    okfActiveCache = { value, at: now };
    return value;
  };

  const refreshFolder = async (folder: string): Promise<string | null> => {
    const indexPath = folder ? `${folder}/index.md` : "index.md";
    let existing: string;
    try {
      existing = await deps.adapter.readTextFile(indexPath);
    } catch {
      return null; // no index.md — never create one unasked
    }
    if (!isPlainvaManagedIndex(existing)) return null; // manual/adopted — hands off
    const heading = folder ? folder.split("/").pop()! : deps.vaultName();
    await generateIndexForFolder({
      adapter: deps.adapter,
      queryService: deps.queryService,
      folder,
      heading,
      subfoldersHeading: deps.subfoldersHeading(),
      skipBackup: true,
    });
    return indexPath;
  };

  const flushNow = async (): Promise<{ updated: string[] }> => {
    const folders = [...pendingFolders];
    pendingFolders.clear();
    const updated: string[] = [];
    if (folders.length === 0 || disposed) return { updated };
    if (!(await okfActive())) return { updated };
    for (const folder of folders) {
      try {
        const written = await refreshFolder(folder);
        if (written) {
          updated.push(written);
          deps.onWritten?.(written);
        }
      } catch (e) {
        console.warn("[indexMdAutoUpdate] refresh failed for", folder, e);
      }
    }
    return { updated };
  };

  const flush = async (): Promise<{ updated: string[] }> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    // Serialize: a flush during a running flush waits, then drains the rest.
    const prev = running ?? Promise.resolve({ updated: [] as string[] });
    const next = prev.then(() => flushNow());
    running = next.finally(() => {
      if (running === next) running = null;
    });
    return next;
  };

  return {
    notify(ops: FileOp[]) {
      if (disposed) return;
      for (const folder of affectedFolders(ops)) pendingFolders.add(folder);
      if (pendingFolders.size === 0) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void flush();
      }, deps.debounceMs ?? 500);
    },
    flush,
    dispose() {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingFolders.clear();
    },
  };
}

/**
 * "Alle index.md aktualisieren" (vault root / settings): rewrites every
 * listing that carries the managed marker; unmarked ones are counted, never
 * touched. Explicitly user-triggered, so it does not check OKF-active.
 */
export async function updateAllManagedIndexes(
  deps: Pick<IndexAutoUpdaterDeps, "adapter" | "queryService" | "vaultName" | "subfoldersHeading">
): Promise<{ updated: string[]; skippedNoMarker: number }> {
  const rows = await deps.queryService.db.query<{ path: string }>(
    `SELECT path FROM files WHERE mode != 'attachment'`
  );
  const indexes = rows
    .map((r) => normalize(r.path))
    .filter((p) => basenameOf(p).toLowerCase() === "index.md");
  const updated: string[] = [];
  let skippedNoMarker = 0;
  for (const indexPath of indexes) {
    try {
      const content = await deps.adapter.readTextFile(indexPath);
      if (!isPlainvaManagedIndex(content)) {
        skippedNoMarker++;
        continue;
      }
      const folder = parentOf(indexPath);
      const heading = folder ? folder.split("/").pop()! : deps.vaultName();
      await generateIndexForFolder({
        adapter: deps.adapter,
        queryService: deps.queryService,
        folder,
        heading,
        subfoldersHeading: deps.subfoldersHeading(),
        skipBackup: true,
      });
      updated.push(indexPath);
    } catch (e) {
      console.warn("[indexMdAutoUpdate] update-all failed for", indexPath, e);
    }
  }
  return { updated, skippedNoMarker };
}
