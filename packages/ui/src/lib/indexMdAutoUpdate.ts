import { isIndexNotWholeError } from "@plainva/core";
import { reportBackground } from "../services/backgroundErrors";
import { sweepPinboardRefs } from "../base/pinboardSweep";
import type { OwedPinboardSweeps } from "./movedNote";
import {
  frontmatterSpan,
  hasOkfVersionKey,
  isInternalPath,
  isPlainvaManagedIndex,
  isReservedOkfName,
  type VaultQueryService,
} from "@plainva/core";
import { generateIndexForFolder } from "./indexMdGenerate";
import { followFreshNoteMove } from "./freshNote";
import { type IndexMdAdapter } from "./indexMd";

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

/**
 * Fire-and-forget dispatch used by all file-operation call sites. Also where a
 * note made in this session keeps that mark across a move (`freshNote.ts`):
 * the one place every move of both shells passes.
 */
export function notifyFileOps(ops: FileOp[]): void {
  for (const op of ops) if (op.type === "move") followFreshNoteMove(op.from, op.to, op.isFolder);
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
  /**
   * The listings still owed to an index that was not whole, kept across a
   * closed vault (`owedListingsIn`): a folder whose listing waited for the
   * first index and lost the wait to a close is written at the next whole
   * index — its notes are indexed by then and no change would bring it back.
   */
  owed: OwedListings;
  /**
   * The pinboard sweeps a move found while the index was built and a close
   * cut short (`owedPinboardSweepsIn`): run at the next whole index, with the
   * owed listings (fourth review of 11.11.).
   */
  owedSweeps?: OwedPinboardSweeps;
}

/** Where the folders whose listing waits for a whole index are kept. */
export interface OwedListings {
  load(): string[];
  save(folders: readonly string[]): void;
}

/**
 * The owed listings of one vault on this device, in the app's local storage
 * (never in the vault: another device has its own index). A storage that
 * cannot be read or written keeps nothing, and the listing waits only as long
 * as the vault is open.
 */
export function owedListingsIn(vaultKey: string, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = typeof localStorage === "undefined" ? null : localStorage): OwedListings {
  const key = `plainva.indexMd.owed.${vaultKey}`;
  return {
    load() {
      try {
        const raw = storage?.getItem(key);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter((f): f is string => typeof f === "string") : [];
      } catch {
        return [];
      }
    },
    save(folders) {
      try {
        if (folders.length === 0) storage?.removeItem(key);
        else storage?.setItem(key, JSON.stringify([...new Set(folders)]));
      } catch {
        // Kept for as long as the vault is open, then.
      }
    },
  };
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
  // The pinboard sweeps an earlier session owed: run once this index is whole.
  if ((deps.owedSweeps?.load().length ?? 0) > 0) {
    void deps.queryService.untilWholeIndex().then(async () => {
      if (disposed || !deps.owedSweeps) return;
      const moves = deps.owedSweeps.load();
      try {
        const swept = await sweepPinboardRefs({ adapter: deps.adapter as never, queryService: deps.queryService }, moves);
        deps.owedSweeps.save(deps.owedSweeps.load().filter((m) => !moves.some((x) => x.from === m.from && x.to === m.to)));
        for (const path of swept) deps.onWritten?.(path);
      } catch (e) {
        // Still owed: the next whole index tries again.
        reportBackground("pinboard:owed-sweep", e);
      }
    }, () => { /* closed again: still owed */ });
  }
  // What an earlier session owed: written once this index is whole.
  const owedAtStart = deps.owed.load();
  if (owedAtStart.length > 0) {
    void deps.queryService.untilWholeIndex().then(() => {
      if (disposed) return;
      for (const folder of owedAtStart) pendingFolders.add(folder);
      void flush();
    }, () => { /* closed again: still owed */ });
  }
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
      const fm = frontmatterSpan(rootIndex);
      value = !!fm && hasOkfVersionKey(fm.yaml);
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
    // A listing is never written from half an index (performance plan L3):
    // it would miss every note not read yet and stay that way. Its folder
    // waits for the whole index and is written then.
    const deferred: string[] = [];
    for (const folder of folders) {
      try {
        const written = await refreshFolder(folder);
        if (written) {
          updated.push(written);
          deps.onWritten?.(written);
        }
      } catch (e) {
        if (isIndexNotWholeError(e)) deferred.push(folder);
        // The overview stays as it was; the next change in the folder writes it again.
        else reportBackground("index-md:auto-update", e);
      }
    }
    // Owed is what waits; a folder written or found unmanaged is owed no more.
    deps.owed.save([...deps.owed.load().filter((f) => !folders.includes(f)), ...deferred]);
    if (deferred.length > 0) {
      void deps.queryService.untilWholeIndex().then(() => {
        if (disposed) return;
        for (const folder of deferred) pendingFolders.add(folder);
        void flush();
      }, () => { /* the vault closed first: still owed, written at the next whole index */ });
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
