import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import {
  VaultFileExistsError,
  VaultFileNotFoundError,
  type IVaultAdapter,
  type VaultFileInfo,
  trimChars,
  PathSpellings,
  withStoredSpelling,
  type SpellingSource,
} from "@plainva/core";
import { atomicWriteBase64, atomicWriteText } from "../platform/atomicFile";
import { isExistingDirectory, isMissingFile } from "./fileErrors";

/**
 * IVaultAdapter over the Capacitor filesystem (M2, sync-first model): the
 * vault lives in the app sandbox under Directory.Data/vault. On the web
 * (dev server) the plugin transparently backs this with IndexedDB, so the
 * same adapter works in the browser. watch() is intentionally absent —
 * nothing else edits the sandbox (ADR 0011 / mobile plan).
 */

const norm = (path: string): string => trimChars(path.replace(/\\/g, "/"), "/");
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export class CapacitorVaultAdapter implements IVaultAdapter {
  /** Sandbox root under Directory.Data; per-vault since the isolation rework. */
  constructor(private readonly root: string = "vault") {}

  /**
   * Path identity vs. stored spelling (ADR 0016): the app names every file by
   * its NFC identity; iOS stores accents decomposed, and a folder synced down
   * from a server keeps the server's form. Resolved before every plugin call,
   * never renamed. Paths without accents never pay for it.
   */
  private readonly spellings = new PathSpellings();
  private readonly spellingSource: SpellingSource = {
    exists: async (raw) => (await this.statStored(raw)) !== null,
    listNames: async (raw) => {
      try {
        const res = await Filesystem.readdir({ path: this.full(raw), directory: Directory.Data });
        return res.files.map((f) => f.name).filter((n): n is string => !!n);
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },
  };

  /** The spelling `path` is stored under in the sandbox (ADR 0016). */
  async realPath(path: string): Promise<string> {
    return this.spellings.resolve(norm(path), this.spellingSource);
  }

  private stored<T>(path: string, io: (raw: string) => Promise<T>): Promise<T> {
    return withStoredSpelling(this.spellings, norm(path), this.spellingSource, io);
  }

  /** Sandbox folder of this vault, relative to Directory.Data. The streaming
   *  uploader needs it to name a file the native side can open itself. */
  get sandboxRoot(): string {
    return this.root;
  }

  private full(path: string): string {
    const p = norm(path);
    return p ? `${this.root}/${p}` : this.root;
  }

  async initialize(): Promise<void> {
    try {
      await Filesystem.mkdir({ path: this.root, directory: Directory.Data, recursive: true });
    } catch (error) {
      if (!isExistingDirectory(error)) throw error;
    }
  }

  async dispose(): Promise<void> {}

  async readTextFile(path: string): Promise<string> {
    return this.stored(path, async (raw) => {
      try {
        const res = await Filesystem.readFile({
          path: this.full(raw),
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        return res.data as string;
      } catch (error) {
        if (isMissingFile(error)) throw new VaultFileNotFoundError(path);
        throw error;
      }
    });
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    return this.stored(path, async (raw) => {
      try {
        const res = await Filesystem.readFile({ path: this.full(raw), directory: Directory.Data });
        if (res.data instanceof Blob) return new Uint8Array(await res.data.arrayBuffer());
        return b64ToBytes(res.data as string);
      } catch (error) {
        if (isMissingFile(error)) throw new VaultFileNotFoundError(path);
        throw error;
      }
    });
  }

  // Writes share the atomic adapter contract with the desktop (hardening
  // P2): exclusive temp in the target folder → fsync → rename. A process
  // kill or full storage can no longer leave a torn or zero-byte note.
  async writeTextFile(path: string, content: string): Promise<void> {
    await atomicWriteText(this.full(await this.realPath(path)), content);
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await atomicWriteBase64(this.full(await this.realPath(path)), bytesToB64(content));
  }

  async deleteItem(path: string, recursive?: boolean): Promise<void> {
    const raw = await this.realPath(path);
    this.spellings.forget(norm(path));
    const info = await this.statStored(raw);
    if (!info) throw new VaultFileNotFoundError(path);
    if (info.isDirectory) {
      await Filesystem.rmdir({
        path: this.full(raw),
        directory: Directory.Data,
        recursive: recursive ?? false,
      });
    } else {
      await Filesystem.deleteFile({ path: this.full(raw), directory: Directory.Data });
    }
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    const oldRaw = await this.realPath(oldPath);
    const newRaw = await this.realPath(newPath);
    if (!(await this.statStored(oldRaw))) throw new VaultFileNotFoundError(oldPath);
    if (await this.statStored(newRaw)) throw new VaultFileExistsError(newPath);
    this.spellings.forget(norm(oldPath));
    this.spellings.forget(norm(newPath));
    await Filesystem.rename({
      from: this.full(oldRaw),
      to: this.full(newRaw),
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });
  }

  async exists(path: string): Promise<boolean> {
    return (await this.statStored(await this.realPath(path))) !== null;
  }

  async getFileInfo(path: string): Promise<VaultFileInfo> {
    const info = await this.statStored(await this.realPath(path));
    if (!info) throw new VaultFileNotFoundError(path);
    const identity = this.spellings.identityOfStored(info.path);
    return identity === info.path ? info : { ...info, path: identity, name: identity.split("/").pop() ?? identity };
  }

  async listDir(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultFileInfo[]> {
    const raw = await this.realPath(path ?? "");
    const out: VaultFileInfo[] = [];
    await this.walk(raw, recursive ?? false, out, false, [], 0, options?.signal);
    return this.identities(out, raw);
  }

  async listDirForBackup(excludeDirNames: readonly string[]): Promise<VaultFileInfo[]> {
    const out: VaultFileInfo[] = [];
    await this.walk("", true, out, true, excludeDirNames);
    return this.identities(out, "");
  }

  async listDirReport(path = "", recursive = false, options?: { signal?: AbortSignal }) {
    const raw = await this.realPath(path);
    const files: VaultFileInfo[] = [];
    await this.walk(raw, recursive, files, true, [], 0, options?.signal);
    return { files: this.identities(files, raw), skipped: [] };
  }

  /** A walk's stored spellings as identities, below the folder stored as `raw`. */
  private identities(entries: VaultFileInfo[], raw: string): VaultFileInfo[] {
    const anchor = { raw, identity: raw ? this.spellings.identityOfStored(raw) : "" };
    const ids = this.spellings.observe(entries.map((e) => e.path), anchor);
    return entries.map((e) => {
      const id = ids.get(e.path);
      return id === undefined || id === e.path ? e : { ...e, path: id, name: id.split("/").pop() ?? id };
    });
  }

  async createDir(path: string): Promise<void> {
    try {
      await Filesystem.mkdir({ path: this.full(await this.realPath(path)), directory: Directory.Data, recursive: true });
    } catch (error) {
      if (!isExistingDirectory(error)) throw error;
    }
  }

  /** stat() of a path given in its stored spelling. */
  private async statStored(path: string): Promise<VaultFileInfo | null> {
    try {
      const st = await Filesystem.stat({ path: this.full(path), directory: Directory.Data });
      const rel = norm(path);
      return {
        path: rel,
        name: rel.split("/").pop() ?? rel,
        isDirectory: st.type === "directory",
        size: st.size,
        mtime: st.mtime,
        ctime: st.ctime ?? undefined,
      };
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  private async walk(rel: string, recursive: boolean, out: VaultFileInfo[], includeHidden = false, excludeDirNames: readonly string[] = [], depth = 0, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (includeHidden && depth > 256) throw new Error("Backup directory depth exceeded at " + rel);
    const res = await Filesystem.readdir({ path: this.full(rel), directory: Directory.Data });
    signal?.throwIfAborted();
    for (const f of res.files) {
      signal?.throwIfAborted();
      // Desktop parity: dot-prefixed children (.plainva internals, atomic
      // .plainva-tmp-* leftovers after a hard kill) never reach tree/index.
      // Direct listDir(".plainva/…") calls still work — only CHILD names of
      // a walked folder are filtered, not the entry path itself.
      if (!f.name) { if (includeHidden) throw new Error("Invalid backup entry at " + rel); continue; }
      if (!includeHidden && f.name.startsWith(".")) continue;
      if (f.type === "directory" && excludeDirNames.includes(f.name)) continue;
      if (includeHidden && f.type !== "directory" && f.type !== "file") throw new Error("Unknown backup entry type at " + rel + "/" + f.name);
      const childRel = rel ? `${rel}/${f.name}` : f.name;
      const isDir = f.type === "directory";
      out.push({
        path: childRel,
        name: f.name,
        isDirectory: isDir,
        size: f.size,
        mtime: f.mtime,
        ctime: f.ctime ?? undefined,
      });
      if (isDir && recursive) await this.walk(childRel, true, out, includeHidden, excludeDirNames, depth + 1, signal);
    }
  }
}
