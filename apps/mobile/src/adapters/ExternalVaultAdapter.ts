import { VaultFileExistsError, VaultFileNotFoundError, type IVaultAdapter, type VaultFileInfo } from "@plainva/core";
import type { VaultFolderAccess, VaultFolderEntry, VaultFolderNative } from "../platform/vaultFolder";

/**
 * IVaultAdapter over a folder the user picked on the device (external vault
 * folder plan, P4) — the second adapter beside the sandbox one. Everything
 * goes through the VaultFolder plugin by handle; this class only speaks
 * vault-relative paths and the shared adapter errors.
 *
 * What is deliberately the same as the container adapter: dot-prefixed
 * children never reach the tree or the index (`.plainva`, `.obsidian`, the
 * other app's `.stfolder`), writes replace atomically where the platform can
 * (iOS `.atomic`; SAF has no rename-over, the native side writes through the
 * document's own output stream), and a missing file is the shared
 * `VaultFileNotFoundError`, so the queueing and conflict chains above behave
 * exactly as they do over the sandbox.
 *
 * What is different, and is the whole point: nothing here assumes Plainva is
 * the only writer. `watch()` stays absent on purpose (neither platform gives a
 * reliable watcher for a foreign folder); P5 answers with a rescan on resume
 * and a timestamp check on open.
 */
const norm = (path: string): string => path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function utf8ToB64(text: string): string {
  return bytesToB64(new TextEncoder().encode(text));
}

function b64ToUtf8(b64: string): string {
  return new TextDecoder().decode(b64ToBytes(b64));
}

function toInfo(rel: string, e: VaultFolderEntry): VaultFileInfo {
  return {
    path: rel,
    name: e.name,
    isDirectory: e.isDirectory,
    size: e.isDirectory ? 0 : e.size,
    mtime: e.mtime,
    ctime: e.ctime,
  };
}

export class ExternalVaultAdapter implements IVaultAdapter {
  private access: VaultFolderAccess | null = null;

  constructor(
    private readonly plugin: VaultFolderNative,
    readonly handle: string,
  ) {}

  /** No sandbox folder: the streaming uploader has nothing to open here (and no sync runs, E4). */
  get sandboxRoot(): undefined {
    return undefined;
  }

  /** The last answer of `resolve` — what the vault detail shows. */
  get accessState(): VaultFolderAccess | null {
    return this.access;
  }

  async initialize(): Promise<void> {
    this.access = await this.plugin.resolve({ handle: this.handle });
  }

  /** Re-asks the platform; a grant can go away while the app runs. */
  async refreshAccess(): Promise<VaultFolderAccess> {
    this.access = await this.plugin.resolve({ handle: this.handle });
    return this.access;
  }

  async dispose(): Promise<void> {
    await this.plugin.release({ handle: this.handle }).catch(() => {});
  }

  async readTextFile(path: string): Promise<string> {
    const rel = norm(path);
    try {
      const res = await this.plugin.read({ handle: this.handle, path: rel });
      return b64ToUtf8(res.dataBase64);
    } catch {
      throw new VaultFileNotFoundError(path);
    }
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const rel = norm(path);
    try {
      const res = await this.plugin.read({ handle: this.handle, path: rel });
      return b64ToBytes(res.dataBase64);
    } catch {
      throw new VaultFileNotFoundError(path);
    }
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await this.plugin.write({ handle: this.handle, path: norm(path), dataBase64: utf8ToB64(content) });
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await this.plugin.write({ handle: this.handle, path: norm(path), dataBase64: bytesToB64(content) });
  }

  async deleteItem(path: string, recursive?: boolean): Promise<void> {
    const rel = norm(path);
    const info = await this.statOrNull(rel);
    if (!info) throw new VaultFileNotFoundError(path);
    await this.plugin.delete({ handle: this.handle, path: rel, recursive: recursive ?? false });
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    const from = norm(oldPath);
    const to = norm(newPath);
    if (!(await this.exists(from))) throw new VaultFileNotFoundError(oldPath);
    if (await this.exists(to)) throw new VaultFileExistsError(newPath);
    await this.plugin.rename({ handle: this.handle, from, to });
  }

  async exists(path: string): Promise<boolean> {
    return (await this.statOrNull(norm(path))) !== null;
  }

  async getFileInfo(path: string): Promise<VaultFileInfo> {
    const info = await this.statOrNull(norm(path));
    if (!info) throw new VaultFileNotFoundError(path);
    return info;
  }

  async listDir(path?: string, recursive?: boolean): Promise<VaultFileInfo[]> {
    const out: VaultFileInfo[] = [];
    await this.walk(norm(path ?? ""), recursive ?? false, out);
    return out;
  }

  async createDir(path: string): Promise<void> {
    await this.plugin.mkdir({ handle: this.handle, path: norm(path) });
  }

  private async statOrNull(rel: string): Promise<VaultFileInfo | null> {
    try {
      const res = await this.plugin.stat({ handle: this.handle, path: rel });
      return res.entry ? toInfo(rel, res.entry) : null;
    } catch {
      return null;
    }
  }

  private async walk(rel: string, recursive: boolean, out: VaultFileInfo[]): Promise<void> {
    const res = await this.plugin.list({ handle: this.handle, path: rel });
    for (const e of res.entries) {
      // Desktop and container parity: dot-prefixed children stay out of the
      // tree and the index — here that also covers the OTHER app's markers
      // (`.stfolder`, `.obsidian`) that share the folder with us.
      if (!e.name || e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      out.push(toInfo(childRel, e));
      if (e.isDirectory && recursive) await this.walk(childRel, true, out);
    }
  }
}
