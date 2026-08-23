import { IVaultAdapter, VaultFileInfo, VaultFileNotFoundError, VaultFileExistsError, VaultListing, VaultWalkSkip, isInternalPath } from "@plainva/core";
import { readTextFile, readFile, readDir, stat, remove, rename, mkdir, exists } from "@tauri-apps/plugin-fs";
import { join, normalize, sep } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { isWithinRoot } from "@plainva/ui";
import { logDiagnostic, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { createLimiter, type ConcurrencyLimiter } from "@plainva/ui";

/**
 * How many filesystem calls (stat/readDir/exists) may be in flight at once
 * during a directory walk. The walk used to stat every file strictly
 * sequentially, which on a network drive meant 500+ serial round-trips before
 * the first note could render. Bounding at 8 keeps the IPC bridge from being
 * overwhelmed while overlapping the network latency.
 */
const LIST_CONCURRENCY = 8;

/**
 * Hard depth cap for the directory walk. Symlinks/junctions ARE followed now
 * (P1e: a cloud folder mounted into the vault used to be invisible forever,
 * even after a restart), so a link pointing back at an ancestor would recurse
 * without end — the `visited` set cannot catch it because every pass through
 * the loop builds a NEW, longer path string, and the filesystem plugin offers
 * no canonicalisation to compare real targets. The cap terminates such a loop
 * and the walk reports the cut-off point as a skipped entry instead of hanging
 * or silently truncating.
 */
const MAX_WALK_DEPTH = 32;

type FsLimiter = ConcurrencyLimiter;

/**
 * Turns an absolute watcher path into a vault-relative one, or null if it does
 * not belong to this vault.
 *
 * The former implementation was a bare `p.startsWith(rootPath)`. It missed the
 * cases Windows actually produces — a drive letter in the other case, a
 * trailing separator on the root, the extended-length `\\?\` prefix — and then
 * pushed the ABSOLUTE path into the index queue, where it matches no indexed
 * row (worst case the existing row is treated as removed). Callers now fall
 * back to a full reconcile when this returns null, which is fail-safe.
 */
export function relativizeWatchPath(rootPath: string, absolutePath: string): string | null {
  const strip = (s: string) => s.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/+$/, "");
  const root = strip(rootPath);
  const full = strip(absolutePath);
  if (!root) return null;
  const startsWithRoot = (haystack: string, needle: string) =>
    haystack.slice(0, needle.length) === needle;
  let rest: string | null = null;
  if (startsWithRoot(full, root)) {
    rest = full.slice(root.length);
  } else if (startsWithRoot(full.toLowerCase(), root.toLowerCase())) {
    // Windows paths are case-insensitive; the watcher and the picker disagree
    // about the drive letter and about UNC host casing often enough to matter.
    rest = full.slice(root.length);
  }
  if (rest === null) return null;
  // The vault root itself — a change to the folder, not to a file in it.
  if (rest === "") return "";
  // Guard against a sibling that merely shares the prefix ("/vault-old/x" vs "/vault").
  if (rest[0] !== "/") return null;
  return rest.slice(1);
}

/**
 * Sentinel watch-event path meaning "I could not attribute this change to a
 * concrete file — reconcile the whole vault". `*` is not a legal filename on
 * Windows and never appears as a relative vault path, so it cannot collide.
 */
export const WATCH_RESCAN_MARKER = "*";

/** True for filesystem "access" (read/open) events, which must not re-trigger indexing. */
export function isAccessWatchEvent(type: unknown): boolean {
  if (typeof type === "string") return type.toLowerCase().includes("access");
  if (type && typeof type === "object") return Object.prototype.hasOwnProperty.call(type, "access");
  return false;
}

/** Uint8Array → base64 for the atomic-write IPC (chunked: no stack overflow
 *  on multi-MB images, and a JSON number-array would be ~4x the size). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export class TauriVaultAdapter implements IVaultAdapter {
  constructor(public readonly rootPath: string) {}

  /** Cached normalize(rootPath): the vault root never changes, but getAbsolutePath
   *  used to re-normalize it via IPC on EVERY read/write/exists/stat call (WP5). */
  private normalizedRootPromise: Promise<string> | null = null;
  private normalizedRoot(): Promise<string> {
    if (!this.normalizedRootPromise) this.normalizedRootPromise = normalize(this.rootPath);
    return this.normalizedRootPromise;
  }

  /** Opaque write-root handle for the atomic write command (hardening P2).
   *  Registered lazily and cached; Rust owns path validation from here on. */
  private rootIdPromise: Promise<string> | null = null;
  private rootId(): Promise<string> {
    if (!this.rootIdPromise) {
      this.rootIdPromise = invoke<string>("register_write_root", { path: this.rootPath }).catch((e) => {
        this.rootIdPromise = null; // retry on the next write (e.g. root created later)
        throw e;
      });
    }
    return this.rootIdPromise;
  }

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
    const normalizedRoot = await this.normalizedRoot();
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

  // Writes go through the native atomic command (hardening P2): exclusive
  // temp in the target folder → fsync → rename. A crash, full disk or a
  // network-share drop can no longer leave a torn or zero-byte note. Also
  // ONE IPC round-trip instead of the former exists+mkdir+write triple —
  // the command creates parent folders and validates the relative path.
  async writeTextFile(path: string, content: string): Promise<void> {
    await invoke("write_file_atomic", {
      rootId: await this.rootId(),
      relPath: path,
      contents: content,
      encoding: "utf8",
    });
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    const absPath = await this.getAbsolutePath(path);
    if (!(await exists(absPath))) throw new VaultFileNotFoundError(path);
    return readFile(absPath);
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    await invoke("write_file_atomic", {
      rootId: await this.rootId(),
      relPath: path,
      contents: bytesToBase64(content),
      encoding: "base64",
    });
  }

  // Used by the import path so notes keep the dates they had in the app they
  // came from. Modification time is portable; creation time only lands on
  // Windows, which is why importers also write the date into the frontmatter.
  async setFileTimes(
    path: string,
    times: { createdMs?: number; modifiedMs?: number }
  ): Promise<void> {
    if (times.modifiedMs === undefined && times.createdMs === undefined) return;
    await invoke("set_file_times", {
      rootId: await this.rootId(),
      relPath: path,
      modifiedMs: times.modifiedMs ?? times.createdMs,
      createdMs: times.createdMs ?? null,
    });
  }



  async deleteItem(path: string, recursive: boolean = false): Promise<void> {
    const absPath = await this.getAbsolutePath(path);
    // Idempotent: a target that is already gone (e.g. a folder the sync removed
    // remotely, or an external deletion) is a successful delete — same contract
    // as every remote sync target ("not found = success"). Throwing here left a
    // phantom tree row that could never be cleared. The caller still runs its
    // index/tree cleanup on this success path.
    if (!(await exists(absPath))) return;

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
      //
      // Both outcomes end up on screen as "something went wrong", and they mean
      // the OPPOSITE: here the item IS gone, while a thrown error means it is
      // still there. A reporter's "still get an error" could not be told apart
      // (issue #34), so each writes its own diagnostics line.
      console.warn(`[TauriVaultAdapter] OS trash unavailable for ${absPath}; deleting permanently`, err);
      logDiagnostic("vault", `trash unavailable for ${path}: ${String(err)} — deleting permanently instead`);
      try {
        await remove(absPath, { recursive });
      } catch (hardErr) {
        logDiagnostic("vault", `delete FAILED for ${path}: ${String(hardErr)} — the item is still there`);
        throw hardErr;
      }
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

  // Internal method to handle recursion, symlink cycles and skip reporting
  private async _listDirInternal(
    path: string,
    absPath: string,
    recursive: boolean,
    visited: Set<string>,
    limit: FsLimiter,
    skipped: VaultWalkSkip[],
    depth: number,
    /** True once the walk is inside an explicitly requested internal folder. */
    insideInternal: boolean
  ): Promise<VaultFileInfo[]> {
    if (visited.has(absPath)) {
      skipped.push({ path, reason: "cycle" });
      return [];
    }
    visited.add(absPath);

    if (depth > MAX_WALK_DEPTH) {
      skipped.push({ path, reason: "cycle" });
      return [];
    }

    if (!(await limit.run(() => exists(absPath)))) return [];

    let entries: Awaited<ReturnType<typeof readDir>>;
    try {
      entries = await limit.run(() => readDir(absPath));
    } catch {
      // Permission denied, offline network share, torn-down mount: report it
      // instead of returning an empty folder that looks legitimately empty.
      skipped.push({ path, reason: "unreadable" });
      return [];
    }

    // Filter valid entries. Symlinks/junctions are FOLLOWED (P1e) — a cloud or
    // network folder mounted into the vault used to be dropped here, so its
    // notes never reached the index and no restart could fix that. Exclusions
    // now use the shared internal-path semantics, so a user's own dot-file
    // (`.env-notes.md`) stays visible while `.git`/`.obsidian`/… stay out.
    const validEntries = entries.filter(e => {
      const name = e.name;
      if (!name) return false;
      if (insideInternal) return true;
      return !isInternalPath(path ? `${path}/${name}` : name);
    });

    const separator = absPath.includes('\\') ? '\\' : '/';
    const basePath = absPath.endsWith(separator) ? absPath : absPath + separator;

    // Stat the files of this folder CONCURRENTLY (bounded by the shared limiter).
    // The stats used to run strictly one after another — on a network drive that
    // was the dominant vault-load cost. Directories carry no stat (mtime/size are
    // unused for them). Order is preserved via Promise.all over validEntries.
    //
    // Stat every file (not just .md): attachments need a real mtime/size too, or
    // the indexer's mtime-based change detection treats them as changed every
    // pass and re-reads + re-hashes them. A stat() is far cheaper than that.
    //
    // readDir's `isDirectory` doesn't follow symlinks; stat()'s does, and must
    // win — otherwise a symlinked directory (e.g. a venv's `lib64 -> lib`) is
    // walked as a "file" and readTextFile crashes on it with EISDIR.
    type ResolvedEntry = VaultFileInfo & { absPath: string };
    const resolved: ResolvedEntry[] = await Promise.all(
      validEntries.map((entry) => {
        const relativeChildPath = path ? `${path}/${entry.name}` : entry.name!;
        const childAbsPath = basePath + entry.name;
        if (entry.isDirectory) {
          return Promise.resolve<ResolvedEntry>({
            name: entry.name!, path: relativeChildPath, absPath: childAbsPath, isDirectory: true,
            mtime: Date.now(), ctime: undefined, size: 0,
          });
        }
        return limit.run(async () => {
          let mtime = Date.now();
          let ctime: number | undefined;
          let size = 0;
          let isDirectory = false;
          try {
            const entryStat = await stat(childAbsPath);
            isDirectory = entryStat.isDirectory;
            mtime = entryStat.mtime?.getTime() || Date.now();
            ctime = isDirectory ? undefined : entryStat.birthtime?.getTime() || undefined;
            size = isDirectory ? 0 : entryStat.size;
          } catch {
            console.warn(`Failed to stat ${childAbsPath}`);
          }
          return { name: entry.name!, path: relativeChildPath, absPath: childAbsPath, isDirectory, mtime, ctime, size };
        });
      })
    );

    const results: VaultFileInfo[] = resolved.map(({ absPath: _absPath, ...info }) => info);

    // Recurse into subdirectories concurrently too; the shared limiter keeps the
    // total in-flight FS calls across the whole tree at LIST_CONCURRENCY. No call
    // holds a slot while awaiting children, so there is no deadlock. `visited`
    // guards symlink loops (the check+add is synchronous, before the first await).
    // Filtered on the resolved isDirectory so a symlinked directory is descended into.
    if (recursive) {
      const childLists = await Promise.all(
        resolved
          .filter((e) => e.isDirectory)
          .map((entry) =>
            this._listDirInternal(entry.path, entry.absPath, true, visited, limit, skipped, depth + 1, insideInternal)
          )
      );
      for (const cl of childLists) results.push(...cl);
    }

    return results;
  }

  async listDir(path: string = "", recursive: boolean = false): Promise<VaultFileInfo[]> {
    return (await this.listDirReport(path, recursive)).files;
  }

  async listDirReport(path: string = "", recursive: boolean = false): Promise<VaultListing> {
    const absPath = await this.getAbsolutePath(path);
    const skipped: VaultWalkSkip[] = [];
    // The internal-path filter hides `.plainva`, `.git`, … from a walk over the
    // VAULT. It must not fire when the caller deliberately walks INSIDE such a
    // folder — the version history lists `.plainva/backups/...` and would come
    // back empty. Asking for an internal path is an explicit request for it.
    const files = await this._listDirInternal(
      path, absPath, recursive, new Set<string>(), createLimiter(LIST_CONCURRENCY), skipped, 0,
      isInternalPath(path)
    );
    return { files, skipped };
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
        // when the indexer reads the vault. Read off the event STRUCTURE — the old
        // JSON.stringify heuristic also matched a note called "access-log.md".
        if (isAccessWatchEvent(event.type)) return;

        const events: import("@plainva/core").WatchEvent[] = [];
        for (const p of event.paths || []) {
          const rel = relativizeWatchPath(this.rootPath, p);
          if (rel === null) {
            // Not attributable to this vault (unexpected casing, a mount point,
            // a truncated path). Enqueuing the raw absolute path would address a
            // row that does not exist — worse, it can read as "removed". Ask for
            // a full reconcile instead: slower, but never wrong.
            console.warn("[TauriVaultAdapter] watcher path outside the vault root, forcing a full reconcile:", p);
            events.push({ path: WATCH_RESCAN_MARKER, type: "any" });
            continue;
          }
          events.push({ path: rel, type: "any" });
        }
        callback(events);
      }, { recursive: true, delayMs: 300 });

      return unwatch;
    } catch (err: any) {
      console.error("Tauri watch failed to start:", err);
      throw err;
    }
  }
}
