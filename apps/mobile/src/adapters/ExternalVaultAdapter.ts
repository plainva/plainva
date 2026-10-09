import { textOfFileBytes, trimChars, PathSpellings, withStoredSpelling, type SpellingSource } from "@plainva/core";
import { VaultFileExistsError, VaultFileNotFoundError, type IVaultAdapter, type VaultFileInfo } from "@plainva/core";
import type { VaultFolderAccess, VaultFolderEntry, VaultFolderNative } from "../platform/vaultFolder";
import { isMissingFile } from "./fileErrors";

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
// Identity in, stored spelling out (ADR 0016). This used to normalize every
// path to NFC on the way in (Build-91 feedback, P3): a link written "Anhänge"
// meets a folder the iOS Files app hands back decomposed. APFS looks both
// forms up as the same name — but a byte-exact folder (Android, SAF) does not,
// so a decomposed file there could not be opened at all. The spelling lookup
// finds the stored form on either.
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
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function utf8ToB64(text: string): string {
  return bytesToB64(new TextEncoder().encode(text));
}

/**
 * The file's text as every adapter hands it out — with its byte order mark as
 * the first character, where it has one (`textOfFileBytes`). A plain decoder
 * dropped it here: an editor saw a note or a `.csv` without its mark, and the
 * first save wrote the file back without one (finding 2026-10-09). The
 * container adapter and the desktop read through the platform, which keeps it.
 */
function b64ToUtf8(b64: string): string {
  return textOfFileBytes(b64ToBytes(b64));
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

  /** Path identity vs. stored spelling (ADR 0016). */
  private readonly spellings = new PathSpellings();
  private readonly spellingSource: SpellingSource = {
    exists: async (raw) => (await this.statOrNull(raw)) !== null,
    listNames: async (raw) => {
      try {
        const res = await this.plugin.list({ handle: this.handle, path: raw });
        return res.entries.map((e) => e.name).filter((n): n is string => !!n);
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },
  };

  /** The spelling `path` is stored under in the picked folder (ADR 0016). */
  async realPath(path: string): Promise<string> {
    return this.spellings.resolve(norm(path), this.spellingSource);
  }

  private stored<T>(path: string, io: (raw: string) => Promise<T>): Promise<T> {
    return withStoredSpelling(this.spellings, norm(path), this.spellingSource, io);
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
    return this.stored(path, async (rel) => {
      try {
        const res = await this.plugin.read({ handle: this.handle, path: rel });
        return b64ToUtf8(res.dataBase64);
      } catch (error) {
        if (isMissingFile(error)) throw new VaultFileNotFoundError(path);
        throw error;
      }
    });
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    return this.stored(path, async (rel) => {
      try {
        const res = await this.plugin.read({ handle: this.handle, path: rel });
        return b64ToBytes(res.dataBase64);
      } catch (error) {
        if (isMissingFile(error)) throw new VaultFileNotFoundError(path);
        throw error;
      }
    });
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await this.plugin.write({ handle: this.handle, path: await this.realPath(path), dataBase64: utf8ToB64(content) });
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await this.plugin.write({ handle: this.handle, path: await this.realPath(path), dataBase64: bytesToB64(content) });
  }

  async deleteItem(path: string, recursive?: boolean): Promise<void> {
    const rel = await this.realPath(path);
    this.spellings.forget(norm(path));
    const info = await this.statOrNull(rel);
    if (!info) throw new VaultFileNotFoundError(path);
    await this.plugin.delete({ handle: this.handle, path: rel, recursive: recursive ?? false });
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    const from = await this.realPath(oldPath);
    const to = await this.realPath(newPath);
    if (!(await this.statOrNull(from))) throw new VaultFileNotFoundError(oldPath);
    if (await this.statOrNull(to)) throw new VaultFileExistsError(newPath);
    this.spellings.forget(norm(oldPath));
    this.spellings.forget(norm(newPath));
    await this.plugin.rename({ handle: this.handle, from, to });
  }

  async exists(path: string): Promise<boolean> {
    return (await this.statOrNull(await this.realPath(path))) !== null;
  }

  async getFileInfo(path: string): Promise<VaultFileInfo> {
    const info = await this.statOrNull(await this.realPath(path));
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

  async createDir(path: string): Promise<void> {
    await this.plugin.mkdir({ handle: this.handle, path: await this.realPath(path) });
  }

  private async statOrNull(rel: string): Promise<VaultFileInfo | null> {
    try {
      const res = await this.plugin.stat({ handle: this.handle, path: rel });
      return res.entry ? toInfo(rel, res.entry) : null;
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  private async walk(rel: string, recursive: boolean, out: VaultFileInfo[], includeHidden = false, excludeDirNames: readonly string[] = [], depth = 0, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (includeHidden && depth > 256) throw new Error("Backup directory depth exceeded at " + rel);
    const res = await this.plugin.list({ handle: this.handle, path: rel });
    signal?.throwIfAborted();
    for (const e of res.entries) {
      signal?.throwIfAborted();
      // Desktop and container parity: dot-prefixed children stay out of the
      // tree and the index — here that also covers the OTHER app's markers
      // (`.stfolder`, `.obsidian`) that share the folder with us.
      if (!e.name) { if (includeHidden) throw new Error("Invalid backup entry at " + rel); continue; }
      if (!includeHidden && e.name.startsWith(".")) continue;
      if (e.isDirectory && excludeDirNames.includes(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      out.push(toInfo(childRel, e));
      if (e.isDirectory && recursive) await this.walk(childRel, true, out, includeHidden, excludeDirNames, depth + 1, signal);
    }
  }
}
