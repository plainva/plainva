import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  IVaultAdapter,
  VaultFileInfo,
  VaultFileNotFoundError,
  VaultPermissionDeniedError,
  VaultFileExistsError,
  VaultError,
} from "./IVaultAdapter.js";
import { PathSpellings, withStoredSpelling, type SpellingSource } from "../sync/pathSpellings.js";

/**
 * A local file system implementation of IVaultAdapter.
 * Used for Desktop (Node.js/Tauri) environments.
 */
export class LocalVaultAdapter implements IVaultAdapter {
  /**
   * Path identity vs. stored spelling (ADR 0016): callers name files by their
   * NFC identity, the disk keeps whatever form a file was created in.
   */
  private readonly spellings = new PathSpellings();
  private readonly spellingSource: SpellingSource = {
    exists: async (raw) => {
      try {
        await fs.access(this.resolvePath(raw));
        return true;
      } catch {
        return false;
      }
    },
    listNames: async (raw) => {
      try {
        return await fs.readdir(this.resolvePath(raw));
      } catch (err: any) {
        if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return null;
        throw err;
      }
    },
  };

  /**
   * @param basePath The absolute path to the root of the vault.
   */
  constructor(private readonly basePath: string) {
    if (!path.isAbsolute(basePath)) {
      throw new Error("LocalVaultAdapter requires an absolute base path.");
    }
  }

  /** The spelling `vaultPath` is stored under on this disk (ADR 0016). */
  async realPath(vaultPath: string): Promise<string> {
    return this.spellings.resolve(vaultPath, this.spellingSource);
  }

  private stored<T>(vaultPath: string, io: (raw: string) => Promise<T>): Promise<T> {
    return withStoredSpelling(this.spellings, vaultPath, this.spellingSource, io);
  }

  /** Listing entries named by identity, the requested folder being `anchor`. */
  private identities(entries: VaultFileInfo[], anchor: { raw: string; identity: string }): VaultFileInfo[] {
    const ids = this.spellings.observe(entries.map((e) => e.path), anchor);
    return entries.map((e) => {
      const id = ids.get(e.path);
      if (id === undefined || id === e.path) return e;
      return { ...e, path: id, name: id.slice(id.lastIndexOf("/") + 1) };
    });
  }

  /**
   * Helper to resolve a vault-relative path to an absolute OS path.
   * Ensures that paths cannot escape the base directory (path traversal protection).
   */
  private resolvePath(vaultPath: string): string {
    if (path.posix.isAbsolute(vaultPath) || path.win32.isAbsolute(vaultPath)) {
      throw new VaultPermissionDeniedError(vaultPath);
    }

    // Join with base path
    const absolutePath = path.resolve(this.basePath, vaultPath);
    
    // Security check: ensure the resolved path is still inside the basePath
    const base = path.resolve(this.basePath);
    if (!absolutePath.startsWith(base + path.sep) && absolutePath !== base) {
      throw new VaultPermissionDeniedError(vaultPath);
    }
    
    return absolutePath;
  }

  /**
   * Helper to convert an absolute OS path back to a vault-relative path (using posix separators).
   */
  private toVaultPath(absolutePath: string): string {
    const relative = path.relative(this.basePath, absolutePath);
    // Always return posix-style paths for the vault abstraction
    return relative.split(path.sep).join(path.posix.sep);
  }

  private handleError(error: any, vaultPath: string): never {
    if (error.code === "ENOENT") {
      throw new VaultFileNotFoundError(vaultPath);
    }
    if (error.code === "EACCES" || error.code === "EPERM") {
      throw new VaultPermissionDeniedError(vaultPath);
    }
    if (error.code === "EEXIST") {
      throw new VaultFileExistsError(vaultPath);
    }
    throw new VaultError(`Unknown error accessing ${vaultPath}: ${error.message}`, "UNKNOWN");
  }

  async initialize(): Promise<void> {
    try {
      await fs.access(this.basePath);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        await fs.mkdir(this.basePath, { recursive: true });
      } else {
        throw new VaultError(`Cannot access base path: ${this.basePath}`, "INIT_FAILED");
      }
    }
  }

  async dispose(): Promise<void> {
    // Nothing to dispose for simple fs operations
  }

  async readTextFile(vaultPath: string): Promise<string> {
    return this.stored(vaultPath, async (raw) => {
      const absolutePath = this.resolvePath(raw);
      try {
        return await fs.readFile(absolutePath, "utf-8");
      } catch (err) {
        return this.handleError(err, vaultPath);
      }
    });
  }

  async readBinaryFile(vaultPath: string): Promise<Uint8Array> {
    return this.stored(vaultPath, async (raw) => {
      const absolutePath = this.resolvePath(raw);
      try {
        const buffer = await fs.readFile(absolutePath);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      } catch (err) {
        return this.handleError(err, vaultPath);
      }
    });
  }

  async writeTextFile(vaultPath: string, content: string): Promise<void> {
    const absolutePath = this.resolvePath(await this.realPath(vaultPath));
    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, "utf-8");
    } catch (err) {
      this.handleError(err, vaultPath);
    }
  }

  async writeBinaryFile(vaultPath: string, content: Uint8Array): Promise<void> {
    const absolutePath = this.resolvePath(await this.realPath(vaultPath));
    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content);
    } catch (err) {
      this.handleError(err, vaultPath);
    }
  }

  async deleteItem(vaultPath: string, recursive: boolean = false): Promise<void> {
    const absolutePath = this.resolvePath(await this.realPath(vaultPath));
    this.spellings.forget(vaultPath);
    try {
      const stats = await fs.stat(absolutePath);
      if (stats.isDirectory()) {
        await fs.rm(absolutePath, { recursive, force: true });
      } else {
        await fs.unlink(absolutePath);
      }
    } catch (err) {
      // Idempotent: a target that is already gone is a successful delete
      // ("not found = success"), matching the remote sync targets. This keeps
      // deletes of externally/remotely removed items from surfacing an error.
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
      this.handleError(err, vaultPath);
    }
  }

  async renameItem(oldVaultPath: string, newVaultPath: string): Promise<void> {
    const absoluteOld = this.resolvePath(await this.realPath(oldVaultPath));
    const absoluteNew = this.resolvePath(await this.realPath(newVaultPath));
    this.spellings.forget(oldVaultPath);
    this.spellings.forget(newVaultPath);
    
    try {
      // Create parent directories for the target if they don't exist
      await fs.mkdir(path.dirname(absoluteNew), { recursive: true });
      
      // Node's rename overwrites by default. We should check if the new file exists if we want to throw VaultFileExistsError
      // Or we can let it overwrite. Usually, file systems overwrite on rename.
      // For safety, let's check existence first, unless they are the same case-insensitive path (Windows renaming 'a' to 'A')
      if (absoluteOld.toLowerCase() !== absoluteNew.toLowerCase()) {
        try {
           await fs.access(absoluteNew);
           throw new VaultFileExistsError(newVaultPath);
        } catch (e: any) {
           if (e instanceof VaultFileExistsError) throw e;
           // If ENOENT, we are good to rename
        }
      }

      await fs.rename(absoluteOld, absoluteNew);
    } catch (err) {
      if (err instanceof VaultFileExistsError) throw err;
      this.handleError(err, oldVaultPath);
    }
  }

  async exists(vaultPath: string): Promise<boolean> {
    const absolutePath = this.resolvePath(await this.realPath(vaultPath));
    try {
      await fs.access(absolutePath);
      return true;
    } catch (error: any) {
      if (error.code === "ENOENT") return false;
      return this.handleError(error, vaultPath);
    }
  }

  async getFileInfo(vaultPath: string): Promise<VaultFileInfo> {
    const raw = await this.realPath(vaultPath);
    const absolutePath = this.resolvePath(raw);
    try {
      const stats = await fs.stat(absolutePath);
      const identity = this.spellings.identityOfStored(raw);
      return {
        path: identity,
        name: identity.slice(identity.lastIndexOf("/") + 1),
        isDirectory: stats.isDirectory(),
        size: stats.isDirectory() ? 0 : stats.size,
        mtime: stats.mtimeMs,
        ctime: stats.birthtimeMs || undefined,
      };
    } catch (err) {
      return this.handleError(err, vaultPath);
    }
  }

  async listDir(vaultPath: string = "", recursive: boolean = false): Promise<VaultFileInfo[]> {
    const raw = vaultPath ? await this.realPath(vaultPath) : "";
    const found = await this.listDirStored(raw, recursive, vaultPath);
    return this.identities(found, { raw, identity: raw ? this.spellings.identityOfStored(raw) : "" });
  }

  private async listDirStored(rawPath: string, recursive: boolean, vaultPath: string): Promise<VaultFileInfo[]> {
    const absolutePath = this.resolvePath(rawPath);
    const results: VaultFileInfo[] = [];

    async function walk(currentAbsPath: string, adapter: LocalVaultAdapter) {
      let entries;
      try {
        entries = await fs.readdir(currentAbsPath, { withFileTypes: true });
      } catch (err) {
        adapter.handleError(err, adapter.toVaultPath(currentAbsPath));
        return; // Will not be reached because handleError throws
      }

      for (const entry of entries) {
        const entryAbsPath = path.join(currentAbsPath, entry.name);
        const entryVaultPath = adapter.toVaultPath(entryAbsPath);
        
        try {
            const stats = await fs.stat(entryAbsPath);
            results.push({
                path: entryVaultPath,
                name: entry.name,
                isDirectory: stats.isDirectory(),
                size: stats.isDirectory() ? 0 : stats.size,
                mtime: stats.mtimeMs,
                ctime: stats.birthtimeMs || undefined,
            });

            if (stats.isDirectory() && recursive) {
                await walk(entryAbsPath, adapter);
            }
        } catch {
            // Ignore files that were deleted during walking
        }
      }
    }

    try {
        const stats = await fs.stat(absolutePath);
        if (!stats.isDirectory()) {
             throw new Error("Not a directory");
        }
    } catch (err) {
        this.handleError(err, vaultPath);
    }

    await walk(absolutePath, this);
    return results;
  }

  async listDirForBackup(excludeDirNames: readonly string[]): Promise<VaultFileInfo[]> {
    return this.identities(await this.listDirForBackupStored(excludeDirNames), { raw: "", identity: "" });
  }

  private async listDirForBackupStored(excludeDirNames: readonly string[]): Promise<VaultFileInfo[]> {
    const result: VaultFileInfo[] = [];
    const walk = async (directory: string): Promise<void> => {
      const absolute = this.resolvePath(directory);
      try {
        const entries = await fs.readdir(absolute, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory() && excludeDirNames.includes(entry.name)) continue;
          const rel = directory ? directory + "/" + entry.name : entry.name;
          // Stored spelling here; the caller turns the whole inventory into identities.
          const info: VaultFileInfo = { ...(await this.getFileInfo(rel)), path: rel, name: entry.name };
          result.push(info);
          if (info.isDirectory) await walk(rel);
        }
      } catch (error) {
        this.handleError(error, directory);
      }
    };
    await walk("");
    return result;
  }

  async createDir(vaultPath: string): Promise<void> {
    const absolutePath = this.resolvePath(await this.realPath(vaultPath));
    try {
      await fs.mkdir(absolutePath, { recursive: true });
    } catch (err) {
      this.handleError(err, vaultPath);
    }
  }

  async watch(callback: (events: import("./IVaultAdapter.js").WatchEvent[]) => void): Promise<() => void> {
    // Note: Node's native fs.watch has caveats with recursive on some platforms.
    // For a robust implementation in node, chokidar is usually used, but we use native for now.
    const abortController = new AbortController();
    try {
      const watcher = (await import("node:fs")).promises.watch(this.basePath, { recursive: true, signal: abortController.signal });
      
      // We consume the async iterator without awaiting it so we don't block
      (async () => {
        try {
          for await (const event of watcher) {
            if (event.filename) {
              const stored = event.filename.split(path.sep).join(path.posix.sep);
              const vaultPath = this.spellings.identityOfStored(stored);
              // Whatever changed there, a remembered spelling may be stale now.
              this.spellings.forget(vaultPath);
              callback([{ path: vaultPath, type: "any" }]);
            }
          }
        } catch (err: any) {
          if (err.name !== "AbortError") {
            console.error("LocalVaultAdapter watch error:", err);
          }
        }
      })();

      return () => abortController.abort();
    } catch (err) {
      console.warn("watch() failed to start:", err);
      return () => {};
    }
  }
}
