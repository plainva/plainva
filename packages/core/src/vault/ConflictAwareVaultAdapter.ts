import { IVaultAdapter, DeletionConfirmation, VaultListing, VaultFileInfo, VaultFileNotFoundError, type TextChange, type TextFileChange, type TextFileState, type TextFileUpdate, type VaultWalkOptions } from "./IVaultAdapter.js";
import type { SyncStateRepository, SyncState } from "./SyncStateRepository.js";
import { mergeText, mergeEditorText, containsTextChanges } from "../conflict-resolver.js";
import { parseBackupFileName } from "./backupNaming.js";
import { readLocalText } from "./localText.js";
import { withPathMutation } from "./pathMutation.js";
import { ConflictSessions, conflictDiagnostic, conflictSessionKey, type ConflictEditSession, type ConflictResolution, type ConflictSessionGate, type ConflictWriter, type EditorWriteResult } from "./conflictSession.js";

export class ConflictError extends Error {
  public conflictPath?: string;
  constructor(message: string, conflictPath?: string) {
    super(message);
    this.name = "ConflictError";
    this.conflictPath = conflictPath;
  }
}

/**
 * What a write without a starting text is told at a file whose open conflict
 * holds somebody else's draft: nothing was written. The message is what is
 * left of the error where it loses its class (the desktop's window bus hands
 * a failed write on as its message), so a surface recognises the refusal by
 * how it begins.
 */
export const OPEN_CONFLICT_MESSAGE = "The file has an open conflict; nothing was written. Resolve the conflict first";

/**
 * That refusal. A `ConflictError` otherwise says the text was KEPT — in the
 * working copy it names; this one says nothing was written anywhere. It has a
 * name of its own, so a surface that asks an error for `ConflictError` to say
 * "saved in your conflict copy" does not say it here.
 */
export class OpenConflictError extends ConflictError {
  constructor(conflictPath?: string) {
    super(OPEN_CONFLICT_MESSAGE, conflictPath);
    this.name = "OpenConflictError";
  }
}

/**
 * What a change makes of a file and of the working copy of its open conflict.
 * The file comes first, and what the change throws there is the caller's. The
 * working copy is the user's own version and may be a text the change cannot
 * take — a block it refuses, a line that is not there: it is left alone then.
 */
export function changeOf(state: TextFileState, change: TextChange): TextFileChange {
  const text = change(state.text);
  let workingCopy: string | null = null;
  if (state.workingCopy !== null) {
    try { workingCopy = change(state.workingCopy); } catch { workingCopy = null; }
  }
  return { text, workingCopy };
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

/** U+FFFD — what a decoder puts where the bytes were not UTF-8. */
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

export class ConflictAwareVaultAdapter implements IVaultAdapter {
  private readonly sessions: ConflictSessions;
  constructor(
    private readonly inner: IVaultAdapter,
    private readonly syncRepo: Pick<SyncStateRepository, "getSyncState" | "getBaseText" | "updateLocalHash" | "updateLocalHashAndUnsyncedBaseText" | "getConflictSession" | "listConflictSessions" | "saveConflictSession" | "removeConflictSession" | "recordConflictDiagnostic" | "listConflictDiagnostics">,
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
    diagnosticBase?: { text: string | null; source: "captured" | "backup" | "none" }, plain = false): Promise<ConflictEditSession> {
    const disk = await this.inner.exists(path) ? await this.inner.readTextFile(path) : null;
    const base = state?.base_text ?? null;
    return this.sessions.preserveLocked(gate, { path, text, base, external: disk, writer, plain,
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
        // The merge hands its result back in the file's shape (`mergedTextShape`):
        // a "\r\n" file with one stray line end, or one that changed elsewhere
        // meanwhile, is not written back with every line end turned (finding
        // 2026-10-08) — and where the other program turned them on purpose,
        // this save does not turn them back.
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

  /**
   * The hash `local_sha256` is compared with: the one of the file's bytes
   * (`readLocalText`). For UTF-8 the hash of the text just read is that hash.
   * A text that came back with a replacement character in it may be the
   * reading of a file in another encoding, so there the bytes are asked — or
   * the unchanged file would count as changed by someone else on every write.
   *
   * Only the comparison is put right here. What is written afterwards is still
   * the text the caller hands in: an editor that held the lossy reading of
   * such a file saves that reading (see `mergeableText`).
   */
  private async diskSha(path: string, text: string): Promise<string> {
    const suspect = typeof text === "string" && text.includes(REPLACEMENT_CHARACTER);
    return suspect ? sha256BytesHex(await this.inner.readBinaryFile(path)) : sha256Hash(text);
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
    //
    // The marker is the hash of the file's BYTES, as the indexer, the push and
    // the pull keep it (`readLocalText`). The hash of what a decoder made of a
    // file in another encoding is the hash of no file: compared with a marker
    // any of the others wrote, it reads as "changed by someone else".
    return this.runExclusive(path, async () => {
      await this.syncRepo.updateLocalHash(path, (await readLocalText(this.inner, path)).sha256);
    });
  }

  async readBinaryFile(path: string): Promise<Uint8Array> {
    return this.inner.readBinaryFile(path);
  }

  /**
   * Writes a whole text over a file, for a writer that names no text it
   * started from: a view that holds its text since it loaded it, a file made
   * anew, a version put back. The file on disk is compared with what the chain
   * knew last; a change from outside is merged in, or kept as a conflict.
   *
   * Whoever changes a place of a file that exists — a property, a task's box,
   * a link — reads and writes through `updateTextFile` instead: it starts from
   * the file as it lies there and never has to merge.
   */
  async writeTextFile(path: string, localContent: string): Promise<void> {
    // Capture the base before waiting behind an incoming write. Its completion
    // advances sync_state, but cannot retroactively update the user's draft.
    const requestedState = await this.syncRepo.getSyncState(path);
    return this.sessions.withMutation(path, async gate => {
      if (gate.session) {
        // A writer that names the working copy itself read that copy, or
        // holds it: a version of it put back, a database opened from its own
        // conflict copy. It writes the copy and nothing else, as asked.
        if (this.namesWorkingCopy(path, gate)) {
          await this.sessions.writeLocked(gate.session, localContent);
          return;
        }
        // An open conflict: the user's own version lies in the working copy,
        // and this writer did not start from it. It replaces the copy only
        // where the copy is still its own earlier text (`writePlainLocked`).
        if (!(await this.sessions.writePlainLocked(gate.session, localContent))) {
          throw new OpenConflictError(gate.session.workingCopyPath);
        }
        throw new ConflictError("The changes are saved in the local conflict working copy", gate.session.workingCopyPath);
      }
      return this.writeTextFileLocked(path, localContent, requestedState, gate, true);
    });
  }

  /**
   * Reads a text file, changes it and writes it back, in one step (finding
   * 2026-10-12).
   *
   * For a writer that changes a place of a file that exists — a cell of a
   * database, a value set across a selection, a task's box, a line of the
   * journal, the links a rename rewrites. It has just read the file; through
   * `writeTextFile` the chain did not learn that and judged it like an editor
   * holding a text from minutes ago. A note changed below the chain — by an
   * earlier build of the app, by another program in a folder the user picked —
   * was refused as a conflict that way, with a conflict copy of a note nobody
   * else had touched; and a note with an open conflict lost the user's own
   * text, because the writer had read the note (the other side) and what it
   * wrote was put in place of the working copy.
   *
   * Here the chain reads inside the gate it holds for the path and calls
   * `change` with that text. So the disk holds exactly the text the change
   * started from, by construction: nothing to compare, nothing to merge, no
   * conflict copy. Only the local marker follows — as on opening a note
   * (`acknowledgeExternalUpdate`); the merge base stays the sync's. Version,
   * permission check and sync queue are the links' below, as for any write.
   *
   * A file with an open conflict is changed like any other: tables, task
   * lists and the other devices read the file itself, so that is where the
   * change belongs. The same change is then made in the working copy, the
   * user's own version, so that it does not fall behind — whichever version
   * the user keeps, the change is in it. Where it finds no place there (a
   * task's line that reads differently in the user's version, a block the
   * change refuses), the working copy stays as it is; it is never replaced.
   * A writer that names the working copy itself changes that one only.
   *
   * A file that is not there is an error: a change needs something to change.
   * What `change` throws reaches the caller, and nothing is written.
   */
  async updateTextFile(path: string, change: TextChange): Promise<TextFileUpdate> {
    return this.sessions.withMutation(path, async gate => {
      const state = await this.stateLocked(path, gate);
      return this.applyLocked(path, gate, state, changeOf(state, change));
    });
  }

  /** `updateTextFile` in two steps, for a window that reaches this chain over a bus and cannot hand over a function: the read … */
  async readTextFileState(path: string): Promise<TextFileState> {
    return this.sessions.withMutation(path, gate => this.stateLocked(path, gate));
  }

  /** … and the write — if the file, and the working copy of its conflict, still are what was read. `null` says they are not: read again. */
  async writeTextFileChange(path: string, expected: TextFileState, next: TextFileChange): Promise<TextFileUpdate | null> {
    return this.sessions.withMutation(path, async gate => {
      const state = await this.stateLocked(path, gate);
      if (state.text !== expected.text || state.workingCopy !== expected.workingCopy) return null;
      return this.applyLocked(path, gate, state, next);
    });
  }

  /** Whether the caller named the working copy of the conflict itself, not the file it belongs to. */
  private namesWorkingCopy(path: string, gate: ConflictSessionGate): boolean {
    return !!gate.session && conflictSessionKey(path) === gate.session.workingCopyPath;
  }

  private async stateLocked(path: string, gate: ConflictSessionGate): Promise<TextFileState> {
    if (gate.session && this.namesWorkingCopy(path, gate)) return { text: await this.sessions.draftLocked(gate.session), workingCopy: null };
    const text = await this.inner.readTextFile(path);
    return { text, workingCopy: gate.session ? await this.sessions.draftLocked(gate.session) : null };
  }

  private async applyLocked(path: string, gate: ConflictSessionGate, state: TextFileState, next: TextFileChange): Promise<TextFileUpdate> {
    const session = gate.session;
    const changed = next.text !== null && next.text !== state.text;
    const text = changed ? next.text! : state.text;
    if (session && this.namesWorkingCopy(path, gate)) {
      // The draft is what was read: the session's journal takes the new text as it takes an editor's.
      if (changed) await this.sessions.writeLocked(session, text, state.text);
      return { before: state.text, text, changed, conflict: { workingCopyPath: session.workingCopyPath, changed } };
    }
    if (changed) {
      // An ordinary write, as `writeTextFileLocked` makes one for a file nobody else touched.
      await this.inner.writeTextFile(path, text);
      const hash = await sha256Hash(text);
      // Remembered BEFORE the hash lands in sync_state: an indexer pass that
      // reads the file in between asks `wasWrittenByUs` and stays quiet.
      this.rememberWrite(path, hash);
      await this.syncRepo.updateLocalHash(path, hash);
    }
    if (!session) return { before: state.text, text, changed, conflict: null };
    let carried = false;
    if (state.workingCopy !== null && next.workingCopy !== null && next.workingCopy !== state.workingCopy) {
      try {
        await this.sessions.writeLocked(session, next.workingCopy, state.workingCopy);
        carried = true;
      } catch (error) {
        // The file has the change. Where the session's journal took the new
        // draft before the step failed, the working copy follows with the
        // session's next step; otherwise the user's own version stays what
        // it was, and the difference shows when the two are compared.
        carried = (await this.sessions.journaledDraft(session).catch(() => null)) === next.workingCopy;
        console.warn(`[ConflictAware] ${path}: the working copy of the open conflict ${carried ? "takes the change with its next step" : "did not take the change"}`, error);
      }
    }
    return { before: state.text, text, changed, conflict: { workingCopyPath: session.workingCopyPath, changed: carried } };
  }

  private async writeTextFileLocked(path: string, localContent: string, syncState: SyncState | null, gate: ConflictSessionGate, plain = false): Promise<void> {
    const isNew = !(await this.inner.exists(path));
    if (isNew) {
      await this.inner.writeTextFile(path, localContent);
      // No sync_state here on purpose: the indexer announces the file as new
      // (and enqueues it for push) only while it has no row.
      this.rememberWrite(path, await sha256Hash(localContent));
      return;
    }

    const currentDiskContent = await this.inner.readTextFile(path);
    const diskSha256 = await this.diskSha(path, currentDiskContent);
    // The disk holds what we wrote last: not a foreign change, whatever the
    // stored hash claims (see `lastWritten`).
    const ownContent = this.wasWrittenByUs(path, diskSha256);

    if (syncState && syncState.local_sha256 && syncState.local_sha256 !== diskSha256 && !ownContent) {
      // Self-heal a legacy byte-hash. The indexer used to hash non-.md text files (e.g.
      // `.base`) as raw bytes (sha256 of readBinaryFile), which can differ from the text
      // hash used here even when the file is byte-for-byte unchanged. If the stored hash
      // equals the byte hash of the *current* disk content, the file did NOT change
      // externally — adopt it and record a proper text hash instead of falsely
      // flagging a conflict on every save.
      //
      // Still met today where a platform's text reader hands a file out
      // without its byte order mark while the sync recorded the hash of its
      // bytes. The text written here is a local change like any other: it
      // becomes the base only for a file no sync has seen (see
      // `updateLocalHashAndUnsyncedBaseText`). Written over a base the sync
      // recorded, it made the next change from another device replace this one.
      try {
        const diskBytes = await this.inner.readBinaryFile(path);
        if ((await sha256BytesHex(diskBytes)) === syncState.local_sha256) {
          await this.inner.writeTextFile(path, localContent);
          const healedHash = await sha256Hash(localContent);
          await this.syncRepo.updateLocalHashAndUnsyncedBaseText(path, healedHash, localContent);
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
        const session = await this.preserveLocked(gate, path, localContent, syncState, "adapter", { text: null, source: "none" }, plain);
        throw new ConflictError(`Cannot automatically merge ${path}: base version not found. Saved locally as ${session.workingCopyPath}.`, session.workingCopyPath);
      }

      const mergeResult = mergeText(baseContent.text, localContent, currentDiskContent);
      if (mergeResult.hasConflicts) {
        const session = await this.preserveLocked(gate, path, localContent, syncState, "adapter", baseContent, plain);
        throw new ConflictError(`Cannot automatically merge ${path}: conflicting changes. Saved locally as ${session.workingCopyPath}.`, session.workingCopyPath);
      }
      
      // Auto-merge successful, save the merged content and update our expected local hash.
      await this.inner.writeTextFile(path, mergeResult.mergedText);
      const mergedHash = await sha256Hash(mergeResult.mergedText);
      // The merged text is this device's new local text, not a version the
      // remote has seen. On a row a sync recorded a base for, that base stays
      // (finding 2026-10-11): stored in its place, the merged text made the
      // next change from another device replace both changes merged here,
      // without a conflict copy.
      //
      // That has a price, and it is paid here the next time: such a row keeps
      // no text for the new marker, so a SECOND change from outside before the
      // upload finds nothing to merge against (the snapshots hold what was
      // there before a write, not what was written) and this write ends as a
      // conflict copy instead of a merge. A writer that hands in the text it
      // started from — `writeEditorText` — is not asked that price.
      await this.syncRepo.updateLocalHashAndUnsyncedBaseText(path, mergedHash, mergeResult.mergedText);
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

  /** The spelling the path is stored under on disk (path identity, ADR 0016). */
  async realPath(path: string): Promise<string> {
    return this.inner.realPath ? this.inner.realPath(path) : path;
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

  async listDirReport(path?: string, recursive?: boolean, options?: VaultWalkOptions): Promise<VaultListing> {
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
