import type { IVaultAdapter } from "./IVaultAdapter.js";
import { withPathMutation } from "./pathMutation.js";
import { mergeEditorText } from "../conflict-resolver.js";

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
    || (s.foreignCopySnapshot !== null && (!safePath(s.foreignCopySnapshot) || !s.foreignCopySnapshot.startsWith(".plainva/conflict-revisions/")))
    || (s.resolution !== null && (!s.resolution || typeof s.resolution.content !== "string"
      || !hash(s.resolution.originalHash) || !s.resolution.copyHash || !hash(s.resolution.copyHash)
      || (s.resolution.keepCopyAs !== undefined && !safePath(s.resolution.keepCopyAs))))) throw new Error("Invalid conflict session state");
  return s;
}

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

  /** Preserving an observed version never overwrites a newer editor draft. */
  async preserveLocked(gate: ConflictSessionGate, input: {
    path: string; text: string; base: string | null; external: string | null; writer: ConflictWriter;
    diagnostic?: ConflictDiagnostic;
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
      foreignCopySnapshot: null, resolution: null,
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
    session.draftRevision++;
    session.draftText = text;
    session.pendingText = text;
    await this.store.saveConflictSession(session);
    await this.recoverDraft(session);
    return session;
  }

  private async recoverDraft(session: ConflictEditSession): Promise<void> {
    if (session.pendingText === null) {
      const current = await this.readOrNull(session.workingCopyPath);
      if (current !== null && await conflictHash(current) === session.workingHash) return;
      // Keep our last confirmed text through a foreign overwrite or missing
      // working file, including when no editor remained alive to hold it.
      session.pendingText = session.draftText;
      await this.store.saveConflictSession(session);
    }
    const targetHash = await conflictHash(session.pendingText);
    const disk = await this.readOrNull(session.workingCopyPath);
    const diskHash = disk === null ? null : await conflictHash(disk);
    if (diskHash !== session.workingHash && diskHash !== targetHash && disk !== null) {
      // A genuinely foreign working-copy change is another conflict, not an
      // autosave retry. Preserve its bytes before replaying the journal.
      await this.preserveRevision(session, disk);
    }
    if (diskHash !== targetHash) await this.files.writeTextFile(session.workingCopyPath, session.pendingText);
    if (await this.files.readTextFile(session.workingCopyPath) !== session.pendingText) throw new Error("Conflict draft could not be confirmed");
    session.workingHash = targetHash; session.pendingText = null;
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
    await this.withMutation(path, async gate => {
      const session = gate.session;
      if (!session) throw new Error("Conflict session no longer exists");
      if (session.resolution) { await this.finishResolution(session); return; }
      await this.recoverDraft(session);
      const original = await this.readOrNull(session.originalPath);
      const copy = await this.readOrNull(session.workingCopyPath);
      if (original !== resolution.originalText || copy !== resolution.copyText) throw new Error("comparisonChanged");
      if (resolution.keepCopyAs && (!safePath(resolution.keepCopyAs) || await this.files.exists(resolution.keepCopyAs))) throw new Error("comparisonChanged");
      const content = resolution.disposition === "discard" ? original : resolution.content;
      if (content === null) throw new Error("Cannot discard a conflict whose original is missing");
      session.resolution = { content, originalHash: original === null ? null : await conflictHash(original), copyHash: await conflictHash(copy!), ...(resolution.keepCopyAs ? { keepCopyAs: resolution.keepCopyAs } : {}) };
      await this.store.saveConflictSession(session);
      await this.finishResolution(session);
    }, resolution.keepCopyAs ? [resolution.keepCopyAs] : []);
  }

  private async finishResolution(session: ConflictEditSession): Promise<void> {
    const resolution = session.resolution!;
    const original = await this.readOrNull(session.originalPath);
    const originalHash = original === null ? null : await conflictHash(original);
    const desiredHash = await conflictHash(resolution.content);
    const copy = await this.readOrNull(session.workingCopyPath);
    if ((originalHash !== desiredHash && originalHash !== resolution.originalHash)
      || (copy !== null && await conflictHash(copy) !== resolution.copyHash)) {
      // New evidence invalidates the old confirmation. Keep the draft and
      // allow a fresh comparison instead of trapping the session in recovery.
      session.resolution = null;
      await this.store.saveConflictSession(session);
      throw new Error("comparisonChanged");
    }
    if (resolution.keepCopyAs) {
      const kept = await this.readOrNull(resolution.keepCopyAs);
      if (kept === null && copy !== null) await this.files.writeTextFile(resolution.keepCopyAs, copy);
      if (await conflictHash(await this.files.readTextFile(resolution.keepCopyAs)) !== resolution.copyHash) throw new Error("comparisonChanged");
    }
    if (originalHash !== desiredHash) await this.files.writeTextFile(session.originalPath, resolution.content);
    if (await this.files.readTextFile(session.originalPath) !== resolution.content) throw new Error("Conflict resolution could not be confirmed");
    // Keep the local marker in the same gate as the write, including recovery.
    // The sync base still belongs to the last confirmed remote revision.
    await this.store.updateLocalHash(session.originalPath, desiredHash);
    if (copy !== null) await this.files.deleteItem(session.workingCopyPath, false, { confirmed: true });
    await this.store.removeConflictSession(session.originalPath);
  }

  private async readOrNull(path: string): Promise<string | null> {
    return await this.files.exists(path) ? this.files.readTextFile(path) : null;
  }
}
