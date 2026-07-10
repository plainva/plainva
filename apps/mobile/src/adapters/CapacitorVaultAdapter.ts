import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import {
  VaultFileExistsError,
  VaultFileNotFoundError,
  type IVaultAdapter,
  type VaultFileInfo,
} from "@plainva/core";

/**
 * IVaultAdapter over the Capacitor filesystem (M2, sync-first model): the
 * vault lives in the app sandbox under Directory.Data/vault. On the web
 * (dev server) the plugin transparently backs this with IndexedDB, so the
 * same adapter works in the browser. watch() is intentionally absent —
 * nothing else edits the sandbox (ADR 0011 / mobile plan).
 */

const ROOT = "vault";

const norm = (path: string): string => path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
const full = (path: string): string => {
  const p = norm(path);
  return p ? `${ROOT}/${p}` : ROOT;
};

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
  async initialize(): Promise<void> {
    try {
      await Filesystem.mkdir({ path: ROOT, directory: Directory.Data, recursive: true });
    } catch {
      /* already exists */
    }
  }

  async dispose(): Promise<void> {}

  async readTextFile(path: string): Promise<string> {
    try {
      const res = await Filesystem.readFile({
        path: full(path),
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return res.data as string;
    } catch {
      throw new VaultFileNotFoundError(path);
    }
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    try {
      const res = await Filesystem.readFile({ path: full(path), directory: Directory.Data });
      if (res.data instanceof Blob) return new Uint8Array(await res.data.arrayBuffer());
      return b64ToBytes(res.data as string);
    } catch {
      throw new VaultFileNotFoundError(path);
    }
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await Filesystem.writeFile({
      path: full(path),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      data: content,
      recursive: true,
    });
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await Filesystem.writeFile({
      path: full(path),
      directory: Directory.Data,
      data: bytesToB64(content),
      recursive: true,
    });
  }

  async deleteItem(path: string, recursive?: boolean): Promise<void> {
    const info = await this.statOrNull(path);
    if (!info) throw new VaultFileNotFoundError(path);
    if (info.isDirectory) {
      await Filesystem.rmdir({
        path: full(path),
        directory: Directory.Data,
        recursive: recursive ?? false,
      });
    } else {
      await Filesystem.deleteFile({ path: full(path), directory: Directory.Data });
    }
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    if (!(await this.exists(oldPath))) throw new VaultFileNotFoundError(oldPath);
    if (await this.exists(newPath)) throw new VaultFileExistsError(newPath);
    await Filesystem.rename({
      from: full(oldPath),
      to: full(newPath),
      directory: Directory.Data,
      toDirectory: Directory.Data,
    });
  }

  async exists(path: string): Promise<boolean> {
    return (await this.statOrNull(path)) !== null;
  }

  async getFileInfo(path: string): Promise<VaultFileInfo> {
    const info = await this.statOrNull(path);
    if (!info) throw new VaultFileNotFoundError(path);
    return info;
  }

  async listDir(path?: string, recursive?: boolean): Promise<VaultFileInfo[]> {
    const rel = norm(path ?? "");
    const out: VaultFileInfo[] = [];
    await this.walk(rel, recursive ?? false, out);
    return out;
  }

  async createDir(path: string): Promise<void> {
    try {
      await Filesystem.mkdir({ path: full(path), directory: Directory.Data, recursive: true });
    } catch {
      /* already exists */
    }
  }

  private async statOrNull(path: string): Promise<VaultFileInfo | null> {
    try {
      const st = await Filesystem.stat({ path: full(path), directory: Directory.Data });
      const rel = norm(path);
      return {
        path: rel,
        name: rel.split("/").pop() ?? rel,
        isDirectory: st.type === "directory",
        size: st.size,
        mtime: st.mtime,
        ctime: st.ctime ?? undefined,
      };
    } catch {
      return null;
    }
  }

  private async walk(rel: string, recursive: boolean, out: VaultFileInfo[]): Promise<void> {
    const res = await Filesystem.readdir({ path: full(rel), directory: Directory.Data });
    for (const f of res.files) {
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
      if (isDir && recursive) await this.walk(childRel, true, out);
    }
  }
}
