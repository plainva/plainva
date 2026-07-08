import { IVaultAdapter, VaultFileInfo, VaultFileNotFoundError, VaultFileExistsError } from "@plainva/core";
import { readTextFile, writeTextFile, readFile, writeFile, readDir, stat, remove, rename, mkdir, exists } from "@tauri-apps/plugin-fs";
import { join, normalize, sep } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { isWithinRoot } from "./pathGuard";
import { toast } from "../services/toastStore";
import i18n from "../i18n";
import { createLimiter, type ConcurrencyLimiter } from "../lib/concurrencyLimiter";

/**
 * How many filesystem calls (stat/readDir/exists) may be in flight at once
 * during a directory walk. The walk used to stat every file strictly
 * sequentially, which on a network drive meant 500+ serial round-trips before
 * the first note could render. Bounding at 8 keeps the IPC bridge from being
 * overwhelmed while overlapping the network latency.
 */
const LIST_CONCURRENCY = 8;

type FsLimiter = ConcurrencyLimiter;

export class TauriVaultAdapter implements IVaultAdapter {
  constructor(public readonly rootPath: string) {}

  /** Cached normalize(rootPath): the vault root never changes, but getAbsolutePath
   *  used to re-normalize it via IPC on EVERY read/write/exists/stat call (WP5). */
  private normalizedRootPromise: Promise<string> | null = null;
  private normalizedRoot(): Promise<string> {
    if (!this.normalizedRootPromise) this.normalizedRootPromise = normalize(this.rootPath);
    return this.normalizedRootPromise;
  }

  async initialize(): Promise<void> {
    const isExist = await exists(this.rootPath);
    if (!isExist) {
      await mkdir(this.rootPath, { recursive: true });
    }
  }

  async dispose(): Promise<void> {
    // No-op for FS
  }

  private async getAbsolutePath(relativePath: string): Promise<string> {
    const absolute = await join(this.rootPath, relativePath);
    const normalized = await normalize(absolute);
    const normalizedRoot = await this.normalizedRoot();
    if (!isWithinRoot(normalizedRoot, normalized, sep())) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }
    return normalized;
  }

  async readTextFile(path: string): Promise<string> {
    const absPath = await this.getAbsolutePath(path);
    if (!(await exists(absPath))) throw new VaultFileNotFoundError(path);
    return readTextFile(absPath);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const absPath = await this.getAbsolutePath(path);
    const parts = absPath.split(sep());
    parts.pop();
    const parentDir = parts.join(sep());
    if (!(await exists(parentDir))) {
      await mkdir(parentDir, { recursive: true });
    }
    await writeTextFile(absPath, content);
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const absPath = await this.getAbsolutePath(path);
    if (!(await exists(absPath))) throw new VaultFileNotFoundError(path);
    return readFile(absPath);
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    const absPath = await this.getAbsolutePath(path);
    const parts = absPath.split(sep());
    parts.pop();
    const parentDir = parts.join(sep());
    if (!(await exists(parentDir))) {
      await mkdir(parentDir, { recursive: true });
    }
    await writeFile(absPath, content);
  }



  async deleteItem(path: string, recursive: boolean = false): Promise<void> {
    const absPath = await this.getAbsolutePath(path);
    if (!(await exists(absPath))) throw new VaultFileNotFoundError(path);

    // Internal housekeeping (backup rotation, pruning) must not flood the OS
    // trash — hard-delete everything under .plainva; user content keeps
    // going to the trash.
    const norm = path.replace(/\\/g, "/");
    if (norm === ".plainva" || norm.startsWith(".plainva/")) {
      await remove(absPath, { recursive });
      return;
    }

    try {
      await invoke("move_to_trash", { path: absPath });
    } catch (err) {
      // Fallback to tauri-plugin-fs remove if OS trash fails (network share
      // without a recycle bin, disabled trash, …). A user who confirmed
      // "delete" expects the TRASH — a silent hard-delete breaks that
      // expectation, so it must be visible. Pre-delete snapshots in
      // .plainva/backups (BackupVaultAdapter) remain the safety net.
      console.warn(`[TauriVaultAdapter] OS trash unavailable for ${absPath}; deleting permanently`, err);
      await remove(absPath, { recursive });
      toast.warning(i18n.t("dialogs.trashUnavailableMsg", { name: path.split(/[/\\]/).pop() }));
    }
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    const oldAbs = await this.getAbsolutePath(oldPath);
    const newAbs = await this.getAbsolutePath(newPath);
    if (!(await exists(oldAbs))) throw new VaultFileNotFoundError(oldPath);
    if (await exists(newAbs)) throw new VaultFileExistsError(newPath);
    await rename(oldAbs, newAbs);
  }

  async exists(path: string): Promise<boolean> {
    const absPath = await this.getAbsolutePath(path);
    return await exists(absPath);
  }

  async getFileInfo(path: string): Promise<VaultFileInfo> {
    const absPath = await this.getAbsolutePath(path);
    if (!(await exists(absPath))) throw new VaultFileNotFoundError(path);
    const entryStat = await stat(absPath);
    return {
      name: path.split(/[/\\]/).pop() || "",
      path,
      isDirectory: entryStat.isDirectory,
      mtime: entryStat.mtime?.getTime() || Date.now(),
      ctime: entryStat.birthtime?.getTime() || undefined,
      size: entryStat.size
    };
  }

  // Internal method to handle recursion and symlink protection
  private async _listDirInternal(path: string, absPath: string, recursive: boolean, visited: Set<string>, limit: FsLimiter): Promise<VaultFileInfo[]> {
    if (visited.has(absPath)) return [];
    visited.add(absPath);

    if (!(await limit.run(() => exists(absPath)))) return [];

    const entries = await limit.run(() => readDir(absPath));

    // Filter valid entries
    const validEntries = entries.filter(e => {
      if (e.isSymlink) return false; // Prevent infinite symlink loops
      const name = e.name;
      return name && name !== ".plainva" && name !== "node_modules" && name !== "dist" && name !== ".git" && !name.startsWith(".");
    });

    const separator = absPath.includes('\\') ? '\\' : '/';
    const basePath = absPath.endsWith(separator) ? absPath : absPath + separator;

    // Stat the files of this folder CONCURRENTLY (bounded by the shared limiter).
    // The stats used to run strictly one after another — on a network drive that
    // was the dominant vault-load cost. Directories carry no stat (mtime/size are
    // unused for them). Order is preserved via Promise.all over validEntries.
    //
    // Stat every file (not just .md): attachments need a real mtime/size too, or
    // the indexer's mtime-based change detection treats them as changed every
    // pass and re-reads + re-hashes them. A stat() is far cheaper than that.
    const results: VaultFileInfo[] = await Promise.all(
      validEntries.map((entry) => {
        const relativeChildPath = path ? `${path}/${entry.name}` : entry.name!;
        if (entry.isDirectory) {
          return Promise.resolve<VaultFileInfo>({
            name: entry.name!, path: relativeChildPath, isDirectory: true,
            mtime: Date.now(), ctime: undefined, size: 0,
          });
        }
        const childAbsPath = basePath + entry.name;
        return limit.run(async () => {
          let mtime = Date.now();
          let ctime: number | undefined;
          let size = 0;
          try {
            const entryStat = await stat(childAbsPath);
            mtime = entryStat.mtime?.getTime() || Date.now();
            ctime = entryStat.birthtime?.getTime() || undefined;
            size = entryStat.size;
          } catch {
            console.warn(`Failed to stat ${childAbsPath}`);
          }
          return { name: entry.name!, path: relativeChildPath, isDirectory: false, mtime, ctime, size };
        });
      })
    );

    // Recurse into subdirectories concurrently too; the shared limiter keeps the
    // total in-flight FS calls across the whole tree at LIST_CONCURRENCY. No call
    // holds a slot while awaiting children, so there is no deadlock. `visited`
    // guards symlink loops (the check+add is synchronous, before the first await).
    if (recursive) {
      const childLists = await Promise.all(
        validEntries
          .filter((e) => e.isDirectory)
          .map((entry) => {
            const relativeChildPath = path ? `${path}/${entry.name}` : entry.name!;
            const childAbsPath = basePath + entry.name;
            return this._listDirInternal(relativeChildPath, childAbsPath, true, visited, limit);
          })
      );
      for (const cl of childLists) results.push(...cl);
    }

    return results;
  }

  async listDir(path: string = "", recursive: boolean = false): Promise<VaultFileInfo[]> {
    const absPath = await this.getAbsolutePath(path);
    return this._listDirInternal(path, absPath, recursive, new Set<string>(), createLimiter(LIST_CONCURRENCY));
  }

  async createDir(path: string): Promise<void> {
    const absPath = await this.getAbsolutePath(path);
    if (!(await exists(absPath))) {
      await mkdir(absPath, { recursive: true });
    }
  }

  async watch(callback: (events: import("@plainva/core").WatchEvent[]) => void): Promise<() => void> {
    try {
      const { watch: tauriWatch } = await import("@tauri-apps/plugin-fs");

      const unwatch = await tauriWatch(this.rootPath, async (event) => {
        // Ignore "access" events (reading files/directories) to prevent infinite loops 
        // when the indexer reads the vault.
        const typeStr = JSON.stringify(event.type).toLowerCase();
        if (typeStr.includes('access')) {
          return;
        }

        // tauri event has paths array
        const vaultPaths = (event.paths || []).map(p => {
          // Attempt to convert absolute path to vault-relative path
          // Simple string replace for now since we know rootPath is prefix
          let rel = p;
          if (p.startsWith(this.rootPath)) {
            rel = p.substring(this.rootPath.length);
            if (rel.startsWith("\\") || rel.startsWith("/")) {
              rel = rel.substring(1);
            }
          }
          return rel.split("\\").join("/");
        });
        
        callback(vaultPaths.map(p => ({ path: p, type: "any" })));
      }, { recursive: true, delayMs: 300 });

      return unwatch;
    } catch (err: any) {
      console.error("Tauri watch failed to start:", err);
      throw err;
    }
  }
}
