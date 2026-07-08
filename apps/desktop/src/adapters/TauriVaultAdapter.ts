import { IVaultAdapter, VaultFileInfo, VaultFileNotFoundError, VaultFileExistsError } from "@plainva/core";
import { readTextFile, writeTextFile, readFile, writeFile, readDir, stat, remove, rename, mkdir, exists } from "@tauri-apps/plugin-fs";
import { join, normalize, sep } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { isWithinRoot } from "./pathGuard";
import { toast } from "../services/toastStore";
import i18n from "../i18n";

export class TauriVaultAdapter implements IVaultAdapter {
  constructor(public readonly rootPath: string) {}

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
    const normalizedRoot = await normalize(this.rootPath);
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
  private async _listDirInternal(path: string, absPath: string, recursive: boolean, visited: Set<string>): Promise<VaultFileInfo[]> {
    if (visited.has(absPath)) return [];
    visited.add(absPath);

    if (!(await exists(absPath))) return [];
    
    const results: VaultFileInfo[] = [];
    const entries = await readDir(absPath);
    
    // Filter valid entries
    const validEntries = entries.filter(e => {
      if (e.isSymlink) return false; // Prevent infinite symlink loops
      const name = e.name;
      return name && name !== ".plainva" && name !== "node_modules" && name !== "dist" && name !== ".git" && !name.startsWith(".");
    });

    const separator = absPath.includes('\\') ? '\\' : '/';
    const basePath = absPath.endsWith(separator) ? absPath : absPath + separator;

    // Process sequentially to avoid overloading the IPC bridge
    for (const entry of validEntries) {
      const relativeChildPath = path ? `${path}/${entry.name}` : entry.name!;
      const childAbsPath = basePath + entry.name;
      
      let mtime = Date.now();
      let ctime: number | undefined;
      let size = 0;

      // Stat every file (not just .md): attachments need a real mtime/size too, or the
      // indexer's mtime-based change detection treats them as changed every pass and
      // re-reads + re-hashes them. A stat() per file is far cheaper than that. Directories
      // are skipped (no stat needed).
      if (!entry.isDirectory) {
        try {
          const entryStat = await stat(childAbsPath);
          mtime = entryStat.mtime?.getTime() || Date.now();
          ctime = entryStat.birthtime?.getTime() || undefined;
          size = entryStat.size;
        } catch {
          console.warn(`Failed to stat ${childAbsPath}`);
        }
      }

      results.push({
        name: entry.name!,
        path: relativeChildPath,
        isDirectory: entry.isDirectory,
        mtime,
        ctime,
        size
      });
    }

    // Process directories recursively
    if (recursive) {
      for (const entry of validEntries) {
        if (entry.isDirectory) {
          const relativeChildPath = path ? `${path}/${entry.name}` : entry.name!;
          const childAbsPath = basePath + entry.name;
          const childResults = await this._listDirInternal(relativeChildPath, childAbsPath, true, visited);
          results.push(...childResults);
        }
      }
    }
    
    return results;
  }

  async listDir(path: string = "", recursive: boolean = false): Promise<VaultFileInfo[]> {
    const absPath = await this.getAbsolutePath(path);
    return this._listDirInternal(path, absPath, recursive, new Set<string>());
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
