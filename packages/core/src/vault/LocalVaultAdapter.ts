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

/**
 * A local file system implementation of IVaultAdapter.
 * Used for Desktop (Node.js/Tauri) environments.
 */
export class LocalVaultAdapter implements IVaultAdapter {
  /**
   * @param basePath The absolute path to the root of the vault.
   */
  constructor(private readonly basePath: string) {
    if (!path.isAbsolute(basePath)) {
      throw new Error("LocalVaultAdapter requires an absolute base path.");
    }
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
    const absolutePath = this.resolvePath(vaultPath);
    try {
      return await fs.readFile(absolutePath, "utf-8");
    } catch (err) {
      return this.handleError(err, vaultPath);
    }
  }

  async readBinaryFile(vaultPath: string): Promise<Uint8Array> {
    const absolutePath = this.resolvePath(vaultPath);
    try {
      const buffer = await fs.readFile(absolutePath);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch (err) {
      return this.handleError(err, vaultPath);
    }
  }

  async writeTextFile(vaultPath: string, content: string): Promise<void> {
    const absolutePath = this.resolvePath(vaultPath);
    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, "utf-8");
    } catch (err) {
      this.handleError(err, vaultPath);
    }
  }

  async writeBinaryFile(vaultPath: string, content: Uint8Array): Promise<void> {
    const absolutePath = this.resolvePath(vaultPath);
    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content);
    } catch (err) {
      this.handleError(err, vaultPath);
    }
  }

  async deleteItem(vaultPath: string, recursive: boolean = false): Promise<void> {
    const absolutePath = this.resolvePath(vaultPath);
    try {
      const stats = await fs.stat(absolutePath);
      if (stats.isDirectory()) {
        await fs.rm(absolutePath, { recursive, force: true });
      } else {
        await fs.unlink(absolutePath);
      }
    } catch (err) {
      this.handleError(err, vaultPath);
    }
  }

  async renameItem(oldVaultPath: string, newVaultPath: string): Promise<void> {
    const absoluteOld = this.resolvePath(oldVaultPath);
    const absoluteNew = this.resolvePath(newVaultPath);
    
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
    const absolutePath = this.resolvePath(vaultPath);
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  async getFileInfo(vaultPath: string): Promise<VaultFileInfo> {
    const absolutePath = this.resolvePath(vaultPath);
    try {
      const stats = await fs.stat(absolutePath);
      return {
        path: vaultPath,
        name: path.basename(absolutePath),
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
    const absolutePath = this.resolvePath(vaultPath);
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

  async createDir(vaultPath: string): Promise<void> {
    const absolutePath = this.resolvePath(vaultPath);
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
              const vaultPath = event.filename.split(path.sep).join(path.posix.sep);
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
