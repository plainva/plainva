import type { CommentDecisionProof } from "./commentDecisions.js";
/**
 * The one contract every comment surface talks to (Nachschaerfung, N0).
 *
 * Two storage paths exist and stay: the sealed one (signed objects inside an
 * encrypted workspace) and the open one (the sideband bundle of a plain
 * vault). Before this module the choice between them was written twelve times
 * - six `if (!workspaceSecurityStatus)` forks on the desktop, six independently
 * worded ones on the phone - and there was no shared shape either side had to
 * satisfy. A field the open path could not fill honestly (`targetRevisionId`,
 * the operation hashes) sat in the record anyway, and any new surface that
 * read one broke the plain vault silently.
 *
 * So: ONE interface, chosen ONCE per vault. The open store lives here in the
 * core, because nothing in it is shell-specific; the sealed store likewise
 * receives its captured runtime and worker from the shell.
 * The KI harness (v4) writes its proposals through the same `post`, with an
 * explicit author - which is why `CommentPostInput.author` exists before
 * anything uses it.
 */
import type { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { WorkspaceCapability } from "../workspace/documents.js";
import type { WorkspaceCommentAnchor } from "../workspace/commentAnchor.js";
import type { WorkspaceCommentRecord } from "../workspace/state.js";
import { createWorkspaceObjectId } from "../workspace/identity.js";
import { commentWriteIdentity, type CommentWriteIdentity } from "./commentIdentity.js";
import { appendLocalComment, appendLocalMoves, readAllComments, type CommentBundleFault, type CommentsCrypto } from "./CommentsSyncStep.js";
import { commentPathsToCheck, localCommentAuthorNames, localCommentsByPath, localCommentsForPath, type CommentsBundle, type LocalCommentRecord, type LocalMoveRecord } from "./commentsBundle.js";

/**
 * How a store can hold comments right now.
 *
 * `plain` and `sealed` are the two shapes of the open path; `locked` is the
 * open path on a device that holds the vault's keyfile but no unlocked master
 * key - it must neither read the sealed bundle nor write a plaintext one beside
 * it (D4). `workspace` is the sealed path of an encrypted workspace.
 */
export type CommentStoreMode = "plain" | "sealed" | "locked" | "workspace";

export interface CommentStoreState {
  mode: CommentStoreMode;
  /**
   * Whether this store queues outgoing remarks. Only such a store ever lists a
   * `pending` record, so only there do retry/discard mean anything - the cards
   * hide those two buttons on this flag, not on the accident that a bundle
   * store never happens to return `pending`.
   */
  hasOutbox: boolean;
}

/** A named author acting through this device - the KI harness writes `plainva-ai/<model>` here (v4). */
export interface CommentAuthor {
  /** Stable id the surface keys names and "is this mine?" by. */
  id: string;
  /** What to show for that id; omitted keeps whatever name the id already carries. */
  displayName?: string | null;
}

export interface CommentPostInput {
  /** Present for a durable operation; repeating it cannot append a second marker. */
  identity?: CommentWriteIdentity;
  /** Captured workspace identity; remains valid when the note changes its path. */
  targetObjectId?: string;
  decisionProof?: CommentDecisionProof | null;
  path: string;
  body: string;
  parentCommentId?: string | null;
  /** Set on a resolution marker: the thread it closes. */
  resolvedCommentId?: string | null;
  anchor?: WorkspaceCommentAnchor | null;
  suggestion?: { replacement: string } | null;
  suggestionOutcome?: "applied" | "declined" | null;
  /** A retraction marker (K7): deletes the record it names, if this device wrote that record. */
  retractsCommentId?: string | null;
  /** The proposal round (Vorschlagsmodus), on proposals only. */
  batch?: { batchId: string; index: number; note: string | null } | null;
  /**
   * Who writes it. Absent: the person at this keyboard, signed with the name
   * the store was given. Present: a named author acting through this device.
   * The device stays the record's writer either way - deleting an assistant's
   * proposal is the person's right, so a retraction is judged by the device.
   */
  author?: CommentAuthor | null;
}

/** A note or folder that changed its path - what the rename paths of both shells report (N1). */
export interface CommentPathMove {
  from: string;
  to: string;
  /** A folder: every path under `from` moved with it. */
  folder?: boolean;
}

/** Thrown by `post` on a locked device. The surface explains instead of failing silently (N3). */
export class CommentStoreLockedError extends Error {
  constructor() {
    super("comment-store-locked");
    this.name = "CommentStoreLockedError";
  }
}

export interface CommentStore {
  state(): Promise<CommentStoreState>;
  /** What this device may do with `path`; null switches the surface off entirely. */
  capabilities(path: string): Promise<WorkspaceCapability[] | null>;
  list(path: string): Promise<WorkspaceCommentRecord[]>;
  /** Every note that carries comments, for the vault-wide overview. */
  listAll(): Promise<Map<string, WorkspaceCommentRecord[]>>;
  /** author id -> display name. Never a claim about anyone else than what they said. */
  authors(): Promise<Map<string, string>>;
  /** Who this device is as an author - the member id in a workspace, the device id otherwise. */
  selfId(): Promise<string | null>;
  post(input: CommentPostInput): Promise<void>;
  /** A queued remark that failed to publish: try again now. A store without an outbox has nothing to retry. */
  retry(outboxId: string): Promise<void>;
  discard(outboxId: string): Promise<void>;
  /**
   * A note or folder moved (N1): the store keeps its remarks with the note.
   * Called AFTER the rename succeeded; a failure here leaves the rename
   * standing and is reported, never undone. A store that addresses by object
   * id has nothing to do.
   */
  recordMoves(moves: readonly CommentPathMove[]): Promise<void>;
}

/**
 * What a device may do with comments in a vault without a workspace.
 *
 * Deliberately not the workspace owner's set: a plain vault has no policy, so
 * there is nobody to grant `content.publish` or `member.manage` to. These four
 * are exactly what the comment surface asks for - read the note, write it (for
 * accepting a suggestion), and read and write comments.
 */
export const BUNDLE_COMMENT_CAPABILITIES: readonly WorkspaceCapability[] = [
  "content.read",
  "content.write",
  "comment.read",
  "comment.create",
];

/**
 * How the open path can store comments right now - the same three states on
 * both shells, for the same reason: with a keyfile in the vault the bundle is
 * sealed, and a device that cannot seal must NOT write the plaintext variant
 * beside it. The merge is a union, so convergence is not the danger - the
 * ping-pong is: an unlocked device folds a plaintext bundle in and deletes it,
 * the locked device writes it again next cycle, forever. And the user asked
 * for a passphrase; comment text in the clear beside the sealed file would
 * quietly undo that.
 */
export type BundleCommentsMode =
  | { kind: "plain" }
  | { kind: "sealed"; crypto: CommentsCrypto }
  | { kind: "locked" };

export interface BundleCommentStoreDeps {
  /**
   * The RAW adapter - what the sideband step uses. The conflict-aware app
   * adapter would mint sync_state rows and `.CONFLICT` copies of the bundle,
   * and a comment must never become a write to the note.
   */
  vault: IVaultAdapter;
  /** Same stable vault identity as the sideband, including across wrappers. */
  vaultKey?: string;
  /** This device's stable id - the same one the sideband stamps, so one device stays one author. */
  deviceId(): Promise<string>;
  mode(): Promise<BundleCommentsMode>;
  /** The reviewer name this vault already carries; the person at this keyboard, kept on this device only. */
  authorName?(): Promise<string | null | undefined>;
  /** Called once a record is on disk - the shell triggers its sideband and refreshes the column. `"*"` means every note (a folder moved). */
  written?(path: string): void;
  /**
   * A comment file that could not be read (N3). Reported once per file and
   * reason for the life of the store; the shell shows it with a way to export
   * the diagnosis. The file itself is never overwritten.
   */
  faulted?(faults: CommentBundleFault[]): void;
  now?(): string;
}

function cryptoOf(mode: BundleCommentsMode): CommentsCrypto | undefined {
  return mode.kind === "sealed" ? mode.crypto : undefined;
}

/**
 * The open store: the sideband bundle of a vault without an encrypted
 * workspace (Stufe D, D4), lifted out of both shells where it lived twice.
 *
 * Everything here maps INTO `WorkspaceCommentRecord`, so the column, the
 * anchor resolution and the suggestion flow stay one implementation. There is
 * no outbox: a record is on disk the moment somebody presses send, and the
 * union merge makes that early write safe.
 */
export class BundleCommentStore implements CommentStore {
  private readonly reported = new Set<string>();

  constructor(private readonly deps: BundleCommentStoreDeps) {}

  /** Hands new faults to the shell; one that was already shown stays quiet. */
  private report(faults: CommentBundleFault[]): void {
    const fresh = faults.filter((fault) => {
      const key = `${fault.path}|${fault.reason}`;
      if (this.reported.has(key)) return false;
      this.reported.add(key);
      return true;
    });
    if (fresh.length > 0) this.deps.faulted?.(fresh);
  }

  async state(): Promise<CommentStoreState> {
    return { mode: (await this.deps.mode()).kind, hasOutbox: false };
  }

  async capabilities(): Promise<WorkspaceCapability[] | null> {
    return [...BUNDLE_COMMENT_CAPABILITIES];
  }

  /**
   * The union of every readable comment file in the vault (N2), or null on a
   * locked device - which lists as empty and explains itself through `state()`.
   */
  private async bundle(): Promise<CommentsBundle | null> {
    const mode = await this.deps.mode();
    if (mode.kind === "locked") return null;
    const faults: CommentBundleFault[] = [];
    try {
      return await readAllComments(this.deps.vault, await this.deps.deviceId(), cryptoOf(mode), { faults, now: this.deps.now?.(), vaultKey: this.deps.vaultKey });
    } finally { this.report(faults); }
  }

  /**
   * The resolved paths that have no file (N1): a remark that arrived under a
   * name the vault had already renamed follows the rename; a remark on a note
   * that reuses a freed name stays. Only the data cannot tell them apart - a
   * stat can, and only the handful of paths a marker would move on are asked.
   */
  private async missingPlaces(bundle: CommentsBundle | null): Promise<Set<string>> {
    const missing = new Set<string>();
    for (const path of commentPathsToCheck(bundle)) {
      if (!(await this.deps.vault.exists(path))) missing.add(path);
    }
    return missing;
  }

  async list(path: string): Promise<WorkspaceCommentRecord[]> {
    const bundle = await this.bundle();
    return localCommentsForPath(bundle, path, await this.missingPlaces(bundle));
  }

  async listAll(): Promise<Map<string, WorkspaceCommentRecord[]>> {
    const bundle = await this.bundle();
    return localCommentsByPath(bundle, await this.missingPlaces(bundle));
  }

  async authors(): Promise<Map<string, string>> {
    return localCommentAuthorNames(await this.bundle());
  }

  /**
   * The SAME id `post` writes into `authorDeviceId` - which is what the
   * surface maps into `authorMemberId` for a record without a named author.
   * Reading it from anywhere else would be a second answer to one question,
   * and "is this comment mine?" would start disagreeing with the byline.
   */
  async selfId(): Promise<string> {
    return this.deps.deviceId();
  }

  async post(input: CommentPostInput): Promise<void> {
    const mode = await this.deps.mode();
    if (mode.kind === "locked") throw new CommentStoreLockedError();
    const identity = commentWriteIdentity(input.identity, this.deps.now?.());
    const now = identity.createdAt;
    const record: LocalCommentRecord = {
      commentId: identity.commentId,
      path: input.path,
      parentCommentId: input.parentCommentId ?? null,
      resolvedCommentId: input.resolvedCommentId ?? null,
      suggestionOutcome: input.suggestionOutcome ?? null,
      ...(input.decisionProof ? { decisionProof: input.decisionProof } : {}),
      retractsCommentId: input.retractsCommentId ?? null,
      suggestionBatchId: input.batch?.batchId ?? null,
      batchIndex: input.batch?.index ?? null,
      batchNote: input.batch?.note ?? null,
      authorDeviceId: await this.deps.deviceId(),
      authorId: input.author?.id ?? null,
      body: input.body,
      anchor: input.anchor ?? null,
      suggestion: input.suggestion ?? null,
      createdAt: now,
    };
    // A named author brings its own name; the device signs with the reviewer
    // name the vault already has rather than asking the same question twice.
    const authorName = input.author ? input.author.displayName?.trim() || undefined : (await this.deps.authorName?.())?.trim() || undefined;
    const faults: CommentBundleFault[] = [];
    try { await appendLocalComment(this.deps.vault, record, {
      deviceId: record.authorDeviceId,
      vaultKey: this.deps.vaultKey,
      resolveCrypto: () => this.writeCrypto(),
      crypto: cryptoOf(mode),
      authorName,
      authorKey: input.author?.id ?? undefined,
      now,
      faults,
    }); } finally { this.report(faults); }
    this.deps.written?.(input.path);
  }

  private async writeCrypto(): Promise<CommentsCrypto | undefined> {
    const mode = await this.deps.mode();
    if (mode.kind === "locked") throw new CommentStoreLockedError();
    return cryptoOf(mode);
  }

  /** No outbox, nothing pending: a typed non-operation rather than a missing branch. */
  async retry(): Promise<void> {}

  async discard(): Promise<void> {}

  async recordMoves(moves: readonly CommentPathMove[]): Promise<void> {
    const real = moves.filter((move) => move.from && move.to && move.from !== move.to);
    if (real.length === 0) return;
    const mode = await this.deps.mode();
    if (mode.kind === "locked") throw new CommentStoreLockedError();
    const now = this.deps.now?.() ?? new Date().toISOString();
    const deviceId = await this.deps.deviceId();
    const records: LocalMoveRecord[] = real.map((move) => ({
      moveId: createWorkspaceObjectId(),
      from: move.from,
      to: move.to,
      folder: move.folder === true,
      deviceId,
      at: now,
    }));
    // A vault that never carried a remark gets no file for a rename alone:
    // the marker only matters once there is something to keep in place - and
    // that something may sit in another device's file.
    const faults: CommentBundleFault[] = [];
    if (!(await readAllComments(this.deps.vault, deviceId, cryptoOf(mode), { faults, now, vaultKey: this.deps.vaultKey }))) { this.report(faults); return; }
    try {
      await appendLocalMoves(this.deps.vault, records, { deviceId, crypto: cryptoOf(mode), now, faults, vaultKey: this.deps.vaultKey, resolveCrypto: () => this.writeCrypto() });
    } finally { this.report(faults); }
    this.deps.written?.(real.length === 1 && !real[0].folder ? real[0].to : "*");
  }
}
