import { IVaultAdapter, DeletionConfirmation, VaultListing, VaultFileInfo, VaultFileNotFoundError } from "./IVaultAdapter.js";
import type { SyncStateRepository, SyncState } from "./SyncStateRepository.js";
import { mergeText, mergeEditorText, containsTextChanges } from "../conflict-resolver.js";
import { parseBackupFileName } from "./backupNaming.js";
import { withPathMutation } from "./pathMutation.js";
import { ConflictSessions, conflictDiagnostic, type ConflictEditSession, type ConflictResolution, type ConflictSessionGate, type ConflictWriter, type EditorWriteResult } from "./conflictSession.js";

export class ConflictError extends Error {
  public conflictPath?: string;
  constructor(message: string, conflictPath?: string) {
    super(message);
    this.name = "ConflictError";
    this.conflictPath = conflictPath;
  }
}

async function sha256Hash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256BytesHex(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class ConflictAwareVaultAdapter implements IVaultAdapter {
  private readonly sessions: ConflictSessions;
  constructor(
    private readonly inner: IVaultAdapter,
    private readonly syncRepo: Pick<SyncStateRepository, "getSyncState" | "getBaseText" | "updateLocalHash" | "updateLocalHashAndBaseText" | "getConflictSession" | "listConflictSessions" | "saveConflictSession" | "removeConflictSession" | "recordConflictDiagnostic" | "listConflictDiagnostics">,
    private readonly onAutoMerge?: (path: string, mergedText: string) => void,
    private readonly mutationScope: object = syncRepo,
    private readonly adapterKind = "local"
  ) { this.sessions = new ConflictSessions(inner, syncRepo, mutationScope); }

  getConflictSession(path: string): Promise<ConflictEditSession | null> { return this.sessions.get(path); }
  listConflictSessions(): Promise<ConflictEditSession[]> { return this.sessions.list(); }
  listConflictDiagnostics() { return this.syncRepo.listConflictDiagnostics(); }

  async preserveConflict(path: string, text: string, writer: ConflictWriter): Promise<ConflictEditSession> {
    const state = await this.syncRepo.getSyncState(path);
    return this.sessions.withMutation(path, async gate => this.preserveLocked(gate, path, text, state, writer));
  }

  private async preserveLocked(gate: ConflictSessionGate, path: string, text: string, state: SyncState | null, writer: ConflictWriter,
    diagnosticBase?: { text: string | null; source: "captured" | "backup" | "none" }): Promise<ConflictEditSession> {
    const disk = await this.inner.exists(path) ? await this.inner.readTextFile(path) : null;
    const base = state?.base_text ?? null;
    return this.sessions.preserveLocked(gate, { path, text, base, external: disk, writer,
      diagnostic: await conflictDiagnostic({ path, adapter: this.adapterKind, writer, disk,
        expectedLocalHash: state?.local_sha256 ?? null, base: diagnosticBase ? diagnosticBase.text : base, baseSource: diagnosticBase?.source ?? (base === null ? "none" : "captured"),
        wasWrittenByUs: disk !== null && this.wasWrittenByUs(path, await sha256Hash(disk)) }) });
  }

  /** The editor's ancestry travels with its request, including across windows. */
  async writeEditorText(path: string, text: string, baseText: string | null): Promise<EditorWriteResult> {
    const requestedState = await this.syncRepo.getSyncState(path);
    return this.sessions.withMutation(path, async gate => {
      if (gate.session) {
        const session = await this.sessions.writeLocked(gate.session, text, baseText);
        return { stored: await this.inner.readTextFile(session.workingCopyPath), session };
      }
      const disk = await this.inner.exists(path) ? await this.inner.readTextFile(path) : null;
      if (disk === null && baseText !== null) {
        // The editor loaded this file — it holds a base — and the file is
        // gone: moved or deleted under the open note (issue #110). Writing now
        // would recreate it at its old place, a duplicate of a moved note or
        // a deletion undone, and sync would carry either on. The editor keeps
        // the text (and its journal) and decides where it goes.
        throw new VaultFileNotFoundError(path);
      }
      let candidate = text;
      if (baseText !== null && disk !== null && disk !== baseText && disk !== text) {
        const merged = mergeEditorText(baseText, text, disk);
        if (merged.hasConflicts) {
          const session = await this.preserveLocked(gate, path, text, requestedState, "editor-save");
          return { stored: await this.inner.readTextFile(session.workingCopyPath), session };
        }
        candidate = merged.mergedText;
      }
      if (baseText !== null) {
        // This request carries the actual editor ancestry; merging it again
        // through a possibly older sync marker can fabricate a conflict.
        await this.inner.writeTextFile(path, candidate);
        const stored = await this.inner.readTextFile(path);
        if (!containsTextChanges(disk ?? "", candidate, stored)) throw new Error("The saved note could not be confirmed");
        const hash = await sha256Hash(stored);
        this.rememberWrite(path, hash);
        if (disk !== null) await this.syncRepo.updateLocalHash(path, hash);
        return { stored, session: null };
      }
      try { await this.writeTextFileLocked(path, candidate, requestedState, gate); }
      catch (error) {
        const session = gate.session as ConflictEditSession | null;
        if (!(error instanceof ConflictError) || !session) throw error;
        return { stored: await this.inner.readTextFile(session.workingCopyPath), session };
      }
      const stored = await this.inner.readTextFile(path);
      if (!containsTextChanges(disk ?? "", candidate, stored)) throw new Error("The saved note could not be confirmed");
      return { stored, session: null };
    });
  }

  async resolveConflict(path: string, resolution: ConflictResolution): Promise<void> {
    await this.sessions.resolve(path, resolution);
  }

  /**
   * Per-path serialization of operations that read the file and then update the stored
   * `local_sha256`/base. The check-then-write in `writeTextFile` is not atomic, so two
   * overlapping writes to the same path could observe `local_sha256` out of step with the
   * disk and mistake the app's own in-flight write for an external modification —
   * producing spurious `.CONFLICT` files (the `.base` viewer issues many rapid writes).
   * Chaining per path makes each op atomic w.r.t. other ops on the same path. A failed op
   * (a genuine conflict) rejects to its own caller but never blocks the next queued op.
   */

  /**
   * Hash of the content this adapter last wrote per path (TestFlight feedback
   * Build 91, P1). The disk holding exactly what we wrote last is proof that
   * nobody else touched the file since — whatever `sync_state` says. That
   * bookkeeping can be stale in two ways this memory covers: a row left behind
   * by a deleted note whose name a new note now reuses, and the indexer
   * reading the file between our write and the hash update. Neither is a
   * foreign change, and neither may cost the user a `.CONFLICT` copy.
   */
  private lastWritten = new Map<string, string>();
  private static readonly LAST_WRITTEN_MAX = 4096;

  private rememberWrite(path: string, sha256: string): void {
    this.lastWritten.delete(path);
    this.lastWritten.set(path, sha256);
    if (this.lastWritten.size > ConflictAwareVaultAdapter.LAST_WRITTEN_MAX) {
      const oldest = this.lastWritten.keys().next().value;
      if (oldest !== undefined) this.lastWritten.delete(oldest);
    }
  }

  /** True when `sha256` is the content this adapter itself last wrote to `path`. */
  wasWrittenByUs(path: string, sha256: string): boolean {
    return this.lastWritten.get(path) === sha256;
  }

  private runExclusive<T>(path: string, fn: () => Promise<T>): Promise<T> {
    return withPathMutation(this.mutationScope, [path], fn);
  }

  async initialize(): Promise<void> {
    return this.inner.initialize();
  }

  async dispose(): Promise<void> {
    return this.inner.dispose();
  }

  async readTextFile(path: string): Promise<string> {
    return this.inner.readTextFile(path);
  }

  async acknowledgeExternalUpdate(path: string): Promise<void> {
    // Mark the content the editor currently knows about WITHOUT advancing the merge
    // base. This runs on every file open; if the file has unsynced local edits,
    // promoting them to the base would destroy the common ancestor and the next
    // pull would silently overwrite those edits. The base only advances on sync.
    // Serialized with writes to the same path so it never interleaves with an
    // in-flight write's check-then-update.
    return this.runExclusive(path, async () => {
      const content = await this.inner.readTextFile(path);
      await this.syncRepo.updateLocalHash(path, await sha256Hash(content));
    });
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    return this.inner.readBinaryFile(path);
  }

  async writeTextFile(path: string, localContent: string): Promise<void> {
    // Capture the base before waiting behind an incoming write. Its completion
    // advances sync_state, but cannot retroactively update the user's draft.
    const requestedState = await this.syncRepo.getSyncState(path);
    return this.sessions.withMutation(path, async gate => {
      if (gate.session) {
        await this.sessions.writeLocked(gate.session, localContent);
        throw new ConflictError("The changes are saved in the local conflict working copy", gate.session.workingCopyPath);
      }
      return this.writeTextFileLocked(path, localContent, requestedState, gate);
    });
  }

  private async writeTextFileLocked(path: string, localContent: string, syncState: SyncState | null, gate: ConflictSessionGate): Promise<void> {
    const isNew = !(await this.inner.exists(path));
    if (isNew) {
      await this.inner.writeTextFile(path, localContent);
      // No sync_state here on purpose: the indexer announces the file as new
      // (and enqueues it for push) only while it has no row.
      this.rememberWrite(path, await sha256Hash(localContent));
      return;
    }

    const currentDiskContent = await this.inner.readTextFile(path);
    const diskSha256 = await sha256Hash(currentDiskContent);
    // The disk holds what we wrote last: not a foreign change, whatever the
    // stored hash claims (see `lastWritten`).
    const ownContent = this.wasWrittenByUs(path, diskSha256);

    if (syncState && syncState.local_sha256 && syncState.local_sha256 !== diskSha256 && !ownContent) {
      // Self-heal a legacy byte-hash. The indexer used to hash non-.md text files (e.g.
      // `.base`) as raw bytes (sha256 of readBinaryFile), which can differ from the text
      // hash used here even when the file is byte-for-byte unchanged. If the stored hash
      // equals the byte hash of the *current* disk content, the file did NOT change
      // externally — adopt it and record a proper text hash + base instead of falsely
      // flagging a conflict on every save.
      try {
        const diskBytes = await this.inner.readBinaryFile(path);
        if ((await sha256BytesHex(diskBytes)) === syncState.local_sha256) {
          await this.inner.writeTextFile(path, localContent);
          const healedHash = await sha256Hash(localContent);
          await this.syncRepo.updateLocalHashAndBaseText(path, healedHash, localContent);
          this.rememberWrite(path, healedHash);
          return;
        }
      } catch {
        // readBinaryFile failed — fall through to the normal conflict handling below.
      }

      // External modification detected! Attempt 3-way merge.
      console.warn(`[ConflictAware] disk changed under us for ${path} (diskSha=${diskSha256.slice(0, 8)}, expected local=${syncState.local_sha256.slice(0, 8)}) -> attempting merge`);
      const capturedBase = syncState.base_text;
      const baseContent = capturedBase != null && await sha256Hash(capturedBase) === syncState.local_sha256
        ? { text: capturedBase, source: "captured" as const } : await this.findBaseContent(path, syncState.local_sha256);
      if (baseContent === null) {
        const session = await this.preserveLocked(gate, path, localContent, syncState, "adapter", { text: null, source: "none" });
        throw new ConflictError(`Cannot automatically merge ${path}: base version not found. Saved locally as ${session.workingCopyPath}.`, session.workingCopyPath);
      }

      const mergeResult = mergeText(baseContent.text, localContent, currentDiskContent);
      if (mergeResult.hasConflicts) {
        const session = await this.preserveLocked(gate, path, localContent, syncState, "adapter", baseContent);
        throw new ConflictError(`Cannot automatically merge ${path}: conflicting changes. Saved locally as ${session.workingCopyPath}.`, session.workingCopyPath);
      }
      
      // Auto-merge successful, save the merged content and update our expected local hash.
      await this.inner.writeTextFile(path, mergeResult.mergedText);
      const mergedHash = await sha256Hash(mergeResult.mergedText);
      await this.syncRepo.updateLocalHashAndBaseText(path, mergedHash, mergeResult.mergedText);
      this.rememberWrite(path, mergedHash);
      // Notify listeners (e.g. the editor) so the in-memory view adopts the merged
      // content. Otherwise a subsequent save would overwrite the merge with stale,
      // pre-merge content and silently drop the external changes.
      this.onAutoMerge?.(path, mergeResult.mergedText);
    } else {
      // Normal write (no conflict). Update only the local marker; never advance the
      // merge base here, otherwise an unsynced local edit becomes the base and the
      // next pull would see "local == base" and drop the edit in favour of remote.
      await this.inner.writeTextFile(path, localContent);
      const writtenHash = await sha256Hash(localContent);
      // Remembered BEFORE the hash lands in sync_state: an indexer pass that
      // reads the file in between asks `wasWrittenByUs` and stays quiet.
      this.rememberWrite(path, writtenHash);
      await this.syncRepo.updateLocalHash(path, writtenHash);
    }
  }

  private async findBaseContent(path: string, targetHash: string): Promise<{ text: string; source: "captured" | "backup" } | null> {
    // 1. Check the reliable base_text from sync_state
    const baseText = await this.syncRepo.getBaseText(path);
    if (baseText !== null) {
      const hash = await sha256Hash(baseText);
      if (hash === targetHash) {
        return { text: baseText, source: "captured" };
      }
    }
    
    // 2. Fallback: Search backups in case it's an older state that was backed up
    const lastSlash = path.lastIndexOf("/");
    const dirPrefix = lastSlash >= 0 ? path.substring(0, lastSlash + 1) : "";
    const backupDir = `.plainva/backups/${dirPrefix}`.replace(/\/$/, "");

    try {
      const files = await this.inner.listDir(backupDir, false);
      const originalBasename = path.split(/[/\\]/).pop() || "";

      const backups = files
        .map((f: VaultFileInfo) => ({ file: f, parsed: f.isDirectory ? null : parseBackupFileName(f.name) }))
        .filter((e): e is { file: VaultFileInfo; parsed: { originalName: string; timestamp: number } } =>
          e.parsed !== null && e.parsed.originalName === originalBasename)
        // Sort descending (newest first)
        .sort((a, b) => b.parsed.timestamp - a.parsed.timestamp)
        .map((e) => e.file);

      for (const backup of backups) {
        try {
          const content = await this.inner.readTextFile(backup.path);
          const hash = await sha256Hash(content);
          if (hash === targetHash) {
            return { text: content, source: "backup" };
          }
        } catch {
          // ignore read errors on backups
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  async writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
    // We do not auto-merge binary files
    return this.runExclusive(path, () => this.inner.writeBinaryFile(path, content));
  }

  async deleteItem(path: string, recursive?: boolean, confirmation?: DeletionConfirmation): Promise<void> {
    return this.runExclusive(path, async () => {
      await this.requireResolved(path);
      return this.inner.deleteItem(path, recursive, confirmation);
    });
  }

  async renameItem(oldPath: string, newPath: string): Promise<void> {
    return withPathMutation(this.mutationScope, [oldPath, newPath], async () => {
      await this.requireResolved(oldPath);
      await this.requireResolved(newPath);
      return this.inner.renameItem(oldPath, newPath);
    });
  }

  private async requireResolved(path: string): Promise<void> {
    const key = path.replace(/\\/g, "/").normalize("NFC").replace(/\/$/, "").toLowerCase();
    const affected = (candidate: string) => candidate.toLowerCase() === key || candidate.toLowerCase().startsWith(key + "/");
    const session = (await this.sessions.list()).find(s => affected(s.originalPath) || affected(s.workingCopyPath));
    if (session) throw new ConflictError("Resolve the open conflict before moving or deleting this file or folder", session.workingCopyPath);
  }

  async exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  async getFileInfo(path: string): Promise<VaultFileInfo> {
    return this.inner.getFileInfo(path);
  }

  /**
   * Optional on the underlying adapter: forwarded when it is there, a no-op
   * when it is not. The import writer stamps a note's source dates through
   * here, and it is only reachable via the wrappers the app actually hands
   * out — a wrapper that swallowed the call would make the whole feature a
   * silent no-op in the real app while every test still passed.
   */
  async setFileTimes(path: string, times: { createdMs?: number; modifiedMs?: number }): Promise<void> {
    await (this.inner as any).setFileTimes?.(path, times);
  }

  async listDirReport(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultListing> {
    return this.inner.listDirReport
      ? this.inner.listDirReport(path, recursive, options)
      : { files: await this.inner.listDir(path, recursive, options), skipped: [] };
  }

  async listDir(path?: string, recursive?: boolean, options?: { signal?: AbortSignal }): Promise<VaultFileInfo[]> {
    return this.inner.listDir(path, recursive, options);
  }

  async createDir(path: string): Promise<void> {
    return this.inner.createDir(path);
  }

  async watch(callback: (events: import("./IVaultAdapter.js").WatchEvent[]) => void): Promise<() => void> {
    if (this.inner.watch) {
      return this.inner.watch(callback);
    }
    return () => {};
  }
}
