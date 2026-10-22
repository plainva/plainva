import { IVaultAdapter, DeletionConfirmation, VaultListing, VaultFileInfo, VaultFileNotFoundError, type TextChange, type TextFileChange, type TextFileState, type TextFileUpdate, type VaultWalkOptions } from "./IVaultAdapter.js";
import type { SyncStateRepository, SyncState } from "./SyncStateRepository.js";
import { mergeText, mergeEditorText, containsTextChanges } from "../conflict-resolver.js";
import { WORKSPACE_FORKS_FOLDER, isPlainvaInternalPath, parseBackupFileName } from "./backupNaming.js";
import { NotTextFileError, isHashWithoutMark, isMarkerTakenWithoutMark, readExactText, readLocalText } from "./localText.js";
import { withPathMutation } from "./pathMutation.js";
import { ConflictSessions, conflictDiagnostic, conflictSessionKey, type ConflictBytesResolution, type ConflictEditSession, type ConflictResolution, type ConflictSessionGate, type ConflictWriter, type EditorWriteResult } from "./conflictSession.js";
import { hasUnkeptLineEnds, readTextShape, withKeptLineEnds, type TextFileShape } from "../textFileShape.js";

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

/**
 * The app's own files — the ones under `.plainva`: the bookmarks, the notes
 * opened last, the pins of a map, the sideband files of the sync. What the app
 * writes there itself — a whole text, or a change it makes (`writeTextFile`,
 * `updateTextFile` and its two halves) — this link keeps nothing about and
 * decides no conflict over, as the two below it take no version and no queue
 * entry (finding 2026-10-12; so since 2026-10-20).
 *
 * It has nothing to decide one with: an own file has no version and no merge
 * base, so there is never a text to merge against. A file that anything else
 * had written since this link's last write — a settings profile, which writes
 * the bookmarks through the chain's lowest link; a second device, in a folder
 * both write to — ended as "base version not found" with a conflict copy, and
 * so did every write after it: no bookmark could be set any more, no pin was
 * kept. Every writer of such a file had to know to stay below this link, and
 * the ones that did say so where they are handed their adapter.
 *
 * The local forks of an encrypted workspace are no such files: they lie under
 * `.plainva` (`WORKSPACE_FORKS_FOLDER`), but they are copies of a person's
 * notes and are guarded like any note. An editor's save is no such write: it
 * keeps every protection wherever the file lies. Everything else under
 * `.plainva` counts as the app's — a note kept there (only a setting typed to
 * point into the hidden folder puts one there) keeps the protections of an
 * editor's save, not those of a note against what the app writes to it. Nor
 * is the rule above any merge lifted: no text over a file that is no text
 * (`NotTextFileError`).
 */
const isOwnFile = (path: string): boolean => {
  const key = conflictSessionKey(path);
  return isPlainvaInternalPath(key) && !key.startsWith(`${WORKSPACE_FORKS_FOLDER}/`);
};

/**
 * A conflict this link left on an own file by a write of the app's own (its
 * writer is the adapter, not an editor): the kind that should never have been
 * opened. It is neither listed nor handed out, nothing waits for it, and it is
 * ended in the background (`endOwnFileConflicts`).
 */
const isOwnFileConflict = (session: ConflictEditSession): boolean => session.writer === "adapter" && isOwnFile(session.originalPath);

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

/**
 * The adapter both shells hand out as "the vault": every read and write of the
 * app goes through it.
 *
 * Two rules about what a file IS hold here, for every caller at once (finding
 * 2026-10-11). `readTextFile` hands out a file's text or refuses the file — it
 * never hands out a reading of bytes that are not UTF-8 (`readExactText`). And
 * no text is written over a file that could not be read as one
 * (`NotTextFileError`): not an editor's save, not a property, not a link a
 * rename rewrites, not the draft of a conflict. Whoever means to replace such
 * a file — a restored version, a copy that takes its place — writes bytes.
 */
export class ConflictAwareVaultAdapter implements IVaultAdapter {
  private readonly sessions: ConflictSessions;
  constructor(
    private readonly inner: IVaultAdapter,
    private readonly syncRepo: Pick<SyncStateRepository, "getSyncState" | "getBaseText" | "updateLocalHash" | "updateLocalHashAndUnsyncedBaseText" | "getConflictSession" | "listConflictSessions" | "saveConflictSession" | "removeConflictSession" | "recordConflictDiagnostic" | "listConflictDiagnostics">,
    private readonly onAutoMerge?: (path: string, mergedText: string) => void,
    private readonly mutationScope: object = syncRepo,
    private readonly adapterKind = "local",
    /**
     * Told when a write through here turned line ends a file's shape does not
     * keep — a carriage return of its own — into `eol` (`textFileShape.ts`).
     * Every write of the app to a file the user sees passes this adapter — an
     * editor's save, a whole text (`writeTextFile`) and a change of a place
     * (`updateTextFile`) alike —, so this is the one place that turns them for
     * all of them (`keptLineEnds`) and says it; the shell tells the user. What
     * the app writes to its own files under `.plainva` is not the user's to be
     * told about, and a conflict's working copy is a draft: neither says
     * anything, and neither is turned here.
     */
    private readonly onLineEndsConverted?: (path: string, eol: TextFileShape["eol"]) => void
  ) { this.sessions = new ConflictSessions(inner, syncRepo, mutationScope); }

  /**
   * What a write leaves on disk where `before` lies. A carriage return of its
   * own is read and not kept (ADR 0003, addendum 2026-10-09, paragraph of
   * 2026-10-22): the first write that changes a file which has such line ends
   * leaves all of it with its shape's — also where the writer changed one place
   * and left every other line as it was, a property or a task's box. A text
   * that differs from such a file only in those line ends is no change, and the
   * file stays as it lies there. A new file (`before` null) and a text written
   * over a file without such line ends are written as they are handed in: a
   * version put back, an undo, a copy adopted give back the bytes they hold.
   */
  private keptLineEnds(before: string | null, after: string): string {
    if (before === null || !hasUnkeptLineEnds(before)) return after;
    if (after === before || after === withKeptLineEnds(before)) return before;
    return withKeptLineEnds(after);
  }

  /** Says so when `after` took the place of a file whose line ends its shape does not keep, and has none of them left. */
  private lineEndsWritten(path: string, before: string | null, after: string): void {
    if (!this.onLineEndsConverted || before === null || !hasUnkeptLineEnds(before) || hasUnkeptLineEnds(after)) return;
    // A notice must never be what fails a write that is already on disk.
    try { this.onLineEndsConverted(path, readTextShape(after).shape.eol); } catch (error) { console.warn("[ConflictAware] the line end notice failed", error); }
  }

  /**
   * The open conflict of a file, asked by its name or by its working copy's —
   * never one a version before 2026-10-20 left on an own file
   * (`isOwnFileConflict`), and such a conflict is not even touched: it is
   * looked up first (`conflictNamed`), before a step of the session would
   * carry out its resolution or write its draft.
   */
  async getConflictSession(path: string): Promise<ConflictEditSession | null> {
    if (isOwnFile(path)) {
      void this.endOwnFileConflicts();
      const kept = await this.conflictNamed(path);
      if (kept && isOwnFileConflict(kept)) return null;
    }
    return this.sessions.get(path);
  }

  /**
   * The open conflict a name belongs to, without a step of its session: the
   * file's own, or — only for a name that can be one — the conflict whose
   * working copy it is. An image or an attachment costs one lookup, not a read
   * of every open conflict.
   */
  private async conflictNamed(path: string): Promise<ConflictEditSession | null> {
    const key = conflictSessionKey(path);
    return await this.syncRepo.getConflictSession(key)
      ?? (key.includes(".CONFLICT-") ? (await this.sessions.list()).find(s => s.workingCopyPath === key) ?? null : null);
  }

  /** The open conflicts of the vault — never those a version before 2026-10-20 left on the app's own files (`isOwnFileConflict`). */
  async listConflictSessions(): Promise<ConflictEditSession[]> {
    void this.endOwnFileConflicts();
    return (await this.sessions.list()).filter(session => !isOwnFileConflict(session));
  }
  listConflictDiagnostics() { return this.syncRepo.listConflictDiagnostics(); }

  /**
   * Ends the conflicts a version before 2026-10-20 left on the app's own files
   * — once per adapter, so once per opened vault, in the background: started by
   * the first write of an own file and by the first look at the vault's
   * conflicts, and waited for by none of them. Until it is through, such a
   * conflict is neither listed nor handed out, and a write passes it by
   * (`takesOwnWay`).
   *
   * What the working copy holds is the text of a write that never reached the
   * file — reported as failed for a bookmark, dropped in silence for a pin —
   * and the file on disk is the one every surface has shown since. The file
   * stays, and a copy of the working copy is kept under
   * `.plainva/conflict-revisions/` (`ConflictSessions.release`) — unless a
   * resolution had been confirmed and not yet carried out: that is carried out
   * as confirmed. One that cannot be ended now stays as it is, and is tried
   * again the next time the vault is open. What was ended, how, and what was
   * not, the console says.
   */
  endOwnFileConflicts(): Promise<void> {
    return (this.ownFileConflictsEnded ??= this.sessions.release(isOwnFileConflict).then(({ setAside, carriedOut, failed }) => {
      if (setAside.length) console.info(`[ConflictAware] ended the conflict an older version left on ${setAside.join(", ")}; what it held is kept under .plainva/conflict-revisions`);
      if (carriedOut.length) console.info(`[ConflictAware] ended the conflict an older version left on ${carriedOut.join(", ")} as its confirmed resolution said`);
      if (failed.length) console.warn(`[ConflictAware] could not end the conflict an older version left on ${failed.join(", ")}; it is tried again next time`);
    }, (error) => {
      console.warn("[ConflictAware] the conflicts older versions left on the app's own files could not be read", error);
    }));
  }
  private ownFileConflictsEnded: Promise<void> | null = null;

  /**
   * Whether a write of the app's own takes the own file's way (see `isOwnFile`)
   * — asked inside the gate. Where a person's conflict is open at the file (an
   * editor's save, at a note in a folder a setting points into `.plainva`), the
   * way of any file is taken, so the person's version is not passed by.
   */
  private takesOwnWay(path: string, gate: ConflictSessionGate): boolean {
    return isOwnFile(path) && (!gate.session || isOwnFileConflict(gate.session));
  }

  /** The text of an own file as it lies there, or the refusal: no text over a file that is no text (see the class comment). */
  private async ownFileText(path: string): Promise<string | null> {
    return await this.inner.exists(path) ? readExactText(this.inner, path) : null;
  }

  /** A whole text over an own file, inside the gate: no comparison, no marker, no conflict. */
  private async writeOwnLocked(path: string, text: string): Promise<void> {
    await this.ownFileText(path);
    await this.inner.writeTextFile(path, text);
  }

  /** A change of an own file, inside the gate: made of the file as it lies there, written through the links below. `null` where `expected` is not what lies there. */
  private async updateOwnLocked(path: string, expected: string | null, next: (text: string) => string | null): Promise<TextFileUpdate | null> {
    const before = await this.ownFileText(path);
    if (before === null) throw new VaultFileNotFoundError(path);
    if (expected !== null && before !== expected) return null;
    const made = next(before);
    if (made === null || made === before) return { before, text: before, changed: false, conflict: null };
    await this.inner.writeTextFile(path, made);
    return { before, text: made, changed: true, conflict: null };
  }

  async preserveConflict(path: string, text: string, writer: ConflictWriter): Promise<ConflictEditSession> {
    const state = await this.syncRepo.getSyncState(path);
    return this.sessions.withMutation(path, async gate => this.preserveLocked(gate, path, text, state, writer));
  }

  private async preserveLocked(gate: ConflictSessionGate, path: string, text: string, state: SyncState | null, writer: ConflictWriter,
    diagnosticBase?: { text: string | null; source: "captured" | "backup" | "none" }, plain = false): Promise<ConflictEditSession> {
    // A conflict is kept between two texts. A file that is no text has no
    // draft beside it: the refusal reaches the caller before a session exists.
    const disk = await this.inner.exists(path) ? await readExactText(this.inner, path) : null;
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
      // The file as it lies there, or the refusal: an editor's text is merged
      // with a text and written over one, never over bytes in another
      // encoding that another program put there meanwhile.
      const disk = await this.inner.exists(path) ? await readExactText(this.inner, path) : null;
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
        candidate = this.keptLineEnds(disk, candidate);
        await this.inner.writeTextFile(path, candidate);
        // Said as soon as the file holds it: a step below that fails leaves the file turned all the same.
        this.lineEndsWritten(path, disk, candidate);
        const stored = await this.inner.readTextFile(path);
        if (!containsTextChanges(disk ?? "", candidate, stored)) throw new Error("The saved note could not be confirmed");
        const hash = await sha256Hash(stored);
        this.rememberWrite(path, hash);
        if (disk !== null) await this.syncRepo.updateLocalHash(path, hash);
        return { stored, session: null };
      }
      // A conflict this opens is the editor's, though it names no starting text (see `isOwnFileConflict`).
      try { await this.writeTextFileLocked(path, candidate, requestedState, gate, false, "editor-save"); }
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

  /** The way out of an open conflict whose file is no text any more — byte for byte (see `ConflictBytesResolution`). */
  async resolveConflictBytes(path: string, resolution: ConflictBytesResolution): Promise<void> {
    await this.sessions.resolveBytes(path, resolution);
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

  /**
   * The file's text, or `NotTextFileError` where its bytes are not UTF-8 —
   * with either kind of text reader below (see the class comment).
   */
  async readTextFile(path: string): Promise<string> {
    return readExactText(this.inner, path);
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
    // An own file: what an older version left there is ended in the background (`endOwnFileConflicts`).
    if (isOwnFile(path)) void this.endOwnFileConflicts();
    // Capture the base before waiting behind an incoming write. Its completion
    // advances sync_state, but cannot retroactively update the user's draft.
    const requestedState = isOwnFile(path) ? null : await this.syncRepo.getSyncState(path);
    return this.sessions.withMutation(path, async gate => {
      if (this.takesOwnWay(path, gate)) return this.writeOwnLocked(path, localContent);
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
    if (isOwnFile(path)) void this.endOwnFileConflicts();
    return this.sessions.withMutation(path, async gate => {
      if (this.takesOwnWay(path, gate)) return (await this.updateOwnLocked(path, null, change))!;
      const state = await this.stateLocked(path, gate);
      return this.applyLocked(path, gate, state, changeOf(state, change));
    });
  }

  /** `updateTextFile` in two steps, for a window that reaches this chain over a bus and cannot hand over a function: the read … */
  async readTextFileState(path: string): Promise<TextFileState> {
    if (isOwnFile(path)) void this.endOwnFileConflicts();
    return this.sessions.withMutation(path, async gate => this.takesOwnWay(path, gate)
      ? { text: await readExactText(this.inner, path), workingCopy: null }
      : this.stateLocked(path, gate));
  }

  /** … and the write — if the file, and the working copy of its conflict, still are what was read. `null` says they are not: read again. */
  async writeTextFileChange(path: string, expected: TextFileState, next: TextFileChange): Promise<TextFileUpdate | null> {
    if (isOwnFile(path)) void this.endOwnFileConflicts();
    return this.sessions.withMutation(path, async gate => {
      if (this.takesOwnWay(path, gate)) return expected.workingCopy === null ? this.updateOwnLocked(path, expected.text, () => next.text) : null;
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
    // The file's text, or the refusal: no change is handed a reading of bytes
    // that are not UTF-8, so none can write one back (see the class comment).
    const text = await readExactText(this.inner, path);
    return { text, workingCopy: gate.session ? await this.sessions.draftLocked(gate.session) : null };
  }

  private async applyLocked(path: string, gate: ConflictSessionGate, state: TextFileState, next: TextFileChange): Promise<TextFileUpdate> {
    const session = gate.session;
    if (session && this.namesWorkingCopy(path, gate)) {
      const changed = next.text !== null && next.text !== state.text;
      const text = changed ? next.text! : state.text;
      // The draft is what was read: the session's journal takes the new text as it takes an editor's.
      if (changed) await this.sessions.writeLocked(session, text, state.text);
      return { before: state.text, text, changed, conflict: { workingCopyPath: session.workingCopyPath, changed } };
    }
    // The file, in its shape's line ends where the change left a carriage
    // return of its own (`keptLineEnds`) — a change that only turned those is none.
    const text = next.text === null ? state.text : this.keptLineEnds(state.text, next.text);
    const changed = text !== state.text;
    if (changed) {
      // An ordinary write, as `writeTextFileLocked` makes one for a file nobody else touched.
      await this.inner.writeTextFile(path, text);
      this.lineEndsWritten(path, state.text, text);
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

  private async writeTextFileLocked(path: string, localContent: string, syncState: SyncState | null, gate: ConflictSessionGate, plain = false, writer: ConflictWriter = "adapter"): Promise<void> {
    const isNew = !(await this.inner.exists(path));
    if (isNew) {
      await this.inner.writeTextFile(path, localContent);
      // No sync_state here on purpose: the indexer announces the file as new
      // (and enqueues it for push) only while it has no row.
      this.rememberWrite(path, await sha256Hash(localContent));
      return;
    }

    // What lies there, with the hash `local_sha256` is compared with — the one
    // of the file's bytes (`readLocalText`). A file that is no text is not
    // written over with one, whoever asks: what the caller hands in was either
    // made from a reading of it, which is not the file, or made without
    // looking at it at all.
    const disk = await readLocalText(this.inner, path);
    if (!disk.exact) throw new NotTextFileError(path);
    const currentDiskContent = disk.text;
    const diskSha256 = disk.sha256;
    // The disk holds what we wrote last: not a foreign change, whatever the
    // stored hash claims (see `lastWritten`).
    const ownContent = this.wasWrittenByUs(path, diskSha256);

    // Nor is a file whose marker was taken of it by a reader that left its
    // byte order mark out (`isMarkerTakenWithoutMark`): the file on record, to
    // be written like any other. The write below records the hash of what it wrote.
    if (syncState && syncState.local_sha256 && syncState.local_sha256 !== diskSha256 && !ownContent
      && !(await isMarkerTakenWithoutMark({ text: currentDiskContent, sha256: diskSha256 }, syncState))) {
      // Self-heal a legacy byte-hash. The indexer used to hash non-.md text files (e.g.
      // `.base`) as raw bytes (sha256 of readBinaryFile), which can differ from the text
      // hash used here even when the file is byte-for-byte unchanged. If the stored hash
      // equals the byte hash of the *current* disk content, the file did NOT change
      // externally — adopt it and record a proper text hash instead of falsely
      // flagging a conflict on every save.
      //
      // Met until 2026-10-20 on iOS as well, where the phone's container
      // adapter handed a file out without its byte order mark while the sync
      // had recorded the hash of its bytes; a reader that does so would meet
      // it again. The text written here is a local change like any other: it
      // becomes the base only for a file no sync has seen (see
      // `updateLocalHashAndUnsyncedBaseText`). Written over a base the sync
      // recorded, it made the next change from another device replace this one.
      try {
        const diskBytes = await this.inner.readBinaryFile(path);
        if ((await sha256BytesHex(diskBytes)) === syncState.local_sha256) {
          const healed = this.keptLineEnds(currentDiskContent, localContent);
          await this.inner.writeTextFile(path, healed);
          this.lineEndsWritten(path, currentDiskContent, healed);
          const healedHash = await sha256Hash(healed);
          await this.syncRepo.updateLocalHashAndUnsyncedBaseText(path, healedHash, healed);
          this.rememberWrite(path, healedHash);
          return;
        }
      } catch {
        // readBinaryFile failed — fall through to the normal conflict handling below.
      }

      // External modification detected! Attempt 3-way merge.
      console.warn(`[ConflictAware] disk changed under us for ${path} (diskSha=${diskSha256.slice(0, 8)}, expected local=${syncState.local_sha256.slice(0, 8)}) -> attempting merge`);
      // The base on record is the version the marker names where the two hash
      // alike — or, for the base the sync recorded, where the marker was taken
      // of that version by a reader that left its byte order mark out
      // (`isHashWithoutMark`).
      const capturedBase = syncState.base_text;
      const capturedHash = capturedBase != null ? await sha256Hash(capturedBase) : null;
      const baseContent = capturedBase != null && (capturedHash === syncState.local_sha256
        || (capturedHash === syncState.base_sha256 && await isHashWithoutMark(capturedBase, syncState.local_sha256)))
        ? { text: capturedBase, source: "captured" as const } : await this.findBaseContent(path, syncState.local_sha256);
      if (baseContent === null) {
        const session = await this.preserveLocked(gate, path, localContent, syncState, writer, { text: null, source: "none" }, plain);
        throw new ConflictError(`Cannot automatically merge ${path}: base version not found. Saved locally as ${session.workingCopyPath}.`, session.workingCopyPath);
      }

      const mergeResult = mergeText(baseContent.text, localContent, currentDiskContent);
      if (mergeResult.hasConflicts) {
        const session = await this.preserveLocked(gate, path, localContent, syncState, writer, baseContent, plain);
        throw new ConflictError(`Cannot automatically merge ${path}: conflicting changes. Saved locally as ${session.workingCopyPath}.`, session.workingCopyPath);
      }
      
      // Auto-merge successful, save the merged content and update our expected local hash.
      const merged = this.keptLineEnds(currentDiskContent, mergeResult.mergedText);
      await this.inner.writeTextFile(path, merged);
      this.lineEndsWritten(path, currentDiskContent, merged);
      const mergedHash = await sha256Hash(merged);
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
      await this.syncRepo.updateLocalHashAndUnsyncedBaseText(path, mergedHash, merged);
      this.rememberWrite(path, mergedHash);
      // Notify listeners (e.g. the editor) so the in-memory view adopts the merged
      // content. Otherwise a subsequent save would overwrite the merge with stale,
      // pre-merge content and silently drop the external changes.
      this.onAutoMerge?.(path, merged);
    } else {
      // Normal write (no conflict). Update only the local marker; never advance the
      // merge base here, otherwise an unsynced local edit becomes the base and the
      // next pull would see "local == base" and drop the edit in favour of remote.
      const written = this.keptLineEnds(currentDiskContent, localContent);
      await this.inner.writeTextFile(path, written);
      this.lineEndsWritten(path, currentDiskContent, written);
      const writtenHash = await sha256Hash(written);
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
    // Bytes are not merged. Nor are they written into an open conflict — the
    // file and its working copy wait for the person's answer, and a version
    // put back or a copy taking the file's place would change a side of the
    // comparison under them (finding 2026-10-11). Moving and deleting are
    // refused there for the same reason; the conflict's own ways out write
    // below this adapter.
    return this.runExclusive(path, async () => {
      // A conflict an older version left on an own file waits for nobody (`isOwnFileConflict`).
      const session = await this.conflictNamed(path);
      if (session && !isOwnFileConflict(session)) throw new OpenConflictError(session.workingCopyPath);
      return this.inner.writeBinaryFile(path, content);
    });
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
    const session = (await this.sessions.list()).find(s => !isOwnFileConflict(s) && (affected(s.originalPath) || affected(s.workingCopyPath)));
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
