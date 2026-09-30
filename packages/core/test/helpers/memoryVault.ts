import { posix } from "node:path";
import {
  VaultError,
  VaultFileExistsError,
  VaultFileNotFoundError,
  VaultPermissionDeniedError,
  type IVaultAdapter,
  type VaultFileInfo,
} from "../../src/vault/IVaultAdapter.js";
import { trimEndChars } from "../../src/textScan.js";

/**
 * A vault held in memory that answers like LocalVaultAdapter does on disk:
 * the same paths, errors, parent folders and listings (memory-vault.test.ts
 * runs one script against both and compares the answers).
 *
 * For tests whose subject is what a vault CONTAINS — a template's notes, an
 * index, a database's numbers — not how a disk stores it. On a loaded Windows
 * machine every real file costs milliseconds of scanning and locking, and a
 * test that writes and reads a whole tour vault per language spent its time
 * there (Befunde 2026-09-24, Z2).
 *
 * Every write moves the clock forward by one millisecond, so a rewrite always
 * changes `mtime` — the indexer re-reads a file by exactly that.
 */
export class MemoryVaultAdapter implements IVaultAdapter {
  private readonly files = new Map<string, { data: Uint8Array; mtime: number; ctime: number }>();
  private readonly dirs = new Map<string, { mtime: number; ctime: number }>([["", { mtime: 0, ctime: 0 }]]);
  private clock: number;

  constructor(start: number = Date.now()) {
    this.clock = start;
  }

  private tick(): number {
    this.clock += 1;
    return this.clock;
  }

  /** The vault-relative, normalised path; refuses what LocalVaultAdapter refuses. */
  private key(vaultPath: string): string {
    if (posix.isAbsolute(vaultPath) || /^[a-zA-Z]:[\\/]/.test(vaultPath) || vaultPath.startsWith("\\")) {
      throw new VaultPermissionDeniedError(vaultPath);
    }
    const normal = posix.normalize(vaultPath.replace(/\\/g, "/"));
    if (normal === ".." || normal.startsWith("../")) throw new VaultPermissionDeniedError(vaultPath);
    return normal === "." ? "" : trimEndChars(normal, "/");
  }

  private parentOf(key: string): string {
    const at = key.lastIndexOf("/");
    return at < 0 ? "" : key.slice(0, at);
  }

  /** mkdir -p, failing like the disk when a file sits where a folder should. */
  private makeDirs(key: string, shown: string): void {
    if (key === "" || this.dirs.has(key)) return;
    if (this.files.has(key)) throw new VaultFileExistsError(shown);
    this.makeDirs(this.parentOf(key), shown);
    const now = this.tick();
    this.dirs.set(key, { mtime: now, ctime: now });
  }

  private write(vaultPath: string, data: Uint8Array): void {
    const key = this.key(vaultPath);
    if (this.dirs.has(key)) throw new VaultError(`Unknown error accessing ${vaultPath}: EISDIR`, "UNKNOWN");
    const parent = this.parentOf(key);
    if (this.files.has(parent)) throw new VaultError(`Unknown error accessing ${vaultPath}: ENOTDIR`, "UNKNOWN");
    this.makeDirs(parent, vaultPath);
    const now = this.tick();
    this.files.set(key, { data, mtime: now, ctime: this.files.get(key)?.ctime ?? now });
  }

  private read(vaultPath: string): Uint8Array {
    const key = this.key(vaultPath);
    const file = this.files.get(key);
    if (file) return file.data;
    if (this.dirs.has(key)) throw new VaultError(`Unknown error accessing ${vaultPath}: EISDIR`, "UNKNOWN");
    throw new VaultFileNotFoundError(vaultPath);
  }

  private info(key: string, shown: string): VaultFileInfo {
    const file = this.files.get(key);
    if (file) return { path: shown, name: posix.basename(key), isDirectory: false, size: file.data.byteLength, mtime: file.mtime, ctime: file.ctime };
    const dir = this.dirs.get(key);
    if (dir) return { path: shown, name: posix.basename(key), isDirectory: true, size: 0, mtime: dir.mtime, ctime: dir.ctime || undefined };
    throw new VaultFileNotFoundError(shown);
  }

  /** Direct children of a folder, in name order. */
  private children(key: string): string[] {
    const prefix = key === "" ? "" : `${key}/`;
    const names = new Set<string>();
    for (const map of [this.files, this.dirs]) {
      for (const path of map.keys()) {
        if (path === key || !path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (rest && !rest.includes("/")) names.add(rest);
      }
    }
    return [...names].sort().map((name) => prefix + name);
  }

  async initialize(): Promise<void> {}
  async dispose(): Promise<void> {}

  async readTextFile(vaultPath: string): Promise<string> {
    return new TextDecoder().decode(this.read(vaultPath));
  }

  async readBinaryFile(vaultPath: string): Promise<Uint8Array> {
    return this.read(vaultPath).slice();
  }

  async writeTextFile(vaultPath: string, content: string): Promise<void> {
    this.write(vaultPath, new TextEncoder().encode(content));
  }

  async writeBinaryFile(vaultPath: string, content: Uint8Array): Promise<void> {
    this.write(vaultPath, content.slice());
  }

  async deleteItem(vaultPath: string, recursive: boolean = false): Promise<void> {
    const key = this.key(vaultPath);
    if (this.files.delete(key)) return;
    if (!this.dirs.has(key)) return; // already gone is a successful delete
    if (!recursive) throw new VaultError(`Unknown error accessing ${vaultPath}: EISDIR`, "UNKNOWN");
    const prefix = `${key}/`;
    for (const map of [this.files, this.dirs]) {
      for (const path of [...map.keys()]) if (path === key || path.startsWith(prefix) || key === "") map.delete(path);
    }
    if (key === "") this.dirs.set("", { mtime: 0, ctime: 0 });
  }

  async renameItem(oldVaultPath: string, newVaultPath: string): Promise<void> {
    const from = this.key(oldVaultPath);
    const to = this.key(newVaultPath);
    // The disk's order: the target's folders first, then the clash, then the move.
    this.makeDirs(this.parentOf(to), newVaultPath);
    if (from.toLowerCase() !== to.toLowerCase() && (this.files.has(to) || this.dirs.has(to))) throw new VaultFileExistsError(newVaultPath);
    if (!this.files.has(from) && !this.dirs.has(from)) throw new VaultFileNotFoundError(oldVaultPath);
    const prefix = `${from}/`;
    for (const map of [this.files, this.dirs] as Array<Map<string, unknown>>) {
      for (const [path, value] of [...map.entries()]) {
        if (path !== from && !path.startsWith(prefix)) continue;
        map.delete(path);
        map.set(to + path.slice(from.length), value);
      }
    }
  }

  async exists(vaultPath: string): Promise<boolean> {
    const key = this.key(vaultPath);
    return this.files.has(key) || this.dirs.has(key);
  }

  async getFileInfo(vaultPath: string): Promise<VaultFileInfo> {
    return this.info(this.key(vaultPath), vaultPath);
  }

  async listDir(vaultPath: string = "", recursive: boolean = false): Promise<VaultFileInfo[]> {
    const root = this.key(vaultPath);
    if (!this.dirs.has(root)) {
      if (this.files.has(root)) throw new VaultError(`Unknown error accessing ${vaultPath}: Not a directory`, "UNKNOWN");
      throw new VaultFileNotFoundError(vaultPath);
    }
    const out: VaultFileInfo[] = [];
    const walk = (key: string) => {
      for (const child of this.children(key)) {
        out.push(this.info(child, child));
        if (recursive && this.dirs.has(child)) walk(child);
      }
    };
    walk(root);
    return out;
  }

  async listDirForBackup(excludeDirNames: readonly string[]): Promise<VaultFileInfo[]> {
    const out: VaultFileInfo[] = [];
    const walk = (key: string) => {
      for (const child of this.children(key)) {
        const isDir = this.dirs.has(child);
        if (isDir && excludeDirNames.includes(posix.basename(child))) continue;
        out.push(this.info(child, child));
        if (isDir) walk(child);
      }
    };
    walk("");
    return out;
  }

  async createDir(vaultPath: string): Promise<void> {
    this.makeDirs(this.key(vaultPath), vaultPath);
  }
}
