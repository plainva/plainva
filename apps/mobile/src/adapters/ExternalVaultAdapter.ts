import { textOfFileBytes, trimChars, PathSpellings, withStoredSpelling, type SpellingSource } from "@plainva/core";
import { VaultFileExistsError, VaultFileNotFoundError, type IVaultAdapter, type VaultFileInfo, type VaultListing, type VaultWalkOptions, type VaultWalkSkip } from "@plainva/core";
import type { VaultFolderAccess, VaultFolderEntry, VaultFolderNative } from "../platform/vaultFolder";
import { isMissingFile } from "./fileErrors";
import { withFolderDeadlines, type FolderDeadlineOptions } from "./folderAnswerDeadline";

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
 * first save wrote the file back without one (finding 2026-10-09). The desktop
 * reads through Rust, which keeps it. The container adapter decodes by the
 * same rule since 2026-10-20: it used to ask the system for the text, and iOS'
 * own decoder skips the mark (see `readTextFile` there).
 */
function b64ToUtf8(b64: string): string {
  return textOfFileBytes(b64ToBytes(b64));
}

/** Same cap as the desktop's walk (`MAX_WALK_DEPTH`, vault_walk.rs). */
const MAX_WALK_DEPTH = 32;

/** One walk over the picked folder. */
interface Walk {
  /** What could not be listed, by vault-relative path; null for the backup inventory, which must be whole or fail. */
  skipped: VaultWalkSkip[] | null;
  /** The identities of the folders this walk is in or has been in (iOS: device and inode); what a walk that follows links cuts by. */
  seen: Set<string>;
  /**
   * Whether an entry reached through a link counts (iOS marks it). The walk of
   * the vault follows links, as the desktop's does; the backup inventory
   * leaves them out, as the desktop's backup does — what lies behind a link is
   * not the vault's to pack, and a link inside the vault would pack its folder
   * twice —, and so does the snapshot before a recursive delete, which
   * removes the link and not what it points at.
   */
  followLinks: boolean;
  includeHidden: boolean;
  excludeDirNames: readonly string[];
  signal?: AbortSignal;
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

  /** A walk's stored spellings as identities, below the folder stored as `raw` — its skip list too. */
  private identities(entries: VaultFileInfo[], raw: string, skipped: VaultWalkSkip[] = []): { files: VaultFileInfo[]; skipped: VaultWalkSkip[] } {
    const anchor = { raw, identity: raw ? this.spellings.identityOfStored(raw) : "" };
    const ids = this.spellings.observe([...entries.map((e) => e.path), ...skipped.map((s) => s.path)], anchor);
    const files = entries.map((e) => {
      const id = ids.get(e.path);
      return id === undefined || id === e.path ? e : { ...e, path: id, name: id.split("/").pop() ?? id };
    });
    return { files, skipped: skipped.map((s) => ({ ...s, path: ids.get(s.path) ?? s.path })) };
  }

  private readonly plugin: VaultFolderNative;

  /**
   * Every call that only looks gets a deadline (issue 143,
   * `folderAnswerDeadline.ts`): a provider that stops answering makes a read
   * or a listing fail with a reason that names the path — and the scan goes on.
   */
  constructor(
    plugin: VaultFolderNative,
    readonly handle: string,
    deadlines: FolderDeadlineOptions = {},
  ) {
    this.plugin = withFolderDeadlines(plugin, deadlines);
  }

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
    return (await this.listDirReport(path, recursive, options)).files;
  }

  /**
   * The listing with what it left out, as the desktop's (issue 125): a link
   * that points nowhere, a folder below that could not be listed, a link back
   * into a folder the walk is already in. The index keeps what lies under a
   * named path instead of taking it for deleted.
   */
  async listDirReport(path?: string, recursive?: boolean, options?: VaultWalkOptions): Promise<VaultListing> {
    const raw = await this.realPath(path ?? "");
    const out: VaultFileInfo[] = [];
    const skipped: VaultWalkSkip[] = [];
    // Without links on request: the snapshot before a recursive delete, which
    // removes the links and not what they point at. Dot-named entries this
    // walk never lists (`dotEntries` has nothing to leave out here).
    const followLinks = options?.followLinks ?? true;
    // A folder that is itself a link holds nothing of its own: what it lists
    // lies where it points, and a delete takes the link alone.
    if (!followLinks && raw) {
      const own = await this.plugin.stat({ handle: this.handle, path: raw }).catch(() => null);
      if (own?.entry?.link && own.entry.isDirectory) return { files: [], skipped: [] };
    }
    await this.walk(raw, recursive ?? false, out, { skipped, seen: new Set(), followLinks, includeHidden: false, excludeDirNames: [], signal: options?.signal });
    return this.identities(out, raw, skipped);
  }

  async listDirForBackup(excludeDirNames: readonly string[]): Promise<VaultFileInfo[]> {
    const out: VaultFileInfo[] = [];
    await this.walk("", true, out, { skipped: null, seen: new Set(), followLinks: false, includeHidden: true, excludeDirNames });
    return this.identities(out, "").files;
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

  private async walk(rel: string, recursive: boolean, out: VaultFileInfo[], walk: Walk, depth = 0, identity?: string): Promise<void> {
    const { signal } = walk;
    signal?.throwIfAborted();
    // A walk that follows no link cannot come back to where it was: it goes
    // as deep as the folder does — the backup packs all of it, a recursive
    // delete removes all of it —, bounded only against a broken file system.
    if (!walk.followLinks && depth > 256) throw new Error((walk.skipped === null ? "Backup directory" : "Directory") + " depth exceeded at " + rel);
    // A folder this walk is already in, reached again through a link, is cut
    // where it is met — and so is a chain deeper than any vault, where the
    // platform names no identity (issue 125, the desktop's rules).
    if (walk.followLinks && identity !== undefined && walk.seen.has(identity)) {
      walk.skipped?.push({ path: rel, reason: "cycle" });
      return;
    }
    if (walk.followLinks && depth > MAX_WALK_DEPTH) {
      walk.skipped?.push({ path: rel, reason: "cycle" });
      return;
    }
    if (identity !== undefined) walk.seen.add(identity);
    let res: Awaited<ReturnType<VaultFolderNative["list"]>>;
    try {
      res = await this.plugin.list({ handle: this.handle, path: rel });
    } catch (error) {
      // A folder below the one asked for that cannot be listed is named, and
      // the walk goes on: "could not look" is never "is empty" — the index
      // keeps what lies under a named path. The folder asked for itself, and
      // every folder of the backup inventory, still fails the call.
      if (depth === 0 || walk.skipped === null || signal?.aborted) throw error;
      walk.skipped.push({ path: rel, reason: "unreadable" });
      return;
    }
    signal?.throwIfAborted();
    if (depth === 0 && res.identity) walk.seen.add(res.identity);
    for (const s of res.skipped ?? []) {
      if (!s.name || (!walk.includeHidden && s.name.startsWith("."))) continue;
      const at = rel ? `${rel}/${s.name}` : s.name;
      // A link that points nowhere and an entry that is neither file nor
      // folder hold nothing to pack or to keep: a walk that leaves links out
      // passes them by, as the desktop's backup does.
      if (!walk.followLinks && (s.kind === "link" || s.kind === "special")) continue;
      if (walk.skipped) {
        walk.skipped.push({ path: at, reason: "unreadable" });
        continue;
      }
      // The backup inventory is whole or fails.
      throw new Error(`Cannot back up ${at}: the folder lists it, but it cannot be read`);
    }
    for (const e of res.entries) {
      signal?.throwIfAborted();
      // Desktop and container parity: dot-prefixed children stay out of the
      // tree and the index — here that also covers the OTHER app's markers
      // (`.stfolder`, `.obsidian`) that share the folder with us.
      if (!e.name) { if (walk.includeHidden) throw new Error("Invalid backup entry at " + rel); continue; }
      if (!walk.includeHidden && e.name.startsWith(".")) continue;
      if (e.isDirectory && walk.excludeDirNames.includes(e.name)) continue;
      if (e.link && !walk.followLinks) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      out.push(toInfo(childRel, e));
      if (e.isDirectory && recursive) await this.walk(childRel, true, out, walk, depth + 1, e.identity);
    }
  }
}
