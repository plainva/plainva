import { isSnapshotBeforeDeleteError, type IVaultAdapter } from "./IVaultAdapter.js";
import { withPathMutation } from "./pathMutation.js";
import { mergeEditorText } from "../conflict-resolver.js";
import { copyFileContent, fileSha256, isNotTextFileError, readExactText } from "./localText.js";

export type ConflictWriter = "adapter" | "editor-save" | "editor-external" | "sync-pull";

/** Device-scoped state, excluded from Plainva sync and settings profiles. */
export interface ConflictEditSession {
  version: 1;
  originalPath: string;
  workingCopyPath: string;
  baseRevision: string | null;
  baseText: string | null;
  externalRevision: string | null;
  draftRevision: number;
  workingHash: string | null;
  draftText: string;
  pendingText: string | null;
  createdAt: number;
  writer: ConflictWriter;
  foreignCopySnapshot: string | null;
  /** Persisted before replacing the original; a restart must not resume editing its old copy. */
  resolution: { content: string; originalHash: string | null; copyHash: string; keepCopyAs?: string } | null;
  /**
   * The hash of the draft as a write WITHOUT a starting text left it
   * (`writePlainLocked`); `null` or absent as soon as anyone else has written
   * the draft. Only a draft that still is such a write's own text may be
   * replaced by the next one (finding 2026-10-12). Absent in a session an
   * older version wrote: that draft counts as somebody else's.
   */
  plainDraft?: string | null;
}

export interface ConflictDiagnostic {
  at: number;
  pathHash: string;
  adapter: string;
  writer: ConflictWriter;
  diskHash: string | null;
  expectedLocalHash: string | null;
  baseSource: "captured" | "backup" | "none";
  wasWrittenByUs: boolean;
  normalizationOnly: boolean;
  differentLineEndings: boolean;
  differentBom: boolean;
  differentFinalNewline: boolean;
}

export interface ConflictSessionStore {
  getConflictSession(path: string): Promise<ConflictEditSession | null>;
  listConflictSessions(): Promise<ConflictEditSession[]>;
  saveConflictSession(session: ConflictEditSession): Promise<void>;
  removeConflictSession(path: string): Promise<void>;
  recordConflictDiagnostic(diagnostic: ConflictDiagnostic): Promise<void>;
  listConflictDiagnostics(): Promise<ConflictDiagnostic[]>;
  updateLocalHash(path: string, hash: string): Promise<void>;
}

export interface EditorWriteResult {
  stored: string;
  session: ConflictEditSession | null;
}

export interface ConflictResolution {
  /** Exact snapshots seen by the comparison, including line endings. */
  originalText: string | null;
  copyText: string;
  content: string;
  disposition?: "adopt" | "discard";
  keepCopyAs?: string;
  /**
   * The copy the comparison looked at. Where it is no working copy of an open
   * conflict — a copy the sync left beside the file —, the chain settles it
   * in the same gate it checks it in (Sammelplan § 3.86 no. 8). Absent: the
   * file's open conflict, as before.
   */
  copyPath?: string;
  /**
   * Delete the copy even where no snapshot of it can be written first — the
   * person's "Delete anyway" to the question a `SnapshotBeforeDeleteError`
   * puts (D1). Only an exit that lets the copy's text go needs it: where the
   * copy takes the file's place or stays as a file of its own, its text is
   * kept, and the copy goes without one.
   */
  withoutSnapshot?: true;
}

/**
 * The answer to an open conflict whose two sides could not be compared as
 * text: another program turned the file into no text after the conflict
 * began (finding 2026-10-11). What the comparison saw is named by the hashes
 * of the bytes, since there was no text to name it by.
 */
export interface ConflictBytesResolution {
  /** SHA-256 of the file's bytes as the comparison saw them; null where it saw no file. */
  originalSha256: string | null;
  /** SHA-256 of the working copy's bytes as the comparison saw them. */
  copySha256: string;
  /**
   * "adopt": the working copy takes the file's place, byte for byte.
   * "discard": the file stays as it lies, and the working copy goes — or
   * stays beside it as a file of its own (`keepCopyAs`).
   */
  disposition: "adopt" | "discard";
  keepCopyAs?: string;
  /** As in `ConflictResolution`: a copy beside the file that is no working copy is settled in the gate it is checked in. */
  copyPath?: string;
  /** As in `ConflictResolution`. */
  withoutSnapshot?: true;
}

export interface ConflictSessionGate {
  session: ConflictEditSession | null;
  workingCopyPath: string;
}

export function conflictSessionKey(path: string): string {
  return path.replace(/\\/g, "/").normalize("NFC").split("/").filter(part => part !== ".").join("/");
}

function safePath(path: unknown): path is string {
  return typeof path === "string" && !!path && !/^[\\/]|^[a-z]:/i.test(path)
    && !Array.from(path).some(character => character.charCodeAt(0) < 32)
    && !path.replace(/\\/g, "/").split("/").some(part => part === ".." || !part);
}

/** Corrupt local state fails closed; it must never silently create a second session. */
export function decodeConflictSession(value: string): ConflictEditSession {
  const s = JSON.parse(value) as ConflictEditSession;
  const hash = (value: unknown) => value === null || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
  if (!s || s.version !== 1 || !safePath(s.originalPath) || !safePath(s.workingCopyPath)
    || !s.workingCopyPath.includes(".CONFLICT-") || s.workingCopyPath === s.originalPath
    || !Number.isSafeInteger(s.draftRevision) || s.draftRevision < 0
    || !Number.isFinite(s.createdAt) || s.createdAt < 0
    || !["adapter", "editor-save", "editor-external", "sync-pull"].includes(s.writer)
    || !hash(s.baseRevision) || !hash(s.externalRevision) || !hash(s.workingHash)
    || (s.baseText !== null && typeof s.baseText !== "string")
    || typeof s.draftText !== "string"
    || (s.pendingText !== null && typeof s.pendingText !== "string")
    || (s.plainDraft !== undefined && !hash(s.plainDraft))
    || (s.foreignCopySnapshot !== null && (!safePath(s.foreignCopySnapshot) || !s.foreignCopySnapshot.startsWith(".plainva/conflict-revisions/")))
    || (s.resolution !== null && (!s.resolution || typeof s.resolution.content !== "string"
      || !hash(s.resolution.originalHash) || !s.resolution.copyHash || !hash(s.resolution.copyHash)
      || (s.resolution.keepCopyAs !== undefined && !safePath(s.resolution.keepCopyAs))))) throw new Error("Invalid conflict session state");
  return s;
}

/**
 * What a file of a conflict holds where its bytes are no UTF-8 — the working
 * copy or the file, saved in another encoding by another program since
 * (Sammelplan § 3.86 no. 6). The sessions read their files by their bytes
 * (`readExactText`): such a file is set aside byte for byte, and it is no
 * text any comparison saw.
 */
const NOT_TEXT: unique symbol = Symbol("not text");
type SideText = string | null | typeof NOT_TEXT;

/** The hash a side is compared by: a text's, none for a missing file, and one no text has for a file that is no text. */
const sideHash = async (side: SideText): Promise<string | null> =>
  side === null ? null : side === NOT_TEXT ? "not text" : conflictHash(side);

export async function conflictHash(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function conflictDiagnostic(input: {
  path: string; adapter: string; writer: ConflictWriter; disk: string | null;
  expectedLocalHash: string | null; base: string | null;
  baseSource: ConflictDiagnostic["baseSource"]; wasWrittenByUs: boolean;
}): Promise<ConflictDiagnostic> {
  const canonical = (text: string) => text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const { disk, base } = input;
  return {
    at: Date.now(), pathHash: await conflictHash(input.path), adapter: input.adapter, writer: input.writer,
    diskHash: disk === null ? null : await conflictHash(disk), expectedLocalHash: input.expectedLocalHash,
    baseSource: input.baseSource, wasWrittenByUs: input.wasWrittenByUs,
    normalizationOnly: disk !== null && base !== null && disk !== base && canonical(disk) === canonical(base),
    differentLineEndings: disk !== null && base !== null && /\r/.test(disk) !== /\r/.test(base),
    differentBom: disk !== null && base !== null && disk.startsWith("\uFEFF") !== base.startsWith("\uFEFF"),
    differentFinalNewline: disk !== null && base !== null && /\r?\n$/.test(disk) !== /\r?\n$/.test(base),
  };
}

/** A durable local draft plus one atomic gate for its original and working file. */
export class ConflictSessions {
  constructor(private readonly files: IVaultAdapter, private readonly store: ConflictSessionStore, private readonly scope: object) {}

  async withMutation<T>(path: string, action: (gate: ConflictSessionGate) => Promise<T>, extraPaths: string[] = []): Promise<T> {
    path = conflictSessionKey(path);
    if (!safePath(path)) throw new Error("Invalid conflict original path");
    if (path.includes(".CONFLICT-")) {
      const original = (await this.store.listConflictSessions()).find(session => session.workingCopyPath === path)?.originalPath;
      if (original) path = original;
    }
    // A session can appear while we wait. Release and acquire its actual working
    // path with the original, rather than taking a second lock inside the first.
    const retry = Symbol("conflict-session-changed");
    for (;;) {
      const known = await this.store.getConflictSession(path);
      const ext = path.match(/(\.[^./]+)$/)?.[1] ?? "";
      const workingCopyPath = known?.workingCopyPath ?? `${ext ? path.slice(0, -ext.length) : path}.CONFLICT-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}${ext}`;
      const keepPath = known?.resolution?.keepCopyAs;
      const result = await withPathMutation(this.scope, [path, workingCopyPath, ...extraPaths, ...(keepPath ? [keepPath] : [])], async () => {
        const current = await this.store.getConflictSession(path);
        if (current && (current.workingCopyPath !== workingCopyPath || current.resolution?.keepCopyAs !== keepPath)) return retry;
        return action({ session: current, workingCopyPath });
      });
      if (result !== retry) return result as T;
    }
  }

  async get(path: string): Promise<ConflictEditSession | null> {
    return this.withMutation(path, async gate => {
      if (gate.session?.resolution) { await this.finishResolution(gate.session); return null; }
      if (gate.session) await this.recoverDraft(gate.session);
      return gate.session;
    });
  }

  list(): Promise<ConflictEditSession[]> { return this.store.listConflictSessions(); }

  /**
   * Ends conflicts that should never have been opened — the ones the
   * conflict-aware adapter left on the app's own files (`ends` says which).
   * The file stays as it is on disk. What the conflict holds is not lost: its
   * draft is first put in the working copy, as every step of a session does
   * (`recoverDraft`; a working copy another program changed is set aside as
   * well), a copy of the working copy is kept under
   * `.plainva/conflict-revisions/`, where the sessions keep the versions they
   * set aside, and only once that copy reads back the same are the working
   * copy and the session removed. A resolution that had been confirmed and not
   * yet carried out is carried out instead, as confirmed; where the files
   * changed since, the conflict is ended as above.
   *
   * Any other failure leaves the session for the next time: a copy made before
   * it stays where it is, and a resolution half carried out is finished then.
   * Answers which conflicts were ended with their working copy set aside,
   * which by their confirmed resolution, and which could not be ended.
   */
  async release(ends: (session: ConflictEditSession) => boolean): Promise<{ setAside: string[]; carriedOut: string[]; failed: string[] }> {
    const setAside: string[] = [];
    const carriedOut: string[] = [];
    const failed: string[] = [];
    for (const listed of await this.store.listConflictSessions()) {
      if (!ends(listed)) continue;
      try {
        await this.withMutation(listed.originalPath, async gate => {
          const session = gate.session;
          if (!session || !ends(session)) return;
          if (session.resolution) {
            try {
              await this.finishResolution(session);
              carriedOut.push(session.originalPath);
              return;
            } catch (error) {
              // Only new evidence ends it below; a write that failed is tried again next time.
              if (!(error instanceof Error && error.message === "comparisonChanged")) throw error;
            }
          }
          await this.recoverDraft(session);
          const name = session.workingCopyPath.slice(session.workingCopyPath.lastIndexOf("/") + 1);
          const kept = `.plainva/conflict-revisions/${crypto.randomUUID()}-${name}`;
          await copyFileContent(this.files, session.workingCopyPath, kept);
          if (await fileSha256(this.files, kept) !== await fileSha256(this.files, session.workingCopyPath)) throw new Error("The working copy could not be kept");
          // Kept, checked, under `kept`: the copy needs no snapshot of its own to go (D1).
          await this.files.deleteItem(session.workingCopyPath, false, { confirmed: true, withoutSnapshot: true });
          await this.store.removeConflictSession(session.originalPath);
          setAside.push(session.originalPath);
        });
      } catch {
        failed.push(listed.originalPath);
      }
    }
    return { setAside, carriedOut, failed };
  }

  /**
   * Preserving an observed version never overwrites a newer editor draft.
   * `plain` says the text comes from a write that named no starting text
   * (`writeTextFile`): the draft it opens is that writer's own, and its next
   * write may replace it (`writePlainLocked`).
   */
  async preserveLocked(gate: ConflictSessionGate, input: {
    path: string; text: string; base: string | null; external: string | null; writer: ConflictWriter;
    diagnostic?: ConflictDiagnostic; plain?: boolean;
  }): Promise<ConflictEditSession> {
    if (gate.session) {
      if (gate.session.resolution) throw new Error("Conflict resolution is still being completed");
      await this.recoverDraft(gate.session);
      return gate.session;
    }
    if (await this.files.exists(gate.workingCopyPath)) throw new Error("Conflict working path already exists");
    const session: ConflictEditSession = {
      version: 1, originalPath: conflictSessionKey(input.path), workingCopyPath: gate.workingCopyPath,
      baseRevision: input.base === null ? null : await conflictHash(input.base), baseText: input.base,
      externalRevision: input.external === null ? null : await conflictHash(input.external),
      draftRevision: 1, workingHash: null, draftText: input.text, pendingText: input.text, createdAt: Date.now(), writer: input.writer,
      foreignCopySnapshot: null, resolution: null, plainDraft: input.plain ? await conflictHash(input.text) : null,
    };
    // Journal first. Failure to create the file leaves the entire input recoverable.
    await this.store.saveConflictSession(session); gate.session = session;
    if (input.diagnostic) await this.store.recordConflictDiagnostic(input.diagnostic);
    await this.recoverDraft(session);
    return session;
  }

  async writeLocked(session: ConflictEditSession, text: string, baseText: string | null = null): Promise<ConflictEditSession> {
    if (session.resolution) throw new Error("Conflict resolution is still being completed");
    await this.recoverDraft(session);
    if (baseText !== null && baseText !== session.draftText && text !== session.draftText) {
      const merged = mergeEditorText(baseText, text, session.draftText);
      if (merged.hasConflicts) await this.preserveRevision(session, session.draftText);
      // The merge decides the shape, as in the adapter's own merge.
      else text = merged.mergedText;
    }
    // Whoever writes here knows the draft: it is no longer the text a write
    // without a starting text left behind (see `writePlainLocked`).
    if (text !== session.draftText) session.plainDraft = null;
    session.draftRevision++;
    session.draftText = text;
    session.pendingText = text;
    await this.store.saveConflictSession(session);
    await this.recoverDraft(session);
    return session;
  }

  /**
   * The draft the journal holds for this conflict — asked inside its gate
   * (this takes none), after a write of the draft failed half way: the journal
   * is written before the working copy, so it may hold what the file does not
   * yet, and the session's next step then writes it there.
   */
  async journaledDraft(session: ConflictEditSession): Promise<string | null> {
    return (await this.store.getConflictSession(session.originalPath))?.draftText ?? null;
  }

  /** The draft of an open conflict as it stands — the user's own version of the file — read inside its gate. */
  async draftLocked(session: ConflictEditSession): Promise<string> {
    if (session.resolution) throw new Error("Conflict resolution is still being completed");
    await this.recoverDraft(session);
    return session.draftText;
  }

  /**
   * A write that names no text it started from, into a file with an open
   * conflict (finding 2026-10-12). Answers whether the draft now holds `text`.
   *
   * It used to replace the draft, whatever the draft was. A writer of that
   * kind read the file itself — which carries the OTHER side while a conflict
   * is open — or holds a text from before; put in place of the draft, its text
   * took the user's own version away, and only a snapshot older than the
   * versions layer's interval still had it.
   *
   * So the draft is replaced only where it still is what such a write left
   * there: then it is that writer's own, older text, and the new one follows
   * it. Any other draft stays, and nothing is written.
   */
  async writePlainLocked(session: ConflictEditSession, text: string): Promise<boolean> {
    if (session.resolution) throw new Error("Conflict resolution is still being completed");
    await this.recoverDraft(session);
    if (text === session.draftText) return true;
    if (!session.plainDraft || session.plainDraft !== await conflictHash(session.draftText)) return false;
    session.draftRevision++;
    session.draftText = text;
    session.pendingText = text;
    session.plainDraft = await conflictHash(text);
    await this.store.saveConflictSession(session);
    await this.recoverDraft(session);
    return true;
  }

  private async recoverDraft(session: ConflictEditSession): Promise<void> {
    if (session.pendingText === null) {
      const current = await this.readOrNull(session.workingCopyPath);
      if (typeof current === "string" && await conflictHash(current) === session.workingHash) return;
      // Keep our last confirmed text through a foreign overwrite or missing
      // working file, including when no editor remained alive to hold it.
      session.pendingText = session.draftText;
      await this.store.saveConflictSession(session);
    }
    const targetHash = await conflictHash(session.pendingText);
    const disk = await this.readOrNull(session.workingCopyPath);
    const diskHash = await sideHash(disk);
    if (disk === NOT_TEXT) {
      // Saved in another encoding by another program (§ 3.86 no. 6): set
      // aside as the bytes it is. A reading of it is not what was there — the
      // one kind of reader replaces those bytes, the other refuses the file,
      // and the session stopped at it.
      await this.preserveBytes(session);
    } else if (diskHash !== session.workingHash && diskHash !== targetHash && disk !== null) {
      // A genuinely foreign working-copy change is another conflict, not an
      // autosave retry. Preserve its bytes before replaying the journal.
      await this.preserveRevision(session, disk);
    }
    if (diskHash !== targetHash) await this.files.writeTextFile(session.workingCopyPath, session.pendingText);
    if (await this.files.readTextFile(session.workingCopyPath) !== session.pendingText) throw new Error("Conflict draft could not be confirmed");
    session.workingHash = targetHash; session.pendingText = null;
    await this.store.saveConflictSession(session);
  }

  /**
   * A working copy that is no text by its bytes, set aside byte for byte
   * beside the revisions `preserveRevision` keeps, under its own name.
   */
  private async preserveBytes(session: ConflictEditSession): Promise<void> {
    const bytes = await this.files.readBinaryFile(session.workingCopyPath);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
    const sha = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (session.foreignCopySnapshot && await fileSha256(this.files, session.foreignCopySnapshot) === sha) return;
    const name = session.workingCopyPath.slice(session.workingCopyPath.lastIndexOf("/") + 1);
    const snapshot = `.plainva/conflict-revisions/${crypto.randomUUID()}-${name}`;
    await this.files.writeBinaryFile(snapshot, bytes);
    if (await fileSha256(this.files, snapshot) !== sha) throw new Error("Foreign conflict copy could not be preserved");
    session.foreignCopySnapshot = snapshot;
    await this.store.saveConflictSession(session);
  }

  private async preserveRevision(session: ConflictEditSession, text: string): Promise<void> {
    if (session.foreignCopySnapshot && await this.readOrNull(session.foreignCopySnapshot) === text) return;
    const snapshot = `.plainva/conflict-revisions/${crypto.randomUUID()}.md`;
    await this.files.writeTextFile(snapshot, text);
    if (await this.files.readTextFile(snapshot) !== text) throw new Error("Foreign conflict copy could not be preserved");
    session.foreignCopySnapshot = snapshot;
    await this.store.saveConflictSession(session);
  }

  async resolve(path: string, resolution: ConflictResolution): Promise<void> {
    await this.withMutation(path, gate => this.resolveLocked(gate, resolution), resolution.keepCopyAs ? [resolution.keepCopyAs] : []);
  }

  /** `resolve` inside a gate the caller holds — for the file, its working copy and `keepCopyAs`. */
  async resolveLocked(gate: ConflictSessionGate, resolution: ConflictResolution): Promise<void> {
    const session = gate.session;
    if (!session) throw new Error("Conflict session no longer exists");
    if (session.resolution) { await this.finishResolution(session, resolution.withoutSnapshot); return; }
    await this.recoverDraft(session);
    // Read by their bytes: a side another program saved in another encoding
    // is no text the comparison saw (§ 3.86 no. 6), and says so as such.
    const original = await this.readOrNull(session.originalPath);
    const copy = await this.readOrNull(session.workingCopyPath);
    if (original !== resolution.originalText || copy !== resolution.copyText) throw new Error("comparisonChanged");
    const seenOriginal = original as string | null, seenCopy = copy as string;
    if (resolution.keepCopyAs && (!safePath(resolution.keepCopyAs) || await this.files.exists(resolution.keepCopyAs))) throw new Error("comparisonChanged");
    const content = resolution.disposition === "discard" ? seenOriginal : resolution.content;
    if (content === null) throw new Error("Cannot discard a conflict whose original is missing");
    session.resolution = { content, originalHash: seenOriginal === null ? null : await conflictHash(seenOriginal), copyHash: await conflictHash(seenCopy), ...(resolution.keepCopyAs ? { keepCopyAs: resolution.keepCopyAs } : {}) };
    await this.store.saveConflictSession(session);
    await this.finishResolution(session, resolution.withoutSnapshot);
  }

  /**
   * Ends an open conflict whose file is no text any more (see
   * `ConflictBytesResolution`). `resolve` compares two texts and writes one,
   * and this file has none: here the answer goes byte for byte, and only if
   * both files still are what the comparison saw. The working copy — the
   * user's own text — takes the file's place; or the file stays and the
   * working copy goes, or stays beside it under a name of its own.
   */
  async resolveBytes(path: string, resolution: ConflictBytesResolution): Promise<void> {
    await this.withMutation(path, gate => this.resolveBytesLocked(gate, resolution), resolution.keepCopyAs ? [resolution.keepCopyAs] : []);
  }

  /** `resolveBytes` inside a gate the caller holds. */
  async resolveBytesLocked(gate: ConflictSessionGate, resolution: ConflictBytesResolution): Promise<void> {
    const session = gate.session;
    if (!session) throw new Error("Conflict session no longer exists");
    if (session.resolution) throw new Error("Conflict resolution is still being completed");
    await this.recoverDraft(session);
    const original = await fileSha256(this.files, session.originalPath);
    const copy = await fileSha256(this.files, session.workingCopyPath);
    if (original !== resolution.originalSha256 || copy === null || copy !== resolution.copySha256) throw new Error("comparisonChanged");
    // Letting the copy go where no file is left would leave nothing at all.
    if (resolution.disposition === "discard" && !resolution.keepCopyAs && original === null) throw new Error("Cannot discard a conflict whose original is missing");
    if (resolution.keepCopyAs && (resolution.disposition !== "discard" || !safePath(resolution.keepCopyAs) || await this.files.exists(resolution.keepCopyAs))) {
      throw new Error("comparisonChanged");
    }
    if (resolution.disposition === "adopt") {
      await copyFileContent(this.files, session.workingCopyPath, session.originalPath);
      if (await fileSha256(this.files, session.originalPath) !== copy) throw new Error("Conflict resolution could not be confirmed");
      // The local marker follows the write in the same gate, as in
      // `finishResolution`; the sync base stays the last confirmed remote one.
      await this.store.updateLocalHash(session.originalPath, copy);
      // The copy's bytes are the file's now, checked above: it goes without a snapshot of its own (D1).
      await this.files.deleteItem(session.workingCopyPath, false, { confirmed: true, withoutSnapshot: true });
    } else if (resolution.keepCopyAs) {
      await this.files.renameItem(session.workingCopyPath, resolution.keepCopyAs);
    } else {
      // Its bytes go: only with a net, or after the person's "Delete anyway" (D1).
      await this.files.deleteItem(session.workingCopyPath, false, { confirmed: true, ...(resolution.withoutSnapshot ? { withoutSnapshot: true as const } : {}) });
    }
    await this.store.removeConflictSession(session.originalPath);
  }

  /**
   * Carries out a confirmed resolution. The working copy goes last, through
   * the net rule of a deletion (D1): where its text is kept — it took the
   * file's place, or stays as a file of its own — it goes without a snapshot;
   * where it is let go, only with one, or with the person's `withoutSnapshot`.
   * Where neither is there (`SnapshotBeforeDeleteError`) and nothing was
   * written yet, the confirmation is taken back, so that the question can be
   * answered and the comparison asked again; where the file was written, the
   * resolution stays, and the next attempt only lets the copy go.
   */
  private async finishResolution(session: ConflictEditSession, withoutSnapshot?: true): Promise<void> {
    const resolution = session.resolution!;
    // By their bytes (§ 3.86 no. 6): a side saved in another encoding since
    // has a hash no text has, so the confirmation no longer holds — where it
    // used to be a reading (the one kind of reader) or a raw error the session
    // stopped at each time it was looked at (the other).
    const original = await this.readOrNull(session.originalPath);
    const originalHash = await sideHash(original);
    const desiredHash = await conflictHash(resolution.content);
    const copy = await this.readOrNull(session.workingCopyPath);
    if ((originalHash !== desiredHash && originalHash !== resolution.originalHash)
      || (copy !== null && await sideHash(copy) !== resolution.copyHash)) {
      // New evidence invalidates the old confirmation. Keep the draft and
      // allow a fresh comparison instead of trapping the session in recovery.
      session.resolution = null;
      await this.store.saveConflictSession(session);
      throw new Error("comparisonChanged");
    }
    if (resolution.keepCopyAs) {
      const kept = await this.readOrNull(resolution.keepCopyAs);
      if (kept === null && typeof copy === "string") await this.files.writeTextFile(resolution.keepCopyAs, copy);
      if (await sideHash(await this.readOrNull(resolution.keepCopyAs)) !== resolution.copyHash) throw new Error("comparisonChanged");
    }
    const wrote = originalHash !== desiredHash;
    if (wrote) await this.files.writeTextFile(session.originalPath, resolution.content);
    if (await this.files.readTextFile(session.originalPath) !== resolution.content) throw new Error("Conflict resolution could not be confirmed");
    // Keep the local marker in the same gate as the write, including recovery.
    // The sync base still belongs to the last confirmed remote revision.
    await this.store.updateLocalHash(session.originalPath, desiredHash);
    if (copy !== null) {
      // Kept where it took the file's place or stays as a file of its own (both checked above).
      const kept = Boolean(resolution.keepCopyAs) || desiredHash === resolution.copyHash;
      try {
        await this.files.deleteItem(session.workingCopyPath, false, { confirmed: true, ...(kept || withoutSnapshot ? { withoutSnapshot: true as const } : {}) });
      } catch (error) {
        if (isSnapshotBeforeDeleteError(error) && !wrote) {
          session.resolution = null;
          await this.store.saveConflictSession(session);
        }
        throw error;
      }
    }
    await this.store.removeConflictSession(session.originalPath);
  }

  /**
   * A file of the conflict: its text, null where none lies there, `NOT_TEXT`
   * where its bytes are no UTF-8 (§ 3.86 no. 6). Asked of the bytes, not of
   * the name and the platform's text reader, which replaces such bytes on the
   * one platform and refuses the file on the other.
   */
  private async readOrNull(path: string): Promise<SideText> {
    if (!await this.files.exists(path)) return null;
    try {
      return await readExactText(this.files, path);
    } catch (error) {
      if (isNotTextFileError(error)) return NOT_TEXT;
      throw error;
    }
  }
}
