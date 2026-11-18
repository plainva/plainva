import { isInternalSegment, textOfFileBytes, trimChars, PathSpellings, withStoredSpelling, type SpellingSource } from "@plainva/core";
import { VaultFileExistsError, VaultFileNotFoundError, type IVaultAdapter, type VaultFileInfo, type VaultListing, type VaultWalkOptions, type VaultWalkSkip } from "@plainva/core";
import type { VaultFolderAccess, VaultFolderEntry, VaultFolderNative } from "../platform/vaultFolder";
import { isMissingFile } from "./fileErrors";
import { withFolderDeadlines, type FolderDeadlineOptions } from "./folderAnswerDeadline";
import { BRIDGE_PART_BYTES, withReadTurn } from "../platform/atomicFile";

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

/**
 * The file's text as every adapter hands it out — with its byte order mark as
 * the first character, where it has one (`textOfFileBytes`). A plain decoder
 * dropped it here: an editor saw a note or a `.csv` without its mark, and the
 * first save wrote the file back without one (finding 2026-10-09). The desktop
 * reads through Rust, which keeps it. The container adapter decodes by the
 * same rule since 2026-10-20: it used to ask the system for the text, and iOS'
 * own decoder skips the mark (see `readTextFile` there).
 */
function bytesToText(bytes: Uint8Array): string {
  return textOfFileBytes(bytes);
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
  /** The index's walk: dot-named entries that are not internal count (E8); the backup inventory has `includeHidden` instead. */
  includeDotEntries?: boolean;
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
    return bytesToText(await this.readBinaryFile(path));
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    return this.stored(path, async (rel) => {
      try {
        return await this.readBytes(rel);
      } catch (error) {
        if (isMissingFile(error)) throw new VaultFileNotFoundError(path);
        throw error;
      }
    });
  }

  /**
   * A file's bytes, never more than one part per message (release list F54):
   * every call's text is parsed on Android's UI thread, and a whole picture
   * or PDF in one answer froze the app as the ZIP backup did (F51). A file
   * that fits one part comes in one call; a larger one in parts from the one
   * version the native side took when it was opened. At most two such reads
   * at once, as over the sandbox (`withReadTurn`).
   */
  private async readBytes(rel: string): Promise<Uint8Array> {
    return withReadTurn("foreground", async () => {
      // One open of the file: a larger one goes on into the native side's copy, read below in parts.
      // A provider that fetches a file to open it (a cloud folder) fetches it once.
      const small = await this.plugin.read({ handle: this.handle, path: rel, maxBytes: BRIDGE_PART_BYTES });
      if (!small.tooLarge) return b64ToBytes(small.dataBase64);
      const { id, size } = small;
      try {
        const bytes = new Uint8Array(size);
        let filled = 0;
        while (filled < size) {
          const part = b64ToBytes((await this.plugin.readPart({ id, offset: filled, length: BRIDGE_PART_BYTES })).data);
          if (part.length === 0 || filled + part.length > size) throw new Error(`${rel} could not be read whole`);
          bytes.set(part, filled);
          filled += part.length;
        }
        return bytes;
      } finally {
        await this.plugin.closeRead({ id }).catch(() => {
          // silent: a read nobody closes is closed by the plugin after two minutes.
        });
      }
    });
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const bytes = new TextEncoder().encode(content);
    await this.inOrder([path], async () => this.writeBytes(await this.realPath(path), bytes));
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await this.inOrder([path], async () => this.writeBytes(await this.realPath(path), content));
  }

  /** What began to write, delete or rename and has not ended: the paths it works on, and its end. */
  private readonly running: Array<{ keys: string[]; done: Promise<void> }> = [];

  /**
   * Runs `run` after everything begun before it on `paths`, on a folder above
   * them or on anything below them - so the last begun is the one that stays,
   * as over the sandbox (`atomicFile.ts`), across folders too. A large file
   * goes in several calls; without this a smaller write begun after it reached
   * its end first and the older file's `commit` overwrote the newer one, and a
   * folder deleted or renamed while a file below it was still being written
   * came back at its old place with that file in it (the native commit makes
   * the folders it needs). Paths that are neither the same nor one inside the
   * other do not wait for each other.
   */
  private inOrder<T>(paths: string[], run: () => Promise<T>): Promise<T> {
    const keys = [...new Set(paths.map(norm))];
    const related = (a: string, b: string) => a === b || a === "" || b === "" || a.startsWith(b + "/") || b.startsWith(a + "/");
    const before = this.running.filter((op) => op.keys.some((k) => keys.some((key) => related(k, key))));
    const mine = Promise.all(before.map((op) => op.done)).then(run);
    const entry = { keys, done: mine.then(() => undefined, () => undefined) };
    this.running.push(entry);
    void entry.done.then(() => {
      const at = this.running.indexOf(entry);
      if (at >= 0) this.running.splice(at, 1);
    });
    return mine;
  }

  /**
   * Bytes over the file: in one message when they fit one part, otherwise in
   * parts the native side gathers before it touches the file - a write that
   * fails part way leaves the folder's file as it was.
   */
  private async writeBytes(rel: string, bytes: Uint8Array): Promise<void> {
    if (bytes.length <= BRIDGE_PART_BYTES) {
      await this.plugin.write({ handle: this.handle, path: rel, dataBase64: bytesToB64(bytes) });
      return;
    }
    const { id } = await this.plugin.begin({ handle: this.handle, path: rel });
    try {
      for (let offset = 0; offset < bytes.length; offset += BRIDGE_PART_BYTES) {
        await this.plugin.append({ id, data: bytesToB64(bytes.subarray(offset, offset + BRIDGE_PART_BYTES)) });
      }
      await this.plugin.commit({ id });
    } catch (error) {
      // silent: the write's own failure is rethrown; the gathered parts go with the abort.
      await this.plugin.abort({ id }).catch(() => {});
      throw error;
    }
  }

  /**
   * See `IVaultAdapter.removeEmptyDir`: the native delete without `recursive`
   * refuses a folder with any child (VaultFolderPlugin) — on iOS in the same
   * step as the removal (rmdir), on Android by asking the folder first: the
   * Storage Access Framework has no "delete only if empty", so a file another
   * app puts there in that moment goes with it (a limit, named).
   */
  async removeEmptyDir(path: string): Promise<boolean> {
    const rel = await this.realPath(path);
    const info = await this.statOrNull(rel);
    if (!info) return true;
    if (!info.isDirectory) return false;
    try {
      await this.plugin.delete({ handle: this.handle, path: rel, recursive: false });
    } catch (err) {
      // silent: a folder that holds something, or one the system will not remove, stays where it is — nothing is lost, and the sync weighs it again next cycle.
      console.warn(`[ExternalVaultAdapter] could not remove the empty folder ${path}`, err);
      return false;
    }
    this.spellings.forget(norm(path));
    return true;
  }

  async deleteItem(path: string, recursive?: boolean): Promise<void> {
    await this.inOrder([path], async () => {
      const rel = await this.realPath(path);
      this.spellings.forget(norm(path));
      const info = await this.statOrNull(rel);
      if (!info) throw new VaultFileNotFoundError(path);
      await this.plugin.delete({ handle: this.handle, path: rel, recursive: recursive ?? false });
    });
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    await this.inOrder([oldPath, newPath], async () => {
      const from = await this.realPath(oldPath);
      const to = await this.realPath(newPath);
      if (!(await this.statOrNull(from))) throw new VaultFileNotFoundError(oldPath);
      if (await this.statOrNull(to)) throw new VaultFileExistsError(newPath);
      this.spellings.forget(norm(oldPath));
      this.spellings.forget(norm(newPath));
      await this.plugin.rename({ handle: this.handle, from, to });
    });
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

  /** The folder as the tree shows it: no dot-named entry, no walk into such a folder. */
  async listDir(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultFileInfo[]> {
    return (await this.listDirReport(path, recursive, { ...options, dotEntries: false })).files;
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
    // removes the links and not what they point at.
    const followLinks = options?.followLinks ?? true;
    // The index's walk lists a dot file and what lies in a dot folder, as the
    // desktop's and the app storage's walks do (E8, Sammelplan § 3.121): such
    // a file is the user's — the sync learns its changes from the index, and
    // it is only hidden from what the user reads. Never what is internal
    // (`.plainva`, `.obsidian`, `.git`, …): the walk does not go into it.
    // Asked without dot entries — the tree, the snapshot before a recursive
    // delete — it leaves every one of them out.
    const dotEntries = options?.dotEntries !== false;
    // A folder that is itself a link holds nothing of its own: what it lists
    // lies where it points, and a delete takes the link alone.
    if (!followLinks && raw) {
      const own = await this.plugin.stat({ handle: this.handle, path: raw }).catch(() => null);
      if (own?.entry?.link && own.entry.isDirectory) return { files: [], skipped: [] };
    }
    await this.walk(raw, recursive ?? false, out, { skipped, seen: new Set(), followLinks, includeHidden: false, includeDotEntries: dotEntries, excludeDirNames: [], signal: options?.signal });
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
      if (!s.name || (!walk.includeHidden && s.name.startsWith(".") && !(walk.includeDotEntries && !isInternalSegment(s.name)))) continue;
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
      if (!walk.includeHidden && e.name.startsWith(".") && !(walk.includeDotEntries && !isInternalSegment(e.name))) continue;
      if (e.isDirectory && walk.excludeDirNames.includes(e.name)) continue;
      if (e.link && !walk.followLinks) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      out.push(toInfo(childRel, e));
      if (e.isDirectory && recursive) await this.walk(childRel, true, out, walk, depth + 1, e.identity);
    }
  }
}
