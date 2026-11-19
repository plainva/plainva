import { canonicalJson } from "../settingsSync/canonicalJson.js";
import { isTextFile } from "../sync/fileType.js";
import type { SyncProgress, SyncStatus, SyncErrorReason } from "../sync/SyncWorker.js";
import { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { OwnDeletionRegister } from "../sync/ownDeletions.js";
import { ownRemovalStamps } from "../vault/indexedRowStamp.js";
import { createWorkspaceCatalog, openWorkspaceCatalog, type WorkspaceCatalogPayload } from "./catalog.js";
import {
  encodeWorkspaceDocument,
  parseWorkspaceDocument,
  signWorkspaceDocument,
  verifyWorkspaceDocumentSignatures,
  WorkspaceDocumentSigner,
  WorkspaceOperationName,
  WorkspaceOperationPayload,
  WorkspacePolicyPayload,
  WorkspaceRecoveryAnchorPayload,
  WorkspaceSignedDocument,
  workspaceDocumentHash,
} from "./documents.js";
import {
  createWorkspaceObjectId,
  createWorkspaceRevisionId,
} from "./identity.js";
import {
  decodeBase64Exact,
  fromBase64,
  sha256Hex,
  toBase64,
  utf8Encode,
} from "./encoding.js";
import { WorkspaceObjectStore } from "./objectStore.js";
import {
  openPvc1Chunk,
  openPvo1Frame,
  openPvo1Metadata,
  parsePvo1Frame,
  sealChunkedPvo1,
  sealInlinePvo1,
  splitPvo1Chunks,
  verifyChunkedPlaintextHash,
} from "./pvo1.js";
import { PersonalWorkspaceRuntime } from "./personal.js";
import { assertCanonicalVaultPath } from "./path.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";
import {
  deletedObjectPath,
  PreparedWorkspaceMutation,
  WorkspaceObjectRecord,
  WorkspacePendingPublication,
  WorkspaceQueuedMutation,
  WorkspaceRevisionRecord,
  WorkspaceRuntimeMeta,
  WorkspaceStateStore,
  type WorkspacePublicationRecord,
} from "./state.js";
import { resumeWorkspaceRekey } from "./rotation.js";
import { refreshWorkspacePublications, type PublicationRefreshOutcome } from "./publicationRefresh.js";
import { MAX_INLINE_PLAINTEXT_BYTES } from "./constants.js";
import { evaluateWorkspaceAccess } from "./authorization.js";
import { resolveWorkspacePolicyChain } from "./policy.js";
import { workspaceRecipientGroupIds, workspaceSliceIdsForObject, type WorkspaceSliceObject } from "./slices.js";
import { quarantineReasonCode } from "./quarantineReasons.js";
import { splitDeviceChains } from "./deviceChains.js";
import { openWorkspaceComment, publishQueuedWorkspaceComment, workspaceCommentRecord, WorkspaceRevisionHistoryService } from "./collaboration.js";
import { isMassFileDeletion, vanishingFiles } from "../sync/massDeletion.js";
import { baselineRefusalReports, recordWorkspaceDeniedChange } from "./deniedFork.js";
import { recoverWorkspaceCommentDecisions } from "./commentDecisionRecovery.js";
import { reconcileWorkspaceCommentRetractions } from "./commentRetractions.js";
import { validateWorkspaceRecoveryAnchorChain } from "./recovery.js";
import { parseMarkdownAst } from "../markdown-parser.js";
import { extractLinksAndTags } from "../ast-scanner.js";
import { extractFrontmatter } from "../metadata-extractor.js";
import { syncErrorMessage } from "../sync/errorKind.js";
import { connectionFailureCode } from "../sync/connectionFailure.js";
import { restoreKnownOperationCopies } from "./operationRecovery.js";
import { withPathMutation } from "../vault/pathMutation.js";
import { classifyWorkspaceSyncFailure, isWorkspaceSyncAborted, workspaceSyncRetryDelay, type WorkspaceSyncFailureKind } from "./syncFailure.js";

const STAGING_ROOT = ".plainva/workspace/staging";
const DEFAULT_INTERVAL_MS = 15_000;

function deviceSigner(runtime: PersonalWorkspaceRuntime): WorkspaceDocumentSigner {
  return { algorithm: "Ed25519", signerId: runtime.device.publicIdentity.deviceId, signerKind: "device" };
}

function nowIso(): string { return new Date().toISOString(); }

/** The id of a quarantine entry: one per remote artifact CONTENT. */
export function quarantineIdFor(kind: string, remoteKey: string, artifactSha256: string): string {
  return sha256Hex(utf8Encode(`${kind}\0${remoteKey}\0${artifactSha256}`));
}

/**
 * Takes the newest accepted policy of the remote chain into `runtime` — the
 * object the app's permission check reads too (`EncryptedWorkspaceWorker.refreshPolicy`).
 */
export async function refreshWorkspacePolicy(input: { store: WorkspaceObjectStore; state: WorkspaceStateStore; vault: IVaultAdapter; runtime: PersonalWorkspaceRuntime; signal?: AbortSignal }): Promise<void> {
  await new EncryptedWorkspaceWorker(input.store, input.state, input.vault, input.runtime).refreshPolicy(input.signal);
}

/** The policy refused the mutation (an authorization assert while it was prepared), not a fault. */
/**
 * A queued file that could not be read when its change was prepared — locked
 * by another program (EBUSY), its drive gone for a moment. Its entry waits
 * for the next cycle; the rest of the queue goes on.
 */
class WorkspaceUnreadableFileError extends Error {
  constructor(readonly path: string, cause: unknown) {
    super(`${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "WorkspaceUnreadableFileError";
  }
}

/** `a` and `b` are one path, or one lies in the other (a folder and what is in it). */
function pathsMeet(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/** The hash of no bytes: an empty file is no evidence of a move. */
const EMPTY_SHA256 = sha256Hex(new Uint8Array());

/** How a refused change whose original could not be brought back marks its entry (`keepRefusedMutation`). */
const RESTORE_PENDING = "restore pending: ";

function isRefusedByPolicy(error: unknown): boolean {
  return error instanceof WorkspaceProtocolError && error.code === "authorization";
}

function quarantineKeyOf(kind: string, remoteKey: string): string {
  return `${kind}\0${remoteKey}`;
}

function operationCapability(operation: WorkspaceOperationName): WorkspaceOperationPayload["capability"] {
  switch (operation) {
    case "create": case "mkdir": return "content.create";
    case "write": case "resolve": return "content.write";
    case "rename": return "content.rename";
    case "delete": return "content.delete";
    case "comment": return "comment.create";
  }
}

function sliceObjectWithContent(objectId: string, path: string, contentKind: WorkspaceSliceObject["contentKind"], plaintext?: Uint8Array): WorkspaceSliceObject {
  const object: WorkspaceSliceObject = { objectId, path, contentKind };
  if (contentKind !== "text" || !plaintext) return object;
  try {
    const ast = parseMarkdownAst(new TextDecoder("utf-8", { fatal: true }).decode(plaintext), { preserveObsidianSyntax: true });
    object.tags = [...new Set(extractLinksAndTags(ast).tags.map((tag) => tag.name))].sort();
    const frontmatter = extractFrontmatter(ast);
    if (frontmatter.success && frontmatter.data) {
      object.properties = Object.fromEntries(Object.entries(frontmatter.data).filter((entry): entry is [string, string | number | boolean | null] => entry[1] === null || ["string", "number", "boolean"].includes(typeof entry[1])));
    }
  } catch {
    // Invalid or unusually large markdown simply cannot match tag/property rules.
  }
  return object;
}

function mimeForPath(path: string, directory: boolean): string {
  if (directory) return "inode/directory";
  const extension = path.split(".").pop()?.toLowerCase();
  const known: Record<string, string> = {
    md: "text/markdown", txt: "text/plain", json: "application/json", yaml: "application/yaml", yml: "application/yaml",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    pdf: "application/pdf", mp3: "audio/mpeg", mp4: "video/mp4", base: "application/yaml",
  };
  return extension ? known[extension] ?? "application/octet-stream" : "application/octet-stream";
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

/**
 * The end of an object's winning branch (`incomingTakesHead`): from the root,
 * at every fork the version with the greater operation hash.
 */
function winningLeaf(revisions: WorkspaceRevisionRecord[]): string | null {
  const known = new Set(revisions.map((revision) => revision.revisionId));
  const children = new Map<string | null, WorkspaceRevisionRecord[]>();
  for (const revision of revisions) {
    const parent = revision.parentRevisionIds.find((id) => known.has(id)) ?? null;
    children.set(parent, [...(children.get(parent) ?? []), revision]);
  }
  let leaf: string | null = null;
  for (let next = children.get(null); next && next.length > 0; next = children.get(leaf)) {
    leaf = next.reduce((best, revision) => (revision.operationHash > best.operationHash ? revision : best)).revisionId;
  }
  return leaf;
}

function conflictPath(path: string, operationHash: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const suffix = `.CONFLICT-${operationHash.slice(0, 8)}`;
  return dot > slash ? `${path.slice(0, dot)}${suffix}${path.slice(dot)}` : `${path}${suffix}`;
}

async function listAll(store: WorkspaceObjectStore, prefix: string, signal?: AbortSignal) {
  const items: Awaited<ReturnType<WorkspaceObjectStore["list"]>>["items"] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list(prefix, cursor, { signal, pageSize: 500 });
    items.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return items;
}

export interface EncryptedWorkspaceWorkerOptions {
  intervalMs?: number;
  /** Injectable clock/random source for deterministic scheduler checks. */
  now?: () => number;
  random?: () => number;
  sideband?: () => Promise<void>;
  /**
   * Reopens one publication's own runtime, or returns null when this device
   * holds no key for it. Injected because the runtime lives in the OS
   * credential store - one slot per publication - which core cannot read.
   * Deliberately just the runtime: the worker already holds the object store
   * and the workspace id, so the folder a publication lives in is derived here
   * rather than in each shell, where the publication's OWN workspace id is in
   * reach and would address a folder nobody joined.
   * Leaving it out simply means this worker does not refresh publications.
   */
  openPublicationRuntime?: (record: WorkspacePublicationRecord) => Promise<PersonalWorkspaceRuntime | null>;
  onPublicationsRefreshed?: (outcomes: PublicationRefreshOutcome[]) => void;
  /**
   * Where an incoming deletion carried out here is marked, so the index's
   * report of the vanished file is not taken for the person's deletion — as
   * the plain sync does (`OwnDeletionRegister`).
   */
  ownDeletions?: OwnDeletionRegister;
}

/**
 * Personal encrypted-workspace pull/push engine. Immutable payloads and signed
 * operations are authoritative; mutable heads are verified acceleration only.
 * Remote absence never deletes local material.
 */
export class EncryptedWorkspaceWorker {
  private running = false;
  private syncing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private pendingImmediate = false;
  private pendingManualRetry = false;
  private inspectKnownCopies = false;
  private consecutiveFailures = 0;
  private failureKind: WorkspaceSyncFailureKind | undefined;
  private retryAt: number | undefined;
  public onStatusChange?: (status: SyncStatus, error?: string, reason?: SyncErrorReason, retryAt?: number, failureKind?: WorkspaceSyncFailureKind) => void;
  public onProgress?: (progress: SyncProgress | null) => void;
  public onFilesChanged?: (paths: string[]) => void;
  /**
   * Once, after the first cycle that went through (open-items plan 3.119).
   * The plain `SyncWorker` says the same: the phone holds back announcing the
   * files its index finds as new until the first sync has looked, and with an
   * encrypted workspace nobody lifted that, so a file another app put beside
   * the app reached the workspace queue only at the next start.
   */
  public onFirstCycleComplete?: () => void;
  private firstCycleSaid = false;
  /**
   * Notes whose remarks changed in this cycle (K6): a queued remark published,
   * a queued remark that failed, or a remark that arrived from another device.
   * Before this the shell only heard about its OWN posts and an open column
   * showed the list it loaded when the note was opened.
   */
  public onCommentsChanged?: (paths: string[]) => void;
  private readonly commentPathsChanged = new Set<string>();
  /**
   * Fired once when the mass-deletion guard trips (release 0.9.0 A4), with the
   * plain sync's arguments, so both shells ask the same question
   * (`SyncWorker.onMassDeletionPending`): more than `MASS_DELETE_MIN` queued
   * deletions nobody confirmed, and more than `MASS_DELETE_SHARE` of the live
   * objects — the vault folder emptied, moved or its drive unmounted, found by
   * the index or by the start-up reconcile. They are held, everything else
   * goes on, until `approveMassDeletion()` or `discardMassDeletion()`. Until
   * then the workspace had no guard, and every such deletion went out signed,
   * to every device.
   */
  public onMassDeletionPending?: (info: { pendingDeletes: number; syncedTotal: number }) => void;
  /** Queue ids the person let go in this session (`approveMassDeletion`); like the plain sync's, gone with a restart. */
  private readonly massDeletionApprovedIds = new Set<number>();
  /** The held deletions the open question is about: what the two answers act on. */
  private massDeletionPromptIds: number[] = [];
  private massDeletionSignaled = false;
  /**
   * Fired once when another device's deletions would take an implausibly
   * large share of the files here (review of release 0.9.0 A4), with the plain
   * sync's arguments (`SyncWorker.onDeletionMirroringSuspended`), so both
   * shells ask the plain sync's pull-side question. The guard above stops a
   * mass deletion before it leaves this device; a device without it — an
   * older version, a broken one — sent it out signed, and every other device
   * carried it out. Now the deletions, and what that device wrote to the same
   * files after them, wait until `approveSuspendedDeletions()` or `keepSuspendedDeletionsLocal()`.
   * A signed deletion is no claim of a listing: every one is counted as
   * checked and gone.
   */
  /**
   * The paths of changes refused by the workspace's policy since the last
   * report, each kept here as a local fork; and, once per session, the
   * refused moves and deletions whose original could not be brought back yet
   * (`restorePending`) — they stay queued and are tried again at every cycle.
   */
  public onChangesRefused?: (paths: string[], restorePending?: string[]) => void;
  /**
   * `fromWorkspaceDevice`: the question is the workspace's — another device
   * of it deleted the files, it is not a cloud that lost them. `staysLocal`:
   * how many of them this member may not put back for the others; keeping
   * those means here only, as this device's own version.
   */
  public onDeletionMirroringSuspended?: (info: { missing: number; confirmed: number; probed: number; absent: number; fromWorkspaceDevice?: true; staysLocal?: number }) => void;
  /** The held incoming deletions the open question is about (operation hashes). */
  private suspendedRemoteDeletions: string[] = [];
  private suspendedRemoteFiles = 0;
  private remoteDeletionSignaled = false;
  /** Answered in this session: carried out, or kept here and made anew. Gone with a restart, as in the plain sync. */
  private readonly approvedRemoteDeletions = new Set<string>();
  private readonly keptRemoteDeletions = new Set<string>();
  /**
   * Devices whose operations wait — behind a held deletion, or until this
   * device's own changes to the same files have gone up: their remote head
   * is not taken as observed yet.
   */
  private heldDeviceIds = new Set<string>();
  /**
   * The place each incoming object revision gives its object, as far as this
   * pull looked (`incomingTargetPath`): only the path, never the object's bytes
   * or plaintext — those are fetched again for the one object being applied.
   * Holding them until the pull ended took a phone's memory on its first sync
   * with attachments (review of release 0.9.0, the pattern of F51).
   */
  private readonly targetPathsThisPull = new Map<string, string | null>();
  /** The plaintext hash of what an incoming content operation brings, opened with its path (`queuedWritesAreThisVersion`). */
  private readonly targetShasThisPull = new Map<string, string | null>();
  /** The objects whose deletion this pull applies (`applyIncoming`: of two files of one name and text, the one that goes gives the name up). */
  private readonly deletedThisPull = new Set<string>();
  private readonly foldersToClear = new Set<string>();
  /** Each device's operations this pull applied or found applied, by sequence (`advanceHead`). */
  private readonly appliedThisPull = new Map<string, Map<number, string>>();
  /** Refused changes whose original could not be brought back, named once in this session. */
  private readonly restorePendingNamed = new Set<string>();
  private restorePendingFresh: string[] = [];
  private activePolicy: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;

  constructor(
    private readonly objectStore: WorkspaceObjectStore,
    private readonly state: WorkspaceStateStore,
    private readonly vault: IVaultAdapter,
    private readonly runtime: PersonalWorkspaceRuntime,
    private readonly options: EncryptedWorkspaceWorkerOptions = {}
  ) { this.activePolicy = runtime.policy; }

  /**
   * The remote artifacts with an open quarantine entry, `<kind>\0<key>`, read
   * once per cycle. Whatever validates now closes its entry (finding
   * 2026-09-03: nothing ever did, so a successful retry changed nothing).
   */
  private pendingQuarantine = new Set<string>();

  /**
   * Every policy version on the accepted chain, by document hash.
   *
   * Filled in `verifyBootstrap`. An operation is judged in the version it
   * references, which is the only version its author could have known.
   */
  private acceptedPolicies = new Map<string, WorkspacePolicyPayload>();

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resetRetry();
    this.scheduleImmediate();
  }

  /**
   * One cycle, awaited: the "check again" of the quarantine list needs to
   * answer, and a fire-and-forget trigger has nothing to say. A cycle already
   * running is let finish; the immediate one queued behind it is the answer.
   */
  async runNow(): Promise<void> {
    if (!this.running) return;
    this.inspectKnownCopies = true;
    this.resetRetry();
    if (this.syncing) {
      this.pendingManualRetry = true;
      this.pendingImmediate = true;
      await this.syncing.catch(() => undefined);
    } else {
      this.scheduleImmediate();
    }
    await this.syncing?.catch(() => undefined);
  }

  stop(): void {
    this.running = false;
    this.pendingImmediate = false;
    this.pendingManualRetry = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
  }

  /** Pushes the settings profile once before files are switched off (plan "Verbinden", E3), as `SyncWorker.pushSettingsNow`: serialised, never behind a file cycle. */
  async pushSettingsNow(): Promise<void> {
    try {
      await this.runSidebandSerially();
    } catch (e) {
      console.error("[EncryptedWorkspaceWorker] settings push before stopping failed:", e);
    }
  }

  private sidebandChain: Promise<void> = Promise.resolve();

  /** One sideband run at a time, whoever asks (second review, B3). */
  private runSidebandSerially(): Promise<void> {
    const sideband = this.options.sideband;
    if (!sideband) return Promise.resolve();
    const run = this.sidebandChain.then(() => sideband());
    this.sidebandChain = run.catch(() => undefined);
    return run;
  }

  async stopAndDrain(): Promise<void> {
    this.stop();
    await this.syncing?.catch(() => undefined);
    // A settings push started outside a cycle finishes too (second review, B3).
    await this.sidebandChain;
  }

  triggerImmediate(): void {
    if (!this.running) return;
    // Local edits do not bypass a provider delay or a stopped trust check.
    // Explicit retry, foreground reconnect and runNow use retryFailed/runNow.
    if (this.failureKind && (this.failureKind !== "transient" || (this.retryAt ?? 0) > this.now())) return;
    this.scheduleImmediate();
  }

  private now(): number { return (this.options.now ?? Date.now)(); }

  private resetRetry(): void {
    this.consecutiveFailures = 0;
    this.failureKind = undefined;
    this.retryAt = undefined;
  }

  private scheduleImmediate(): void {
    if (!this.running) return;
    if (this.syncing) { this.pendingImmediate = true; return; }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.runScheduled();
  }

  retryFailed(): void {
    this.inspectKnownCopies = true;
    void this.state.retryFailed().then(() => {
      this.resetRetry();
      if (this.syncing) this.pendingManualRetry = true;
      this.scheduleImmediate();
    }).catch((error: unknown) => {
      this.onStatusChange?.("error", syncErrorMessage(error), undefined, undefined, "fatal");
    });
  }

  /**
   * Publishes the queued remarks now, without a full cycle around them (K6
   * follow-up, 2026-09-03). `triggerImmediate` ran bootstrap, resume and a
   * complete pull before the outbox - seconds of "sending..." for a remark
   * that only needs its two uploads. If a cycle is already running it drains
   * the outbox itself; this then only asks for one more pass afterwards.
   */
  async publishQueuedComments(): Promise<void> {
    if (!this.running) return;
    if (this.failureKind) { this.triggerImmediate(); return; }
    if (this.syncing) { this.pendingImmediate = true; return; }
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.syncing = (async () => {
      await this.verifyBootstrap(signal);
      try {
        await this.drainCommentOutbox(signal);
      } finally {
        this.flushCommentsChanged();
      }
    })().catch(async (error: unknown) => {
      if (!isWorkspaceSyncAborted(error, signal)) await this.recordCycleFailure(error);
    }).finally(() => {
      this.syncing = null;
      this.abort = null;
      this.scheduleNext();
    });
    await this.syncing;
  }

  /** Answer to `onDeletionMirroringSuspended`: the files go here too, at the next cycle. */
  approveSuspendedDeletions(): void {
    for (const hash of this.suspendedRemoteDeletions) this.approvedRemoteDeletions.add(hash);
    this.suspendedRemoteDeletions = [];
    this.remoteDeletionSignaled = false;
    this.scheduleImmediate();
  }

  /**
   * Answer to `onDeletionMirroringSuspended`, the safe one: the files stay
   * here and go up again as new notes, for every device (the plain sync's
   * "keep and upload again"). The deletions are taken into the workspace's
   * record at the next cycle, the files on the disk untouched.
   */
  async keepSuspendedDeletionsLocal(): Promise<number> {
    for (const hash of this.suspendedRemoteDeletions) this.keptRemoteDeletions.add(hash);
    const kept = this.suspendedRemoteFiles;
    this.suspendedRemoteDeletions = [];
    this.suspendedRemoteFiles = 0;
    this.remoteDeletionSignaled = false;
    this.scheduleImmediate();
    return kept;
  }

  /**
   * Answer to `onMassDeletionPending`: the files really are meant to go. The
   * next cycle pushes the held deletions. Session-scoped, as in the plain
   * sync: still pending after a restart, they are asked about again.
   */
  approveMassDeletion(): void {
    for (const id of this.massDeletionPromptIds) this.massDeletionApprovedIds.add(id);
    this.massDeletionPromptIds = [];
    this.massDeletionSignaled = false;
    this.scheduleImmediate();
  }

  /**
   * Answer to `onMassDeletionPending`: keep them. The held deletions leave
   * the queue, and every file of them that is still missing here comes back
   * from the workspace — its current revision, decrypted, written where it
   * was (the plain sync restores from the remote the same way). Under the
   * path's lock, the one the worker records under: an object a pull changed
   * meanwhile is written as it is now, one deleted meanwhile is not written.
   * Returns how many deletions were discarded.
   */
  async discardMassDeletion(): Promise<number> {
    const ids = new Set(this.massDeletionPromptIds);
    this.massDeletionPromptIds = [];
    this.massDeletionSignaled = false;
    if (ids.size === 0) return 0;
    const held = (await this.state.listQueue(100_000)).filter((item) => ids.has(item.id) && item.operation === "delete" && !item.prepared);
    const history = new WorkspaceRevisionHistoryService(this.objectStore, this.state, this.runtime.groupKeys);
    const restored: string[] = [];
    // Folders first, so a file finds its folder.
    const objects = new Map<string, WorkspaceObjectRecord>();
    for (const item of held) {
      await this.state.discardQueue(item.id);
      const object = await this.state.getObjectByPath(item.path);
      if (object && !object.deleted && object.currentRevisionId) objects.set(object.path, object);
    }
    const order = [...objects.values()].sort((left, right) => left.path.split("/").length - right.path.split("/").length);
    for (const candidate of order) {
      await withPathMutation(this.state, [candidate.path], async () => {
        const object = await this.state.getObjectByPath(candidate.path);
        if (!object || object.deleted || !object.currentRevisionId || await this.vault.exists(object.path)) return;
        if (object.contentKind === "directory") await this.vault.createDir(object.path);
        else await this.vault.writeBinaryFile(object.path, await history.read(object.currentRevisionId));
        restored.push(object.path);
      });
    }
    if (restored.length) this.onFilesChanged?.(restored);
    return held.length;
  }

  /**
   * Reads the remote policy chain and takes its newest accepted version —
   * into this worker and into the runtime the app's permission check reads
   * (`verifyBootstrap`). The start-up reconcile asks this before it judges a
   * change made while the app was closed (release 0.9.0 A3): the runtime
   * comes from the key bundle, whose policy is the one of the pairing or of
   * this device's last own governance change, and a right withdrawn or
   * granted since would otherwise be judged by the old one.
   */
  async refreshPolicy(signal?: AbortSignal): Promise<void> {
    await this.verifyBootstrap(signal);
  }

  async listPendingOperations(limit = 20): Promise<{ total: number; items: Array<{ operation: string; file_path: string; retry_count: number }> }> {
    const all = await this.state.listQueue(100_000);
    return {
      total: all.length,
      items: all.slice(0, limit).map((entry) => ({ operation: entry.operation, file_path: entry.newPath ?? entry.path, retry_count: entry.retryCount })),
    };
  }

  async runCycle(signal?: AbortSignal): Promise<void> {
    this.pendingQuarantine = new Set((await this.state.listQuarantine("pending")).map((entry) => quarantineKeyOf(entry.artifactKind, entry.remoteKey)));
    await this.verifyBootstrap(signal);
    await resumeWorkspaceRekey(this.state);
    // A prepared mutation has already consumed a device sequence and is an
    // immutable local branch. Finish it before pulling so an operation uploaded
    // immediately before a crash is not mistaken for an incoming remote edit.
    await this.resumePreparedMutations(signal);
    await baselineRefusalReports(this.state);
    // The outbox goes out BEFORE the pull (finding 2026-09-03: "sending..."
    // stood for as long as a full remote listing takes). A queued remark
    // names an object this device has already synced, so nothing in the pull
    // is a precondition for it.
    try {
      await this.drainCommentOutbox(signal);
    } finally {
      this.flushCommentsChanged();
    }
    const changed = await this.pull(signal);
    if (changed.length) this.onFilesChanged?.(changed);
    const recovered = await recoverWorkspaceCommentDecisions({ state: this.state, store: this.objectStore, runtime: this.runtime, signal });
    for (const objectId of recovered.recoveredObjectIds) {
      const object = await this.state.getObjectById(objectId);
      if (object && !object.deleted) this.commentPathsChanged.add(object.path);
    }
    await this.reconcileCommentRetractions(signal);
    this.flushCommentsChanged();
    await this.push(signal);
    await this.reportRefusedChanges();
    await resumeWorkspaceRekey(this.state);
    await this.publishCheckpoint(signal);
    await this.refreshPublications(signal);
    await this.runSidebandSerially();
    const meta = await this.requireMeta();
    meta.lastSyncAt = nowIso();
    meta.lastError = null;
    meta.lastSyncFailure = null;
    if (meta.phase === "migrating" && (await this.state.listQueue(1)).length === 0 && !meta.pendingPublication) meta.phase = "active";
    await this.state.saveMeta(meta);
  }

  /**
   * The changes refused since the last report, by path — at the start, while
   * the app runs, or at the upload. Each is a local fork, shown under the
   * workspace's integrity; until now that was the only place it reached the
   * person, the rest a console line (review of release 0.9.0).
   */
  private async reportRefusedChanges(): Promise<void> {
    const meta = await this.requireMeta();
    const since = meta.refusalsReportedThrough ?? "";
    const fresh = (await this.state.listLocalForks())
      .filter((fork) => fork.reason === "permission-denied" && fork.createdAt > since)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const restorePending = this.restorePendingFresh.splice(0);
    if (fresh.length === 0 && restorePending.length === 0) return;
    if (fresh.length > 0) {
      meta.refusalsReportedThrough = fresh[fresh.length - 1].createdAt;
      await this.state.saveMeta(meta);
    }
    try {
      this.onChangesRefused?.([...new Set(fresh.map((fork) => fork.originalPath))], restorePending);
    } catch (error) {
      console.error("[EncryptedWorkspaceWorker] onChangesRefused consumer failed", error);
    }
  }

  private flushCommentsChanged(): void {
    if (this.commentPathsChanged.size === 0) return;
    const paths = [...this.commentPathsChanged];
    this.commentPathsChanged.clear();
    try {
      this.onCommentsChanged?.(paths);
    } catch (error) {
      console.error("[EncryptedWorkspaceWorker] onCommentsChanged consumer failed", error);
    }
  }

  private async reconcileCommentRetractions(signal?: AbortSignal): Promise<void> {
    for (const id of await reconcileWorkspaceCommentRetractions({ state: this.state, workspaceId: this.runtime.workspaceId, policies: this.acceptedPolicies, signal })) {
      const object = await this.state.getObjectById(id);
      if (object && !object.deleted) this.commentPathsChanged.add(object.path);
    }
  }

  /**
   * Publishes the queued remarks in order (K6).
   *
   * One failure does not stop everything: an entry whose parent or target is
   * itself queued and failed waits (a reply cannot overtake the remark it
   * answers), every other entry is still tried. The failed ones keep their
   * reason and are retried next cycle; the shell offers retry and discard.
   */
  private async drainCommentOutbox(signal?: AbortSignal): Promise<void> {
    const entries = await this.state.listCommentOutbox();
    if (entries.length === 0) return;
    const blocked = new Set<string>();
    for (const entry of entries) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const waitsFor = (id: string | null) => id !== null && blocked.has(id);
      if (waitsFor(entry.parentCommentId) || waitsFor(entry.resolvedCommentId)) {
        blocked.add(entry.commentId);
        continue;
      }
      try {
        await publishQueuedWorkspaceComment({ runtime: this.runtime, policy: this.activePolicy.payload, state: this.state, store: this.objectStore, entry, signal });
        await this.state.deleteCommentOutbox(entry.outboxId);
      } catch (error) {
        if (isWorkspaceSyncAborted(error, signal)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        await this.state.updateCommentOutbox(entry.outboxId, { attempts: entry.attempts + 1, lastError: message.slice(0, 500) });
        blocked.add(entry.commentId);
        this.commentPathsChanged.add(entry.path);
        // A provider outage or refused authentication affects the whole outbox.
        // Keep all unsent entries and let the cycle scheduler control retries.
        const failure = classifyWorkspaceSyncFailure(error);
        if (failure === "transient" || failure === "authentication" || connectionFailureCode(error)) throw error;
      }
      this.commentPathsChanged.add(entry.path);
    }
    await this.reconcileCommentRetractions(signal);
  }

  private async runScheduled(): Promise<void> {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.onStatusChange?.("syncing");
    this.syncing = this.runCycle(signal).then(
      () => {
        if (signal.aborted) return;
        this.resetRetry();
        this.onStatusChange?.("idle");
        if (this.firstCycleSaid) return;
        this.firstCycleSaid = true;
        try {
          this.onFirstCycleComplete?.();
        } catch (error) {
          console.warn("[EncryptedWorkspaceWorker] onFirstCycleComplete failed", error);
        }
      },
      async (error: unknown) => {
        if (!isWorkspaceSyncAborted(error, signal)) await this.recordCycleFailure(error);
      }
    ).finally(() => {
      this.onProgress?.(null);
      this.syncing = null;
      this.abort = null;
      this.scheduleNext();
    });
    await this.syncing;
  }

  private async recordCycleFailure(error: unknown): Promise<void> {
    const message = syncErrorMessage(error);
    const kind = classifyWorkspaceSyncFailure(error);
    this.failureKind = kind;
    const at = this.now();
    this.retryAt = kind === "transient"
      ? at + workspaceSyncRetryDelay(error, ++this.consecutiveFailures, this.options.intervalMs ?? DEFAULT_INTERVAL_MS, at, (this.options.random ?? Math.random)())
      : undefined;
    const meta = await this.state.loadMeta().catch(() => null);
    if (meta) {
      meta.lastError = message.slice(0, 1000);
      meta.lastSyncFailure = { kind, message: meta.lastError, at };
      await this.state.saveMeta(meta).catch(() => { /* silent: the failure is said below through onStatusChange; only its stored copy is missing */ });
    }
    this.onStatusChange?.(kind === "transient" ? "retrying" : "error", message, undefined, this.retryAt, kind);
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.running) return;
    if (this.pendingManualRetry) {
      this.pendingManualRetry = false;
      this.pendingImmediate = false;
      this.resetRetry();
      this.scheduleImmediate();
      return;
    }
    const immediate = this.pendingImmediate;
    this.pendingImmediate = false;
    if (this.failureKind && this.failureKind !== "transient") return;
    if (!this.failureKind && immediate) { this.scheduleImmediate(); return; }
    const delay = this.retryAt === undefined ? this.options.intervalMs ?? DEFAULT_INTERVAL_MS : Math.max(0, this.retryAt - this.now());
    this.timer = setTimeout(() => { this.timer = null; this.scheduleImmediate(); }, delay);
  }

  private async requireMeta(): Promise<WorkspaceRuntimeMeta> {
    const meta = await this.state.loadMeta();
    if (!meta) throw new WorkspaceProtocolError("integrity", "workspace local state is missing");
    protocolAssert(meta.workspaceId === this.runtime.workspaceId, "integrity", "workspace local state belongs to another workspace");
    return meta;
  }

  private async verifyBootstrap(signal?: AbortSignal): Promise<WorkspacePolicyPayload> {
    const expectedGenesis = encodeWorkspaceDocument(this.runtime.genesis);
    const remoteGenesis = await this.objectStore.get(".pvws/genesis.pvgen", { signal });
    protocolAssert(remoteGenesis !== null && sha256Hex(remoteGenesis) === sha256Hex(expectedGenesis), "integrity", "remote workspace genesis is missing or changed");
    const genesis = parseWorkspaceDocument(remoteGenesis);
    protocolAssert(genesis.kind === "genesis" && genesis.workspaceId === this.runtime.workspaceId, "integrity", "remote genesis binding mismatch");
    const genesisPayload = genesis.payload as typeof this.runtime.genesis.payload;
    const policyHash = (genesisPayload as { initialPolicyHash: string }).initialPolicyHash;
    const policyBytes = await this.objectStore.get(`.pvws/policies/${policyHash}.pvpol`, { signal });
    protocolAssert(policyBytes !== null && sha256Hex(policyBytes) === policyHash, "integrity", "initial policy is missing or changed");
    const policy = parseWorkspaceDocument(policyBytes);
    protocolAssert(policy.kind === "policy" && policy.workspaceId === this.runtime.workspaceId, "integrity", "remote policy binding mismatch");
    const ownerDevice = (genesis.payload as { initialOwnerDevice: { deviceId: string; signingPublicKey: string }; recovery: { recoveryId: string; signingPublicKey: string } }).initialOwnerDevice;
    const recovery = (genesis.payload as { recovery: { recoveryId: string; signingPublicKey: string } }).recovery;
    protocolAssert(verifyWorkspaceDocumentSignatures(genesis, (entry) => {
      if (entry.signerKind === "device" && entry.signerId === ownerDevice.deviceId) return decodeBase64Exact(ownerDevice.signingPublicKey, 32, "owner signing key");
      if (entry.signerKind === "recovery" && entry.signerId === recovery.recoveryId) return decodeBase64Exact(recovery.signingPublicKey, 32, "recovery signing key");
      return null;
    }), "crypto", "remote genesis signature verification failed");
    const initial = policy as WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>;
    const payload = initial.payload;
    protocolAssert(verifyWorkspaceDocumentSignatures(initial, (entry) => {
      if (entry.signerKind === "recovery" && entry.signerId === recovery.recoveryId) return decodeBase64Exact(recovery.signingPublicKey, 32, "recovery signing key");
      const device = payload.devices.find((candidate) => candidate.deviceId === entry.signerId);
      return device ? decodeBase64Exact(device.signingPublicKey, 32, "device signing key") : null;
    }), "crypto", "remote policy signature verification failed");
    const infos = await listAll(this.objectStore, ".pvws/policies/", signal);
    const candidates: WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>[] = [];
    const candidateBytes = new Map<string, { key: string; bytes: Uint8Array }>();
    for (const info of infos) {
      if (info.key.endsWith(`/${policyHash}.pvpol`)) continue;
      const bytes = await this.objectStore.get(info.key, { signal });
      if (!bytes) continue;
      try {
        const parsed = parseWorkspaceDocument(bytes);
        protocolAssert(parsed.kind === "policy" && parsed.workspaceId === this.runtime.workspaceId, "integrity", "policy workspace binding mismatch");
        const hash = workspaceDocumentHash(parsed);
        protocolAssert(info.key.endsWith(`/${hash}.pvpol`) && sha256Hex(bytes) === hash, "integrity", "policy path hash mismatch");
        candidates.push(parsed as WorkspaceSignedDocument<"policy", WorkspacePolicyPayload>);
        candidateBytes.set(hash, { key: info.key, bytes });
      } catch (error) {
        await this.quarantineArtifact("policy", info.key, bytes, error);
      }
    }
    const recoveryKey = decodeBase64Exact(recovery.signingPublicKey, 32, "recovery signing key");
    const anchorInfos = await listAll(this.objectStore, ".pvws/recovery/", signal);
    const anchors: WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload>[] = [];
    for (const info of anchorInfos) {
      const bytes = await this.objectStore.get(info.key, { signal });
      if (!bytes) continue;
      try {
        const parsed = parseWorkspaceDocument(bytes);
        protocolAssert(parsed.kind === "recovery" && parsed.workspaceId === this.runtime.workspaceId, "integrity", "recovery anchor workspace binding mismatch");
        const hash = workspaceDocumentHash(parsed);
        protocolAssert(info.key.endsWith(`-${hash}.pvrec`) && sha256Hex(bytes) === hash, "integrity", "recovery anchor path hash mismatch");
        anchors.push(parsed as WorkspaceSignedDocument<"recovery", WorkspaceRecoveryAnchorPayload>);
        await this.acceptArtifact("recovery", info.key);
      } catch (error) {
        await this.quarantineArtifact("recovery", info.key, bytes, error);
      }
    }
    anchors.sort((left, right) => left.payload.anchorVersion - right.payload.anchorVersion);
    validateWorkspaceRecoveryAnchorChain({ genesisRecoveryId: recovery.recoveryId, genesisRecoveryPublicKey: recoveryKey, anchors });
    const recoveryKeys = new Map<string, Uint8Array>([[recovery.recoveryId, recoveryKey]]);
    for (const anchor of anchors) recoveryKeys.set(anchor.payload.recovery.recoveryId, decodeBase64Exact(anchor.payload.recovery.signingPublicKey, 32, "recovery anchor key"));
    const resolved = resolveWorkspacePolicyChain({ initial, candidates, recoveryPublicKeys: recoveryKeys });
    const ignoredPolicyHashes = new Set<string>(resolved.ignoredHashes);
    for (const hash of ignoredPolicyHashes) {
      const artifact = candidateBytes.get(hash);
      if (artifact) await this.quarantineArtifact("policy", artifact.key, artifact.bytes, new WorkspaceProtocolError("authorization", "policy is not on the accepted successor chain"));
    }
    for (const [hash, artifact] of candidateBytes) if (!ignoredPolicyHashes.has(hash)) await this.acceptArtifact("policy", artifact.key);
    this.activePolicy = resolved.current;
    // The WHOLE accepted chain, not only its last link (finding 2026-09-04).
    // An operation names the policy it was written under, and the protocol
    // asks for its capability "in the referenced accepted policy" - so every
    // accepted version has to stay reachable. Comparing against the newest one
    // rejected every operation older than the last policy change, which is
    // every operation as soon as somebody adds a device, a member or a slice.
    this.acceptedPolicies = new Map(resolved.ordered.map((document) => [workspaceDocumentHash(document), document.payload]));
    this.runtime.policy = resolved.current;
    const meta = await this.state.loadMeta();
    if (meta && meta.policyHash !== workspaceDocumentHash(resolved.current)) {
      meta.policyHash = workspaceDocumentHash(resolved.current);
      meta.needsPublication = true;
      await this.state.saveMeta(meta);
    }
    return resolved.current.payload;
  }

  private async quarantineArtifact(kind: Parameters<WorkspaceStateStore["saveQuarantine"]>[0]["artifactKind"], remoteKey: string, bytes: Uint8Array, error: unknown, details: Record<string, unknown> | null = null): Promise<void> {
    const timestamp = nowIso();
    const hash = sha256Hex(bytes);
    this.pendingQuarantine.add(quarantineKeyOf(kind, remoteKey));
    await this.state.saveQuarantine({
      quarantineId: quarantineIdFor(kind, remoteKey, hash),
      artifactKind: kind,
      remoteKey,
      artifactBase64: toBase64(bytes),
      artifactSha256: hash,
      errorCode: error instanceof WorkspaceProtocolError ? error.code : "unknown",
      reasonCode: quarantineReasonCode(kind, error),
      reason: error instanceof Error ? error.message.slice(0, 512) : "workspace artifact validation failed",
      details: details && Object.keys(details).length > 0 ? details : null,
      firstSeenAt: timestamp,
      lastTriedAt: timestamp,
      status: "pending",
      resolvedAt: null,
    });
  }

  /** An artifact that validated on this pull closes the entry it had. */
  private async acceptArtifact(kind: Parameters<WorkspaceStateStore["saveQuarantine"]>[0]["artifactKind"], remoteKey: string): Promise<void> {
    const key = quarantineKeyOf(kind, remoteKey);
    if (!this.pendingQuarantine.has(key)) return;
    this.pendingQuarantine.delete(key);
    await this.state.resolveQuarantine(kind, remoteKey, nowIso());
  }

  private async pull(signal?: AbortSignal): Promise<string[]> {
    const policy = await this.verifyBootstrap(signal);
    const meta = await this.requireMeta();
    const visibleRefs = await this.loadVisibleCatalogRefs(policy, signal);
    let operationInfos = await listAll(this.objectStore, ".pvws/operations/", signal);
    if (this.inspectKnownCopies) {
      const outcome = await restoreKnownOperationCopies({ state: this.state, store: this.objectStore, workspaceId: meta.workspaceId, policies: this.acceptedPolicies, listedKeys: new Set(operationInfos.map(info => info.key)), signal });
      this.inspectKnownCopies = false;
      if (outcome.restored > 0) operationInfos = await listAll(this.objectStore, ".pvws/operations/", signal);
    }
    // Absence does not validate an open quarantine entry. Preserve it until
    // an actual verified copy is observed again.
    const listedOperationKeys = new Set(operationInfos.map((info) => info.key));
    const recoveredBytes = new Map<string, Uint8Array>();
    const operations: Array<{ document: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>; hash: string; key: string; bytes: Uint8Array; policy: WorkspacePolicyPayload }> = [];
    for (const info of operationInfos) {
      const bytes = recoveredBytes.get(info.key) ?? await this.objectStore.get(info.key, { signal });
      if (!bytes) continue;
      // What the check knew when it failed, for the entry's explanation
      // (finding 2026-09-03): the device by name, the policy hashes.
      const details: Record<string, unknown> = {};
      try {
        const parsed = parseWorkspaceDocument(bytes);
        protocolAssert(parsed.kind === "operation" && parsed.workspaceId === meta.workspaceId, "integrity", "operation workspace binding mismatch");
        const document = parsed as WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>;
        details.deviceId = document.payload.deviceId;
        details.deviceName = this.activePolicy.payload.devices.find((entry) => entry.deviceId === document.payload.deviceId)?.displayName ?? null;
        details.sequence = document.payload.sequence;
        const hash = workspaceDocumentHash(document);
        protocolAssert(info.key.endsWith(`-${hash}.pvop`), "integrity", "operation path hash mismatch");
        // The version the author referenced, if it is on the accepted chain.
        // Anything else - a diverged branch, another workspace - stays out.
        const operationPolicy = this.acceptedPolicies.get(document.payload.policyHash) ?? null;
        if (!operationPolicy) { details.policyHash = document.payload.policyHash.slice(0, 12); details.acceptedPolicyHash = workspaceDocumentHash(this.activePolicy).slice(0, 12); }
        protocolAssert(!!operationPolicy, "authorization", "operation uses an unaccepted policy");
        const device = operationPolicy.devices.find((entry) => entry.deviceId === document.payload.deviceId && entry.memberId === document.payload.memberId && entry.state === "active");
        protocolAssert(!!device, "authorization", "operation author is not an active policy device");
        // A revoked device may only be heard as far as an ACTIVE device once
        // vouched for it (finding 2026-09-04). Judging an operation in the
        // policy it references is what the protocol asks for - and it would
        // otherwise let a revoked device keep writing by pointing at a version
        // in which it was still active. Everything above the witnessed line is
        // refused; the already applied past is never re-judged (see the pull).
        const currentDevice = policy.devices.find((entry) => entry.deviceId === document.payload.deviceId);
        if (currentDevice && currentDevice.state === "revoked") {
          const witnessed = meta.checkpointHeads?.[document.payload.deviceId] ?? 0;
          if (document.payload.sequence > witnessed) { details.revokedAt = currentDevice.revokedAt; details.witnessedSequence = witnessed; }
          protocolAssert(document.payload.sequence <= witnessed, "authorization", "operation was written after the device was revoked");
        }
        const object = await this.state.getObjectById(document.payload.objectId);
        // Existing objects can be authorized before object download. For a new
        // object the canonical path (and therefore dynamic slice membership)
        // is encrypted in PVO1, so the definitive check happens in
        // applyIncoming after authenticated decryption.
        if (object) {
          const sliceIds = workspaceSliceIdsForObject(operationPolicy, { objectId: object.objectId, path: object.path, contentKind: object.contentKind });
          protocolAssert(evaluateWorkspaceAccess(operationPolicy, { memberId: device.memberId, deviceId: device.deviceId, capability: document.payload.capability, objectId: document.payload.objectId, sliceIds }).allowed, "authorization", "operation capability is not granted");
        }
        protocolAssert(verifyWorkspaceDocumentSignatures(document, (entry) => entry.signerId === device.deviceId ? decodeBase64Exact(device.signingPublicKey, 32, "device signing key") : null), "crypto", "operation signature verification failed");
        operations.push({ document, hash, key: info.key, bytes, policy: operationPolicy });
        // A provider listing can omit an object that direct addressing still
        // finds. Only a verified successor may name that bounded lookup.
        const previous = document.payload.previousDeviceOperationHash;
        if (previous && document.payload.sequence > 1 && recoveredBytes.size < 512 && !(await this.state.hasOperation(previous))) {
          const key = `.pvws/operations/${device.deviceId}/${document.payload.sequence - 1}-${previous}.pvop`;
          if (!listedOperationKeys.has(key)) {
            listedOperationKeys.add(key);
            const previousBytes = await this.objectStore.get(key, { signal });
            if (previousBytes) { recoveredBytes.set(key, previousBytes); operationInfos.push({ key, size: previousBytes.length }); }
          }
        }
      } catch (error) {
        await this.quarantineArtifact("operation", info.key, bytes, error, details);
      }
    }
    // What this workspace already applied is not re-judged (finding
    // 2026-09-04): it passed every check once, and holding it against the
    // chain again is how a device quarantined its own history. Their
    // quarantine entries - written by the older rule - resolve right here.
    //
    // A device's chain is checked over everything listed, applied or not: an
    // operation that waited (below) is applied after later ones of its device,
    // and the head this device keeps of that chain stays below it until it is
    // (`advanceHead`).
    this.targetPathsThisPull.clear();
    this.targetShasThisPull.clear();
    this.appliedThisPull.clear();
    const chained = await this.validateDeviceChains(operations, meta.operationHeads);
    const fresh: typeof operations = [];
    for (const operation of chained) {
      if (await this.state.hasOperation(operation.hash)) {
        await this.acceptArtifact("operation", operation.key);
        this.noteApplied(operation.document.payload.deviceId, operation.document.payload.sequence, operation.hash);
      } else fresh.push(operation);
    }

    // Each device's operations in the order it wrote them (a deletion before
    // the new note it then made under the same name); across devices by hash.
    const sorted = fresh.sort((left, right) => left.document.payload.sequence - right.document.payload.sequence || left.hash.localeCompare(right.hash));
    // What waits: the deletions the mass-deletion question holds, and what
    // touches this device's own queued changes — each with what depends on it
    // (the same object, or a path in or around it). Everything else of the
    // same devices is applied (review of release 0.9.0: a question left open
    // on a phone held every later change of that device, to any file).
    const held = await this.heldRemoteDeletions(sorted);
    const waiting = await this.waitingOperations(sorted, new Set([...held, ...await this.waitingForOwnChanges(sorted)]));
    this.heldDeviceIds = new Set(sorted.filter((entry) => waiting.has(entry.hash)).map((entry) => entry.document.payload.deviceId));
    const pending = sorted.filter((entry) => !waiting.has(entry.hash));
    this.deletedThisPull.clear();
    for (const entry of pending) if (entry.document.payload.operation === "delete") this.deletedThisPull.add(entry.document.payload.objectId);
    const changed: string[] = [];
    let progress = true;
    while (pending.length && progress) {
      progress = false;
      for (let index = 0; index < pending.length;) {
        const entry = pending[index];
        if (await this.state.hasOperation(entry.hash)) { await this.acceptArtifact("operation", entry.key); pending.splice(index, 1); progress = true; continue; }
        const payloadHash = entry.document.payload.payloadHash;
        if (entry.document.payload.operation !== "delete" && entry.document.payload.operation !== "comment" && payloadHash && !visibleRefs.has(`${entry.document.payload.objectId}:${entry.document.payload.revisionId}:${payloadHash}`)) {
          // Catalogs are selective acceleration indexes, not authorization
          // truth. A create-only contributor cannot decrypt a reader catalog,
          // so its fresh object may appear in the operation stream first. The
          // clear PVO1 envelope headers let intended readers discover that
          // delta without exposing metadata or plaintext to other groups.
          const objectBytes = await this.objectStore.get(`.pvws/objects/${entry.document.payload.objectId}/${payloadHash}.pvobj`, { signal });
          if (!objectBytes) { index += 1; continue; }
          try {
            const frame = parsePvo1Frame(objectBytes);
            const readable = frame.envelopes.some((envelope) => this.runtime.groupKeys.some((key) => key.groupId === envelope.groupId && key.keyEpoch === envelope.keyEpoch));
            if (!readable) { pending.splice(index, 1); progress = true; continue; }
          } catch (error) {
            await this.quarantineArtifact("object", `.pvws/objects/${entry.document.payload.objectId}/${payloadHash}.pvobj`, objectBytes, error);
            pending.splice(index, 1); progress = true; continue;
          }
        }
        const parentsKnown = await Promise.all(entry.document.payload.parentRevisionIds.map((parent) => this.state.getRevision(parent)));
        if (parentsKnown.some((parent) => !parent)) { index += 1; continue; }
        try {
          const appliedPaths = await this.applyIncoming(entry.document, entry.hash, meta, entry.policy, signal);
          changed.push(...appliedPaths);
          await this.acceptArtifact("operation", entry.key);
        } catch (error) {
          await this.quarantineArtifact("operation", entry.key, entry.bytes, error);
        }
        pending.splice(index, 1);
        progress = true;
      }
    }
    // What waits for a held deletion's device may wait for its revisions too; it is looked at again then.
    if (waiting.size === 0) for (const entry of pending) await this.quarantineArtifact("operation", entry.key, entry.bytes, new WorkspaceProtocolError("integrity", "operation graph contains missing revision parents"));
    await this.clearDeletedFolders();
    await this.verifyRemoteHeads(meta, policy, signal);
    this.targetPathsThisPull.clear();
    this.targetShasThisPull.clear();
    return changed;
  }

  /**
   * The operations that wait in this pull: `seeds`, and every other one that
   * depends on one of them — the same object, or a path in or around one of
   * theirs (a folder and what lies in it).
   */
  private async waitingOperations(operations: Array<{ document: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>; hash: string }>, seeds: Set<string>): Promise<Set<string>> {
    const waiting = new Set(seeds);
    if (waiting.size === 0) return waiting;
    const touched = new Map<string, { objectId: string; paths: string[] }>();
    for (const { document, hash } of operations) touched.set(hash, { objectId: document.payload.objectId, paths: await this.pathsTouched(document.payload) });
    for (let grew = true; grew;) {
      grew = false;
      const objects = new Set<string>();
      const paths: string[] = [];
      for (const hash of waiting) { const entry = touched.get(hash); if (entry) { objects.add(entry.objectId); paths.push(...entry.paths); } }
      for (const [hash, entry] of touched) {
        if (waiting.has(hash)) continue;
        if (objects.has(entry.objectId) || entry.paths.some((path) => paths.some((other) => pathsMeet(path, other)))) { waiting.add(hash); grew = true; }
      }
    }
    return waiting;
  }

  /**
   * The paths an incoming operation touches here: its object's place (a
   * deleted one's too), and the place it gives the object — a new object's,
   * and the target of a move (review of release 0.9.0: a note moved into a
   * folder whose deletion waited for an answer did not wait with it, and the
   * deletion took it once answered). A folder around either is met by
   * `pathsMeet`. Only a move and a new object can change the place: a write
   * of a known object goes out under its own path (`prepareMutationLocked`).
   */
  private async pathsTouched(operation: WorkspaceOperationPayload): Promise<string[]> {
    const current = await this.state.getObjectById(operation.objectId);
    const paths = current && !current.path.startsWith("deleted-") ? [current.path] : [];
    if (operation.operation !== "delete" && operation.operation !== "comment" && (!current || operation.operation === "rename" || operation.operation === "resolve")) {
      const target = await this.incomingTargetPath(operation);
      if (target && !paths.includes(target)) paths.push(target);
    }
    return paths;
  }

  /** What this pull applied (or found applied) of each device's chain, by sequence. */
  private noteApplied(deviceId: string, sequence: number, operationHash: string): void {
    const seen = this.appliedThisPull.get(deviceId) ?? new Map<number, string>();
    seen.set(sequence, operationHash);
    this.appliedThisPull.set(deviceId, seen);
  }

  /**
   * The head this device keeps of another device's chain moves only over
   * operations it applied, without a gap: what waits below stays to be
   * applied, and the chain check of the next pull starts from there.
   */
  private advanceHead(meta: WorkspaceRuntimeMeta, deviceId: string, sequence: number, operationHash: string): void {
    this.noteApplied(deviceId, sequence, operationHash);
    const seen = this.appliedThisPull.get(deviceId)!;
    let head = meta.operationHeads[deviceId] ?? null;
    for (let next = seen.get((head?.sequence ?? 0) + 1); next; next = seen.get((head?.sequence ?? 0) + 1)) head = { sequence: (head?.sequence ?? 0) + 1, operationHash: next };
    if (head) meta.operationHeads[deviceId] = head;
  }

  /**
   * Another device's operations that wait until this device's own changes to
   * the same files have gone up (review of release 0.9.0): for each device,
   * the sequence from which they wait. Applied first, the other device's
   * version took the place of one that existed only here — the same new note
   * made on two devices was overwritten without a copy — or became a conflict
   * copy here while the other device kept its own: the two never agreed.
   * Once this device's change is signed, both are versions of the workspace,
   * and every device decides between them alike (`applyIncoming`).
   *
   * An entry that cannot go up by waiting — a refused change whose original
   * is still to be brought back, a file that cannot be read — holds nothing.
   */
  private async waitingForOwnChanges(operations: Array<{ document: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>; hash: string }>): Promise<Set<string>> {
    const waiting = new Set<string>();
    const pending: string[] = [];
    for (const item of await this.state.listQueue(100_000)) {
      if (item.lastError?.startsWith(RESTORE_PENDING) || item.lastError?.includes(" could not be read: ")) continue;
      for (const path of [item.path, item.newPath]) if (path) pending.push(path);
    }
    if (pending.length === 0) return waiting;
    for (const { document, hash } of operations) {
      if (document.payload.operation === "comment") continue;
      // A folder's operation touches what is queued in it; a new object's place is only known once opened (and kept for the apply).
      if (!(await this.pathsTouched(document.payload)).some((path) => pending.some((own) => pathsMeet(path, own)))) continue;
      if (await this.queuedWritesAreThisVersion(document.payload)) continue;
      waiting.add(hash);
    }
    return waiting;
  }

  /**
   * The path an incoming content operation gives its object, or null when it
   * cannot be read here. Only the metadata is opened, and only the path is
   * kept (`targetPathsThisPull`).
   */
  private async incomingTargetPath(operation: WorkspaceOperationPayload): Promise<string | null> {
    if (!operation.payloadHash) return null;
    const key = `.pvws/objects/${operation.objectId}/${operation.payloadHash}.pvobj`;
    if (this.targetPathsThisPull.has(key)) return this.targetPathsThisPull.get(key)!;
    let path: string | null = null;
    try {
      const bytes = await this.objectStore.get(key);
      if (bytes && sha256Hex(bytes) === operation.payloadHash) {
        const frame = parsePvo1Frame(bytes);
        if (frame.envelopes.some((envelope) => this.runtime.groupKeys.some((key) => key.groupId === envelope.groupId && key.keyEpoch === envelope.keyEpoch))) {
          const metadata = await openPvo1Metadata(bytes, this.runtime.groupKeys.map((key) => ({ groupId: key.groupId, keyEpoch: key.keyEpoch, privateKey: key.hpke.privateKey })));
          path = assertCanonicalVaultPath(metadata.path);
          this.targetShasThisPull.set(key, metadata.mime === "inode/directory" ? null : metadata.plaintextSha256);
        }
      }
    } catch {
      // silent: an object this device cannot open here has no place to wait on; the apply judges it on its own
      path = null;
    }
    this.targetPathsThisPull.set(key, path);
    return path;
  }

  /**
   * The incoming deletions the guard holds (`onDeletionMirroringSuspended`),
   * by operation hash; what depends on them waits with them
   * (`waitingOperations`), the rest of that device's changes arrive. Counted as the push-side guard counts: the files
   * that would leave this device, a folder with every file in it, against the
   * files it holds. A deletion that would not take a file here (the object
   * changed here since, or unknown) is not counted; neither is one answered.
   *
   * Counted against what this device holds before the pull (review of
   * release 0.9.0): a file here that the pull would leave gone counts,
   * whatever else the same pull does with it. A deletion that stands on a
   * revision arriving in the same pull — the files edited first, then
   * deleted — was not counted, and fifty files went without a question.
   */
  private async heldRemoteDeletions(operations: Array<{ document: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>; hash: string }>): Promise<Set<string>> {
    // The revisions the same pull brings, by the revision they stand on.
    const arriving = new Map<string, string[]>();
    for (const { document } of operations) {
      const operation = document.payload;
      if (operation.operation === "delete" || operation.operation === "comment" || !operation.revisionId) continue;
      for (const parent of operation.parentRevisionIds) arriving.set(parent, [...(arriving.get(parent) ?? []), operation.revisionId]);
    }
    const reachedFrom = (revisionId: string): Set<string> => {
      const reached = new Set<string>([revisionId]);
      const open = [revisionId];
      while (open.length > 0) for (const child of arriving.get(open.pop()!) ?? []) if (!reached.has(child)) { reached.add(child); open.push(child); }
      return reached;
    };
    const candidates: Array<{ hash: string; deviceId: string; sequence: number; path: string; directory: boolean }> = [];
    for (const { document, hash } of operations) {
      const operation = document.payload;
      if (operation.operation !== "delete" || this.approvedRemoteDeletions.has(hash) || this.keptRemoteDeletions.has(hash)) continue;
      const current = await this.state.getObjectById(operation.objectId);
      if (!current || current.deleted || !current.currentRevisionId) continue;
      const reached = reachedFrom(current.currentRevisionId);
      if (!operation.parentRevisionIds.some((parent) => reached.has(parent))) continue;
      candidates.push({ hash, deviceId: operation.deviceId, sequence: operation.sequence, path: current.path, directory: current.contentKind === "directory" });
    }
    const files = candidates.length > 0
      ? (await this.state.listObjects(false)).filter((object) => object.contentKind !== "directory").map((object) => object.path)
      : [];
    const vanishing = vanishingFiles(candidates.map((candidate) => candidate.path), files);
    if (!isMassFileDeletion(vanishing, files.length)) {
      this.remoteDeletionSignaled = false;
      this.suspendedRemoteDeletions = [];
      this.suspendedRemoteFiles = 0;
      return new Set();
    }
    console.warn(`[EncryptedWorkspaceWorker] another device's deletions would take ${vanishing} of ${files.length} files; they are held until confirmed`);
    this.suspendedRemoteDeletions = candidates.map((candidate) => candidate.hash);
    this.suspendedRemoteFiles = vanishing;
    if (!this.remoteDeletionSignaled) {
      this.remoteDeletionSignaled = true;
      // Kept, a file goes up again as a new one where this member may create
      // it; elsewhere it stays here only. Counted in files, a folder's too.
      const kept = files.filter((path) => candidates.some((candidate) => path === candidate.path || path.startsWith(`${candidate.path}/`)));
      const staysLocal = kept.filter((path) => !this.mayCreateAt(path, false)).length;
      try {
        this.onDeletionMirroringSuspended?.({ missing: vanishing, confirmed: files.length, probed: vanishing, absent: vanishing, fromWorkspaceDevice: true, staysLocal });
      } catch (error) {
        console.error("[EncryptedWorkspaceWorker] onDeletionMirroringSuspended consumer failed:", error);
      }
    }
    return new Set(candidates.map((candidate) => candidate.hash));
  }

  private async validateDeviceChains<T extends { document: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>; hash: string; key: string; bytes: Uint8Array }>(operations: T[], knownHeads: WorkspaceRuntimeMeta["operationHeads"]): Promise<T[]> {
    // The rule lives in `deviceChains.ts`; this only records what it found:
    // the first break as the gap, everything behind it as blocked by it. The
    // anchor is what this workspace already holds (finding 2026-09-04).
    const { valid, broken } = splitDeviceChains(operations, {
      deviceName: (deviceId) => this.activePolicy.payload.devices.find((device) => device.deviceId === deviceId)?.displayName ?? null,
      quarantineId: (item) => quarantineIdFor("operation", item.key, sha256Hex(item.bytes)),
      knownHead: (deviceId) => knownHeads[deviceId] ?? null,
    });
    // What this workspace applied already is not quarantined by a later look at its chain.
    for (const entry of broken) if (!(await this.state.hasOperation(entry.item.hash))) await this.quarantineArtifact("operation", entry.item.key, entry.item.bytes, new WorkspaceProtocolError("integrity", entry.reason), entry.details);
    return valid;
  }

  private async loadVisibleCatalogRefs(policy: WorkspacePolicyPayload, signal?: AbortSignal): Promise<Set<string>> {
    const refs = new Set<string>();
    for (const key of this.runtime.groupKeys) {
      const infos = await listAll(this.objectStore, `.pvws/catalogs/${key.groupId}/${key.keyEpoch}/`, signal);
      const valid: Array<{ version: number; body: ReturnType<typeof openWorkspaceCatalog> }> = [];
      for (const info of infos) {
        const bytes = await this.objectStore.get(info.key, { signal });
        if (!bytes) continue;
        try {
          const parsed = parseWorkspaceDocument(bytes);
          protocolAssert(parsed.kind === "catalog" && parsed.workspaceId === this.runtime.workspaceId, "integrity", "catalog workspace binding mismatch");
          const document = parsed as WorkspaceSignedDocument<"catalog", WorkspaceCatalogPayload>;
          const hash = workspaceDocumentHash(document);
          protocolAssert(info.key.endsWith(`/${hash}.pvcat`), "integrity", "catalog path hash mismatch");
          const signer = policy.devices.find((device) => device.deviceId === document.signatures[0]?.signerId && device.state === "active");
          protocolAssert(!!signer && verifyWorkspaceDocumentSignatures(document, () => decodeBase64Exact(signer.signingPublicKey, 32, "catalog signer key")), "crypto", "catalog signature is invalid");
          valid.push({ version: document.payload.catalogVersion, body: openWorkspaceCatalog(document, key.catalogKey) });
          await this.acceptArtifact("catalog", info.key);
        } catch (error) {
          await this.quarantineArtifact("catalog", info.key, bytes, error);
        }
      }
      // Concurrent publishers can legitimately create catalogs with the same
      // version. Their signed operation DAG resolves freshness; catalogs are a
      // visibility index, so union all decryptable branches and never infer a
      // deletion from an absent reference.
      for (const catalog of valid) for (const ref of catalog.body.objectRefs) refs.add(`${ref.objectId}:${ref.revisionId}:${ref.payloadHash}`);
    }
    return refs;
  }

  private async applyIncoming(
    document: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>,
    operationHash: string,
    meta: WorkspaceRuntimeMeta,
    /**
     * The policy version the operation references (finding 2026-09-04).
     *
     * Every authorization below asked the NEWEST policy instead - so a delete
     * written last month was re-judged against slices and roles that did not
     * exist when it was written, and a member who has since left invalidated
     * their own legitimate history. The author could only know this version.
     */
    operationPolicy: WorkspacePolicyPayload,
    signal?: AbortSignal
  ): Promise<string[]> {
    const acceptedMeta = meta;
    meta = { ...meta, operationHeads: { ...meta.operationHeads } };
    const operation = document.payload;
    const current = await this.state.getObjectById(operation.objectId);
    this.advanceHead(meta, operation.deviceId, operation.sequence, operationHash);
    meta.needsPublication = true;
    if (operation.operation === "delete") {
      return withPathMutation(this.state, [current?.path ?? deletedObjectPath(operation.objectId)], async () => {
      const deleteSlices = current
        ? workspaceSliceIdsForObject(operationPolicy, { objectId: current.objectId, path: current.path, contentKind: current.contentKind })
        : [];
      protocolAssert(evaluateWorkspaceAccess(operationPolicy, { memberId: operation.memberId, deviceId: operation.deviceId, capability: "content.delete", objectId: operation.objectId, sliceIds: deleteSlices }).allowed, "authorization", "delete capability is not granted for the encrypted object");
      const setCurrent = !!current && !!current.currentRevisionId && operation.parentRevisionIds.includes(current.currentRevisionId);
      // Kept here (`keepSuspendedDeletionsLocal`): the deletion is recorded,
      // the file stays and goes up again as a new object.
      const keep = setCurrent && !!current && this.keptRemoteDeletions.has(operationHash) && await this.vault.exists(current.path);
      // Where this member may not create it, the file stays here only: its own version, which nobody refused.
      if (keep && current && !this.mayCreateAt(current.path, current.contentKind === "directory")) await recordWorkspaceDeniedChange(this.vault, this.state, current.path, current.contentKind !== "directory", "kept-local");
      else if (keep && current) await this.state.enqueue(current.contentKind === "directory" ? "mkdir" : "write", current.path);
      else if (setCurrent && current) await this.materializeDelete(current);
      const object: WorkspaceObjectRecord = current
        ? { ...current, currentRevisionId: null, payloadHash: null, deleted: true, modifiedAt: operation.createdAt }
        : { objectId: operation.objectId, path: deletedObjectPath(operation.objectId), currentRevisionId: null, payloadHash: null, plaintextSha256: null, contentKind: "binary", deleted: true, authorMemberId: "", createdAt: operation.createdAt, modifiedAt: operation.createdAt };
      await this.state.recordIncoming({ object, revision: null, operationHash, operationDocument: toBase64(encodeWorkspaceDocument(document)), deviceId: operation.deviceId, sequence: operation.sequence }, setCurrent, meta);
      if (current) await this.state.forgetOwnRemoval?.(current.path);
      Object.assign(acceptedMeta, meta);
      return setCurrent ? [object.path] : [];
      });
    }

    protocolAssert(operation.payloadHash !== null && operation.revisionId !== null, "integrity", "content operation is missing payload references");
    const objectKey = `.pvws/objects/${operation.objectId}/${operation.payloadHash}.pvobj`;
    const objectBytes = await this.objectStore.get(objectKey, { signal });
    protocolAssert(objectBytes !== null && sha256Hex(objectBytes) === operation.payloadHash, "integrity", "operation payload object is missing or changed");
    const frame = parsePvo1Frame(objectBytes);
    const canRead = frame.envelopes.some((envelope) => this.runtime.groupKeys.some((key) => key.groupId === envelope.groupId && key.keyEpoch === envelope.keyEpoch));
    if (!canRead) return [];
    let opened: Awaited<ReturnType<typeof openPvo1Frame>>;
    try {
      opened = await openPvo1Frame(objectBytes, this.runtime.groupKeys.map((key) => ({ groupId: key.groupId, keyEpoch: key.keyEpoch, privateKey: key.hpke.privateKey })));
    } catch (error) {
      await this.quarantineArtifact("object", objectKey, objectBytes, error);
      throw error;
    }
    await this.acceptArtifact("object", objectKey);
    protocolAssert(opened.workspaceId === meta.workspaceId && opened.objectId === operation.objectId && opened.revisionId === operation.revisionId, "integrity", "PVO1 operation binding mismatch");
    let plaintext = opened.plaintext;
    if (!plaintext && opened.manifest) {
      const chunks: Uint8Array[] = [];
      for (const reference of opened.manifest.chunks) {
        const chunkKey = `.pvws/chunks/${operation.objectId}/${operation.revisionId}/${reference.index}-${reference.sha256}.pvchunk`;
        const chunkBytes = await this.objectStore.get(chunkKey, { signal });
        protocolAssert(chunkBytes !== null, "integrity", "PVO1 chunk is missing");
        chunks.push(openPvc1Chunk({ bytes: chunkBytes, expected: reference, frame: opened }));
      }
      protocolAssert(verifyChunkedPlaintextHash(opened, chunks), "integrity", "chunked plaintext hash mismatch");
      plaintext = joinChunks(chunks);
    }
    protocolAssert(plaintext !== undefined, "integrity", "PVO1 payload did not yield plaintext");
    if (operation.operation === "comment") {
      const commentTarget = current ?? await this.state.getRevision(operation.parentRevisionIds[0] ?? "").then((revision) => revision ? this.state.getObjectById(revision.objectId) : null);
      protocolAssert(!!commentTarget, "authorization", "comment target is not known");
      const commentSlices = workspaceSliceIdsForObject(operationPolicy, { objectId: commentTarget.objectId, path: commentTarget.path, contentKind: commentTarget.contentKind });
      protocolAssert(evaluateWorkspaceAccess(operationPolicy, { memberId: operation.memberId, deviceId: operation.deviceId, capability: "comment.create", objectId: commentTarget.objectId, sliceIds: commentSlices }).allowed, "authorization", "comment capability is not granted");
      const body = await openWorkspaceComment({ objectBytes, operation: document, readerKeys: this.runtime.groupKeys });
      if (body.suggestion) protocolAssert(evaluateWorkspaceAccess(operationPolicy, { memberId: operation.memberId, deviceId: operation.deviceId, capability: "comment.suggest", objectId: commentTarget.objectId, sliceIds: commentSlices }).allowed, "authorization", "suggestion capability is not granted");
      if (body.legacyOrigin) protocolAssert(evaluateWorkspaceAccess(operationPolicy, { memberId: operation.memberId,
        deviceId: operation.deviceId, capability: "workspace.manage" }).allowed,
      "authorization", "only workspace managers may import legacy history");
      const record = workspaceCommentRecord(body, document, operationHash);
      // A retraction (K7) is honoured from its author, or from a member who
      // governs the workspace. Anyone else's marker is refused here - the
      // stores below would ignore it anyway, but a forged deletion belongs in
      // quarantine, not in the ledger.
      if (record.retractsCommentId) {
        const retracted = (await this.state.listComments(commentTarget.objectId)).find((entry) => entry.commentId === record.retractsCommentId);
        const governs = evaluateWorkspaceAccess(operationPolicy, { memberId: operation.memberId, deviceId: operation.deviceId, capability: "workspace.manage" }).allowed;
        protocolAssert(governs || !retracted || retracted.authorMemberId === record.authorMemberId, "authorization", "only the author or a workspace manager may delete a comment");
        await this.state.saveComment(record);
        if (!record.legacyOrigin && governs && retracted && retracted.authorMemberId !== record.authorMemberId) await this.state.retractComment(retracted.commentId, record.createdAt);
        this.commentPathsChanged.add(commentTarget.path);
        await this.state.recordObservedOperation(operationHash, toBase64(encodeWorkspaceDocument(document)), operation.deviceId, operation.sequence, meta);
        Object.assign(acceptedMeta, meta);
        return [];
      }
      await this.state.saveComment(record);
      this.commentPathsChanged.add(commentTarget.path);
      await this.state.recordObservedOperation(operationHash, toBase64(encodeWorkspaceDocument(document)), operation.deviceId, operation.sequence, meta);
      Object.assign(acceptedMeta, meta);
      return [];
    }
    const targetPath = assertCanonicalVaultPath(opened.metadata.path);
    const content = plaintext;
    return withPathMutation(this.state, [targetPath, ...(current ? [current.path] : [])], async () => {
    const isDirectory = opened.metadata.mime === "inode/directory";
    const incomingSliceObject = sliceObjectWithContent(operation.objectId, targetPath, isDirectory ? "directory" : opened.metadata.contentKind, plaintext);
    const targetSlices = workspaceSliceIdsForObject(operationPolicy, incomingSliceObject);
    protocolAssert(evaluateWorkspaceAccess(operationPolicy, { memberId: operation.memberId, deviceId: operation.deviceId, capability: operation.capability, objectId: operation.objectId, sliceIds: targetSlices, object: incomingSliceObject, objectAuthorMemberId: current?.authorMemberId ?? null }).allowed, "authorization", "operation capability is not granted for the encrypted object path");
    const fastForward = !current || (current.currentRevisionId !== null && operation.parentRevisionIds.includes(current.currentRevisionId));
    // Two versions of one object: the one every device keeps under the name (`incomingTakesHead`).
    const branches = fastForward || !current ? null : await this.incomingTakesHead(current, operation.parentRevisionIds[0] ?? null, operationHash);
    const takesHead = fastForward || !!branches?.takes;
    const holdsLocal = !!current && !current.deleted;
    // A file that already holds the incoming version is no change of this
    // device's: a runtime that ended (a crash, a close) after it wrote this
    // download and before it recorded it — taken over, no conflict copy.
    const locallyChanged = holdsLocal ? (await this.localContentChanged(current)) && !(await this.holdsBytes(current.path, opened.metadata.plaintextSha256)) : false;
    const pendingLocal = holdsLocal ? await this.state.hasPendingForPath(current.path) : false;
    const setCurrent = takesHead && !locallyChanged && !pendingLocal;
    let objectPath = targetPath;
    let placed = true;
    const moved: string[] = [];
    if (setCurrent) {
      const pathOwner = await this.state.getObjectByPath(targetPath);
      if (pathOwner && !pathOwner.deleted && pathOwner.objectId !== operation.objectId && !isDirectory && pathOwner.contentKind !== "directory" && !(await this.holdsRecordedState(pathOwner, pathOwner.path))) {
        // The note holding the name is changed here and not queued yet: it stays, the incoming one goes beside it.
        objectPath = conflictPath(targetPath, operation.objectId);
      } else if (pathOwner && !pathOwner.deleted && pathOwner.objectId !== operation.objectId) {
        // Two objects, one name (the same new note made on two devices): the
        // smaller id keeps it on every device, the other is its conflict copy
        // everywhere. Two folders of one name are one folder, and two files
        // of one name with the same text are one file (two devices that both
        // kept another device's deleted files uploaded each of them anew:
        // review of release 0.9.0, F63) — the other object is retired, here
        // as on every device. Where the texts differ, the copy stays. Of two
        // such files, one whose deletion this pull applies gives the name up:
        // a device that pulls the deletion and the new upload together keeps
        // the file, as one that saw the deletion first does.
        const oneFile = !isDirectory && pathOwner.contentKind !== "directory" && pathOwner.plaintextSha256 === opened.metadata.plaintextSha256;
        const ownerGoes = this.deletedThisPull.has(pathOwner.objectId);
        const incomingGoes = this.deletedThisPull.has(operation.objectId);
        const incomingKeeps = oneFile && ownerGoes !== incomingGoes ? ownerGoes : operation.objectId < pathOwner.objectId;
        if ((isDirectory && pathOwner.contentKind === "directory") || oneFile) {
          if (incomingKeeps) await this.state.retireObject(pathOwner.objectId);
          else { objectPath = deletedObjectPath(operation.objectId); placed = false; }
        } else if (incomingKeeps) moved.push(...await this.moveToConflictCopy(pathOwner, conflictPath(targetPath, pathOwner.objectId), true));
        else objectPath = conflictPath(targetPath, operation.objectId);
      }
      // This device's version lost to one made at the same time elsewhere: it
      // moves to its conflict copy, under the name every other device gives it.
      if (holdsLocal && branches?.heldBranch) moved.push(...await this.moveToConflictCopy(current, conflictPath(current.path, branches.heldBranch), false));
    }
    // A losing version's copy is named after its branch, so every device
    // names it alike and a later version of the same branch takes its place.
    const intended = setCurrent ? objectPath : conflictPath(targetPath, branches?.incomingBranch ?? operationHash);
    const materializedPath = placed ? await this.materializeContent(current, intended, content, isDirectory, setCurrent, operation.objectId, branches?.incomingBranch ?? operationHash) : intended;
    if (setCurrent && placed) objectPath = materializedPath;
    const object: WorkspaceObjectRecord = {
      objectId: operation.objectId,
      path: setCurrent ? objectPath : targetPath,
      currentRevisionId: operation.revisionId,
      payloadHash: operation.payloadHash,
      plaintextSha256: opened.metadata.plaintextSha256,
      contentKind: isDirectory ? "directory" : opened.metadata.contentKind,
      deleted: !placed,
      authorMemberId: current?.authorMemberId || operation.memberId,
      createdAt: opened.metadata.createdAt,
      modifiedAt: opened.metadata.modifiedAt,
    };
    const revision: WorkspaceRevisionRecord = {
      revisionId: operation.revisionId!,
      objectId: operation.objectId,
      payloadHash: operation.payloadHash!,
      parentRevisionIds: operation.parentRevisionIds,
      operationHash,
      deviceId: operation.deviceId,
      sequence: operation.sequence,
      materializedPath,
      plaintextSha256: opened.metadata.plaintextSha256,
      createdAt: operation.createdAt,
    };
    await this.state.recordIncoming({ object, revision, operationHash, operationDocument: toBase64(encodeWorkspaceDocument(document)), deviceId: operation.deviceId, sequence: operation.sequence }, setCurrent, meta);
    Object.assign(acceptedMeta, meta);
    if (!placed) return moved;
    return [...new Set([...moved, ...(setCurrent && current && current.path !== materializedPath ? [current.path] : []), materializedPath])];
    });
  }

  /**
   * Whether an incoming version of an object takes its place here from the
   * one this device holds — decided alike on every device, whatever order the
   * versions arrive in (review of release 0.9.0). Until now each device kept
   * its own version under the name and the other's as a conflict copy, for
   * good: the next edit on one device came to the other as one more copy.
   *
   * The versions of an object form a tree. Where two branches part, the
   * branch whose first version has the greater operation hash wins, and an
   * edit always wins over a deletion: what someone wrote is never lost to a
   * deletion made at the same time. What this device holds is the end of the
   * winning branch so far; the incoming version takes over when the branch
   * it ends wins against it at the point they part.
   */
  private async incomingTakesHead(current: WorkspaceObjectRecord, parent: string | null, incomingHash: string): Promise<{ takes: boolean; incomingBranch: string; heldBranch: string | null }> {
    const revisions = await this.state.listRevisionsForObject(current.objectId);
    const byId = new Map(revisions.map((revision) => [revision.revisionId, revision]));
    const lineage = (revisionId: string | null): string[] => {
      const line: string[] = [];
      for (let id = revisionId; id && byId.has(id) && !line.includes(id); id = byId.get(id)!.parentRevisionIds[0] ?? null) line.push(id);
      return line;
    };
    // A deleted object's head is the version its deletion stood on: the end
    // of the winning branch, which only a version written since can outgrow.
    const head = current.deleted ? winningLeaf(revisions) : current.currentRevisionId;
    if (!head || !byId.has(head)) return { takes: true, incomingBranch: incomingHash, heldBranch: null };
    const headLine = lineage(head);
    const incomingLine = lineage(parent);
    const meeting = incomingLine.findIndex((id) => headLine.includes(id));
    // The branches compared: the first version of each after the point they part.
    let incomingKey: string;
    let headKey: string | null;
    if (meeting === -1) {
      incomingKey = incomingLine.length > 0 ? byId.get(incomingLine[incomingLine.length - 1])!.operationHash : incomingHash;
      headKey = byId.get(headLine[headLine.length - 1])!.operationHash;
    } else {
      const atHead = headLine.indexOf(incomingLine[meeting]);
      incomingKey = meeting === 0 ? incomingHash : byId.get(incomingLine[meeting - 1])!.operationHash;
      // Stands on what this device holds (or on the version a deletion stood on): it is newer.
      headKey = atHead === 0 ? null : byId.get(headLine[atHead - 1])!.operationHash;
    }
    const takes = headKey === null || incomingKey > headKey;
    return { takes, incomingBranch: incomingKey, heldBranch: takes && !current.deleted ? headKey : null };
  }

  /** Moves an object's file to `copyPath`; `relocate` gives the object that place in the record too. */
  private async moveToConflictCopy(object: WorkspaceObjectRecord, copyPath: string, relocate: boolean): Promise<string[]> {
    const bytes = object.contentKind !== "directory" && await this.vault.exists(object.path) ? await this.vault.readBinaryFile(object.path) : null;
    copyPath = await this.freePlace(copyPath, bytes);
    if (bytes && !(await this.vault.exists(copyPath))) await this.vault.renameItem(object.path, copyPath);
    else if (bytes) await this.vault.deleteItem(object.path);
    if (relocate) await this.state.relocateObject(object.objectId, copyPath);
    if (object.currentRevisionId) await this.state.setRevisionMaterializedPath(object.currentRevisionId, copyPath);
    return [object.path, copyPath];
  }

  /**
   * A file that holds exactly the incoming version of its own object is no
   * change of this device's — also where the index already queued it as
   * changed at the start (both shells queue that at once), after a runtime
   * ended between writing this download and recording it. Such queued
   * writes would send what arrives now, as a version of their own beside
   * it, and the other device makes a conflict copy of the same text: they
   * are done, and go, and the operation waits for nothing. Only writes of
   * exactly this path, not yet prepared for sending, with nothing else of
   * the queue in or around it; a rename, a deletion or a folder's entry
   * stays what it is, and the operation waits for it as before.
   */
  private async queuedWritesAreThisVersion(operation: WorkspaceOperationPayload): Promise<boolean> {
    if (operation.operation === "delete" || !operation.payloadHash) return false;
    const path = await this.incomingTargetPath(operation);
    const sha256 = this.targetShasThisPull.get(`.pvws/objects/${operation.objectId}/${operation.payloadHash}.pvobj`) ?? null;
    if (!path || !sha256) return false;
    const queue = await this.state.listQueue(100_000);
    const touching = queue.filter((entry) => [entry.path, entry.newPath].some((own) => !!own && pathsMeet(path, own)));
    if (touching.length === 0 || touching.some((entry) => entry.operation !== "write" || entry.path !== path || entry.newPath !== null || entry.prepared !== null)) return false;
    const current = await this.state.getObjectByPath(path);
    if (!current || current.deleted || current.objectId !== operation.objectId || current.contentKind === "directory") return false;
    if (!(await this.holdsBytes(path, sha256))) return false;
    for (const entry of touching) await this.state.discardQueue(entry.id);
    // An entry owed to the queue for a change on disk still counts: then it waits.
    return !(await this.state.hasPendingForPath(path));
  }

  /** Whether the file at `path` holds exactly the bytes of `plaintextSha256`. */
  private async holdsBytes(path: string, plaintextSha256: string | null | undefined): Promise<boolean> {
    if (!plaintextSha256) return false;
    try {
      return sha256Hex(await this.vault.readBinaryFile(path)) === plaintextSha256;
    } catch {
      return false;
    }
  }

  private async localContentChanged(object: WorkspaceObjectRecord): Promise<boolean> {
    if (object.deleted || !(await this.vault.exists(object.path))) return false;
    if (object.contentKind === "directory") return false;
    if (!object.plaintextSha256) return true;
    return sha256Hex(await this.vault.readBinaryFile(object.path)) !== object.plaintextSha256;
  }

  /**
   * Whether the file at `path` is the state this device last recorded of
   * exactly this object, with nothing of this device queued for it. Only such
   * a file is the worker's to move, overwrite or delete (review of release
   * 0.9.0): a fresh note under the name a deleted one had, an edit not
   * queued yet, a file of the person's that happens to be there — whatever
   * else lies at the place stays, and what comes from elsewhere lands beside
   * it. Until now the worker moved a new note that had taken a deleted one's
   * name to where the deleted one was renamed, and wrote the old text over it.
   */
  private async holdsRecordedState(object: WorkspaceObjectRecord | null, path: string): Promise<boolean> {
    if (!object || object.deleted || object.path !== path || !(await this.vault.exists(path))) return false;
    if (await this.state.hasPendingForPath(path)) return false;
    try {
      if (object.contentKind === "directory") return (await this.vault.getFileInfo(path)).isDirectory;
      return !!object.plaintextSha256 && sha256Hex(await this.vault.readBinaryFile(path)) === object.plaintextSha256;
    } catch {
      return false;
    }
  }

  /**
   * A place for `bytes` beside what lies at `path`: `path` itself when it is
   * free or already holds these bytes, else the first free numbered name next
   * to it. A conflict copy whose name is taken never overwrites the file there.
   */
  private async freePlace(path: string, bytes: Uint8Array | null): Promise<string> {
    const slash = path.lastIndexOf("/");
    const dot = path.lastIndexOf(".");
    for (let index = 1; ; index += 1) {
      const candidate = index === 1 ? path : dot > slash ? `${path.slice(0, dot)}-${index}${path.slice(dot)}` : `${path}-${index}`;
      if (!(await this.vault.exists(candidate))) return candidate;
      if (bytes && !(await this.vault.getFileInfo(candidate)).isDirectory && sha256Hex(await this.vault.readBinaryFile(candidate)) === sha256Hex(bytes)) return candidate;
    }
  }

  /**
   * Writes an incoming version to `path`, or beside it (`besideHash`) when
   * what lies there is not this object's recorded state; the place it took.
   */
  private async materializeContent(current: WorkspaceObjectRecord | null, path: string, plaintext: Uint8Array, directory: boolean, replaceCurrent: boolean, objectId: string, besideHash: string): Promise<string> {
    if (directory) {
      if (await this.vault.exists(path) && !(await this.vault.getFileInfo(path)).isDirectory) path = await this.freePlace(conflictPath(path, besideHash), null);
      await this.vault.createDir(path);
      return path;
    }
    const ownFile = replaceCurrent && !!current && await this.holdsRecordedState(current, current.path);
    if (ownFile && current!.path !== path && !(await this.vault.exists(path))) await this.vault.renameItem(current!.path, path);
    const takesPlace = !(await this.vault.exists(path)) || (ownFile && (current!.path === path || !(await this.vault.exists(current!.path))));
    if (!takesPlace) {
      const there = await this.vault.getFileInfo(path);
      const bytes = there.isDirectory ? null : await this.vault.readBinaryFile(path);
      const same = !!bytes && sha256Hex(bytes) === sha256Hex(plaintext);
      // The copy this device wrote of an earlier version of the same object, untouched since, is the worker's to replace.
      const ownCopy = !!bytes && (await this.state.findRevisionAt(path, sha256Hex(bytes)))?.objectId === objectId && !(await this.state.hasPendingForPath(path));
      if (!same && !ownCopy) path = await this.freePlace(replaceCurrent ? conflictPath(path, besideHash) : path, plaintext);
    }
    await this.vault.writeBinaryFile(path, plaintext);
    return path;
  }

  /**
   * Carries out a deletion here. Only what is this object's recorded state is
   * removed; a file changed or queued here stays where it is — it goes up
   * again as a note of its own, nothing anyone wrote is gone. A folder's
   * deletion removes the folder alone: the files in it go by the deletions
   * the deleting device made of each of them (`expandFolderDeletion`), and
   * what another device put, moved or changed in it meanwhile stays, and the
   * folder with it (review of release 0.9.0: the folder's deletion took a
   * note another device had just moved into it, from every device but the
   * one that deleted). The folder goes once nothing is left in it.
   */
  private async materializeDelete(current: WorkspaceObjectRecord): Promise<void> {
    if (!(await this.vault.exists(current.path))) return;
    if (current.contentKind !== "directory") {
      if (await this.holdsRecordedState(current, current.path)) {
        // Marked before the file goes, in memory and in the database: the index's
        // report of it is the sync's, also for a runtime that starts after this one
        // ended between the removal and its record (`adoptOwnRemovals`).
        // The same stamps as the plain sync marks: the row the index holds and the file's own time.
        const stamps = await ownRemovalStamps(async () => (await this.state.indexedRow?.(current.path).catch(() => /* silent: a row that cannot be read leaves the file's own time, the mark as before */ null)) ?? null, this.vault, current.path);
        if (stamps.length > 0) this.options.ownDeletions?.mark(current.path, stamps);
        await this.state.noteOwnRemoval?.(current.path, stamps);
        await this.vault.deleteItem(current.path);
      }
      return;
    }
    if ((await this.vault.listDir(current.path, true)).some((entry) => !entry.isDirectory)) { this.foldersToClear.add(current.path); return; }
    await this.vault.deleteItem(current.path, true);
  }

  /** Deleted folders that still held files when their deletion came: gone once the files in them are. */
  private async clearDeletedFolders(): Promise<void> {
    for (const path of [...this.foldersToClear].sort((left, right) => right.length - left.length)) {
      this.foldersToClear.delete(path);
      if (!(await this.vault.exists(path))) continue;
      const object = await this.state.getObjectByPath(path);
      if (object && !object.deleted) continue;
      if (await this.state.hasPendingForPath(path)) continue;
      if ((await this.vault.listDir(path, true)).some((entry) => !entry.isDirectory)) continue;
      if ((await this.state.listObjects(false)).some((other) => other.path.startsWith(`${path}/`))) continue;
      await this.vault.deleteItem(path, true);
    }
  }

  private async push(signal?: AbortSignal): Promise<void> {
    let queue = await this.state.listQueue(100_000);
    // A folder's deletion goes out as the deletion of each note in it, then
    // of the folder (review of release 0.9.0): each note's own deletion meets
    // an edit made meanwhile elsewhere, and the edit wins.
    let expanded = false;
    for (const item of queue) if (!item.prepared && item.operation === "delete" && await this.expandFolderDeletion(item)) expanded = true;
    if (expanded) queue = await this.state.listQueue(100_000);
    const held = await this.heldDeletions(queue);
    // What stands behind a held deletion waits with it: pushed first, a file
    // that came back under the same name would be deleted by the deletion
    // once it is let go.
    const heldEntries = queue.filter((item) => held.has(item.id));
    const behindHeld = (item: WorkspaceQueuedMutation) => !item.prepared && heldEntries.some((entry) => entry.id < item.id &&
      [item.path, item.newPath].some((own) => !!own && (own === entry.path || own.startsWith(`${entry.path}/`) || entry.path.startsWith(`${own}/`))));
    queue = queue.filter((item) => !held.has(item.id) && !(held.size > 0 && behindHeld(item)));
    const absorbed = new Set<number>();
    // Paths whose file could not be read this cycle; what touches them waits with it.
    const unreadable: string[] = [];
    const touches = (item: WorkspaceQueuedMutation, path: string) => [item.path, item.newPath].some((own) =>
      !!own && (own === path || own.startsWith(`${path}/`) || path.startsWith(`${own}/`)));
    // A move made outside the app while it runs, read as the move it is.
    const moves = await this.pairedMoves(queue);
    const pairedWrites = new Set([...moves.values()].map((write) => write.id));
    let current = 0;
    for (const item of queue) {
      if (absorbed.has(item.id) || pairedWrites.has(item.id)) continue;
      const move = moves.get(item.id);
      if (move) {
        const refused = new WorkspaceProtocolError("authorization", "the new place of a move made outside the app is not permitted by the active workspace policy");
        if (await this.keepRefusedMutation({ ...item, operation: "rename", newPath: move.path }, refused, move) === "restore-pending") unreadable.push(item.path, move.path);
        continue;
      }
      if (signal?.aborted) throw new DOMException("Encrypted workspace push aborted", "AbortError");
      if (!item.prepared && unreadable.some((path) => touches(item, path))) continue;
      this.onProgress?.({ phase: "push", current: ++current, total: queue.length });
      try {
        let prepared = item.prepared;
        if (!prepared) {
          try {
            prepared = await this.prepareMutation(item, queue);
          } catch (error) {
            if (error instanceof WorkspaceUnreadableFileError) {
              console.warn(`[EncryptedWorkspaceWorker] ${error.message}; it is tried again at the next sync`);
              await this.state.markQueueFailed(item.id, error.message);
              unreadable.push(error.path, item.path);
              continue;
            }
            // A device the policy no longer counts as active is not refused one
            // change at a time: that stays the error it is.
            if (!isRefusedByPolicy(error) || !this.deviceIsActive()) throw error;
            if (await this.keepRefusedMutation(item, error) === "restore-pending") unreadable.push(item.path, ...(item.newPath ? [item.newPath] : []));
            continue;
          }
        }
        if (!prepared) { await this.state.discardQueue(item.id); continue; }
        for (const queueId of prepared.absorbedQueueIds) absorbed.add(queueId);
        await this.uploadPrepared(item, prepared, signal);
      } catch (error) {
        if (isWorkspaceSyncAborted(error, signal)) throw error;
        await this.state.markQueueFailed(item.id, error instanceof Error ? error.message : String(error));
        throw error;
      }
    }
    queue = await this.state.listQueue(1);
    if (queue.length === 0) this.onProgress?.(null);
  }

  /**
   * The queue ids of the deletions the mass-deletion guard holds back in this
   * cycle (A4), signalling the question once. A prepared deletion has taken
   * its sequence already and is finished, never held; a confirmed one
   * (`confirmedAt`) or one let go in this session is not counted.
   */
  private async heldDeletions(queue: WorkspaceQueuedMutation[]): Promise<Set<number>> {
    const pendingIds = new Set(queue.map((item) => item.id));
    for (const id of [...this.massDeletionApprovedIds]) if (!pendingIds.has(id)) this.massDeletionApprovedIds.delete(id);
    const unconfirmed = queue.filter((item) => item.operation === "delete" && !item.prepared && item.confirmedAt == null && !this.massDeletionApprovedIds.has(item.id));
    // Counted in files: a folder is an object of its own here, and its
    // deletion takes every file in it (`vanishingFiles`).
    const liveFiles = unconfirmed.length > 0
      ? (await this.state.listObjects(false)).filter((object) => !object.deleted && object.contentKind !== "directory").map((object) => object.path)
      : [];
    const vanishing = vanishingFiles(unconfirmed.map((item) => item.path), liveFiles);
    const liveTotal = liveFiles.length;
    if (!isMassFileDeletion(vanishing, liveTotal)) {
      this.massDeletionSignaled = false;
      this.massDeletionPromptIds = [];
      return new Set();
    }
    console.warn(`[EncryptedWorkspaceWorker] ${vanishing} of ${liveTotal} files are queued for deletion; deletions are paused until confirmed`);
    if (!this.massDeletionSignaled) {
      this.massDeletionSignaled = true;
      this.massDeletionPromptIds = unconfirmed.map((item) => item.id);
      try {
        this.onMassDeletionPending?.({ pendingDeletes: vanishing, syncedTotal: liveTotal });
      } catch (error) {
        console.error("[EncryptedWorkspaceWorker] onMassDeletionPending consumer failed:", error);
      }
    }
    return new Set(unconfirmed.map((item) => item.id));
  }

  /**
   * A queued change the policy refuses before it is signed ends as a refused
   * change from outside does: a local fork, and the queue goes on (release
   * 0.9.0). Until then the push stopped at the entry and failed every cycle,
   * and with it everything behind it — the rest of the queue, the checkpoint,
   * the publications, the settings. The app checks before the disk is
   * touched, but not always with what the worker sees: a policy changed on
   * another device since, a slice that matches by tags or properties, an
   * object no group could read.
   */
  /**
   * Queues the deletion of each object in a deleted folder that is gone from
   * the disk, deepest first, and the folder's after them; true when it did.
   */
  private async expandFolderDeletion(item: WorkspaceQueuedMutation): Promise<boolean> {
    const folder = await this.state.getObjectByPath(item.path);
    if (!folder || folder.deleted || folder.contentKind !== "directory") return false;
    const inside: WorkspaceObjectRecord[] = [];
    for (const object of await this.state.listObjects(false)) if (object.path.startsWith(`${item.path}/`) && !(await this.vault.exists(object.path))) inside.push(object);
    if (inside.length === 0) return false;
    const confirmed = item.confirmedAt != null || this.massDeletionApprovedIds.has(item.id);
    inside.sort((left, right) => right.path.split("/").length - left.path.split("/").length || Number(left.contentKind === "directory") - Number(right.contentKind === "directory"));
    for (const object of inside) await this.state.enqueue("delete", object.path, null, { confirmed });
    await this.state.discardQueue(item.id);
    await this.state.enqueue("delete", item.path, null, { confirmed });
    return true;
  }

  /** Whether this member may make a new file or folder at `path`, with `plaintext` where it is known. */
  private mayCreateAt(path: string, directory: boolean, plaintext?: Uint8Array): boolean {
    const policy = this.activePolicy.payload;
    const objectId = createWorkspaceObjectId();
    const contentKind = directory ? "directory" : isTextFile(path) ? "text" : "binary";
    const object: WorkspaceSliceObject = plaintext ? { ...sliceObjectWithContent(objectId, path, contentKind, plaintext), mime: mimeForPath(path, directory) } : { objectId, path, contentKind };
    return evaluateWorkspaceAccess(policy, { memberId: this.runtime.memberId, deviceId: this.runtime.device.publicIdentity.deviceId, capability: operationCapability(directory ? "mkdir" : "create"), objectId, sliceIds: workspaceSliceIdsForObject(policy, object), object }).allowed;
  }

  private deviceIsActive(): boolean {
    const deviceId = this.runtime.device.publicIdentity.deviceId;
    return this.activePolicy.payload.devices.some((device) => device.deviceId === deviceId && device.state === "active");
  }

  /**
   * A refused change never turns into one the person did not make (review of
   * release 0.9.0). The workspace keeps what it holds: a deletion or a move
   * the policy refuses brings the original back to its place here — taken out
   * of the queue with the original still missing, the next start found it gone
   * and queued its deletion, and the note left every device without a
   * question. What the person made stays theirs: the file at the new place of
   * a refused move, like a refused creation or edit, is kept as a local fork.
   * The original comes back first. If it cannot be brought back — its
   * revision unreadable from the store — the entry stays as a restore still
   * owed (`RESTORE_PENDING`), is tried again once per cycle and named once
   * (`onChangesRefused`), and the rest of the queue goes on: it held the push
   * for good, everything behind it with it (review of release 0.9.0).
   * `paired` is the entry of the new file a move made outside the app left
   * (`pairedMoves`); it ends with the move.
   */
  private async keepRefusedMutation(item: WorkspaceQueuedMutation, error: unknown, paired: WorkspaceQueuedMutation | null = null): Promise<"kept" | "restore-pending"> {
    const path = item.operation === "rename" && item.newPath ? item.newPath : item.path;
    console.warn(`[EncryptedWorkspaceWorker] ${item.operation} ${path} is refused by the workspace policy; kept on this device as a local fork`, error);
    if (item.operation === "delete" || item.operation === "rename") {
      try {
        await this.restoreOriginal(item.path);
      } catch (restoreError) {
        const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
        console.warn(`[EncryptedWorkspaceWorker] the original of ${item.path} could not be brought back; it is tried again at the next sync`, restoreError);
        await this.state.markQueueFailed(item.id, `${RESTORE_PENDING}${message}`);
        if (!this.restorePendingNamed.has(item.path)) {
          this.restorePendingNamed.add(item.path);
          this.restorePendingFresh.push(item.path);
        }
        return "restore-pending";
      }
    }
    this.restorePendingNamed.delete(item.path);
    await withPathMutation(this.state, [path], () => recordWorkspaceDeniedChange(this.vault, this.state, path, item.operation !== "delete"));
    await this.state.discardQueue(item.id);
    if (paired) await this.state.discardQueue(paired.id);
    return "kept";
  }

  /** The object the workspace holds at `path`, written back from its current revision where it is missing here. */
  private async restoreOriginal(path: string): Promise<void> {
    const history = new WorkspaceRevisionHistoryService(this.objectStore, this.state, this.runtime.groupKeys);
    const restored = await withPathMutation(this.state, [path], async () => {
      const object = await this.state.getObjectByPath(path);
      if (!object || object.deleted || !object.currentRevisionId || await this.vault.exists(path)) return false;
      // An original this device may no longer read is not its to bring back: it stays in the workspace, for the others.
      if (object.contentKind !== "directory" && !(await this.readableHere(object))) return false;
      if (object.contentKind === "directory") await this.vault.createDir(path);
      else await this.vault.writeBinaryFile(path, await history.read(object.currentRevisionId));
      return true;
    });
    if (restored) this.onFilesChanged?.([path]);
  }

  /**
   * A move made outside the app while it runs reaches the queue as a deletion
   * and a new file (review of release 0.9.0). Into a place the member may not
   * write, the new file was refused and the deletion went out: the note was
   * gone for everyone. Read as the move it is when exactly one deletion of a
   * missing note and exactly one new file share the same, non-empty bytes,
   * and the new file is refused — the start reads a move made while the app
   * was closed by the same rule. By the deletion's queue id, the new file's
   * entry. A move to a place the member may write stays the deletion and the
   * new file it came as: both go out.
   */
  private async pairedMoves(queue: WorkspaceQueuedMutation[]): Promise<Map<number, WorkspaceQueuedMutation>> {
    const pairs = new Map<number, WorkspaceQueuedMutation>();
    const deletions = queue.filter((item) => item.operation === "delete" && !item.prepared);
    const writes = queue.filter((item) => item.operation === "write" && !item.prepared);
    if (deletions.length === 0 || writes.length === 0) return pairs;
    const missing = new Map<string, WorkspaceQueuedMutation[]>();
    for (const item of deletions) {
      const object = await this.state.getObjectByPath(item.path);
      if (!object || object.deleted || object.contentKind === "directory" || !object.plaintextSha256 || object.plaintextSha256 === EMPTY_SHA256) continue;
      if (await this.vault.exists(item.path)) continue;
      missing.set(object.plaintextSha256, [...(missing.get(object.plaintextSha256) ?? []), item]);
    }
    if (missing.size === 0) return pairs;
    const arrived = new Map<string, Array<{ item: WorkspaceQueuedMutation; bytes: Uint8Array }>>();
    for (const item of writes) {
      const object = await this.state.getObjectByPath(item.path);
      if (object && !object.deleted) continue;
      let bytes: Uint8Array;
      try {
        if (!(await this.vault.exists(item.path)) || (await this.vault.getFileInfo(item.path)).isDirectory) continue;
        bytes = await this.vault.readBinaryFile(item.path);
      } catch {
        continue;
      }
      const sha = sha256Hex(bytes);
      if (missing.has(sha)) arrived.set(sha, [...(arrived.get(sha) ?? []), { item, bytes }]);
    }
    for (const [sha, found] of arrived) {
      const gone = missing.get(sha)!;
      if (gone.length !== 1 || found.length !== 1) continue;
      if (this.mayCreateAt(found[0].item.path, false, found[0].bytes)) continue;
      pairs.set(gone[0].id, found[0].item);
    }
    return pairs;
  }

  /** False only when the object's current version is there and sealed for none of this device's keys. */
  private async readableHere(object: WorkspaceObjectRecord): Promise<boolean> {
    if (!object.payloadHash) return true;
    const bytes = await this.objectStore.get(`.pvws/objects/${object.objectId}/${object.payloadHash}.pvobj`);
    if (!bytes) return true;
    try {
      return parsePvo1Frame(bytes).envelopes.some((envelope) => this.runtime.groupKeys.some((key) => key.groupId === envelope.groupId && key.keyEpoch === envelope.keyEpoch));
    } catch {
      return true;
    }
  }

  private async resumePreparedMutations(signal?: AbortSignal): Promise<void> {
    const queue = await this.state.listQueue(100_000);
    const absorbed = new Set<number>();
    for (const item of queue) {
      if (absorbed.has(item.id) || !item.prepared) continue;
      for (const queueId of item.prepared.absorbedQueueIds ?? []) absorbed.add(queueId);
      await this.uploadPrepared(item, { ...item.prepared, absorbedQueueIds: item.prepared.absorbedQueueIds ?? [] }, signal);
    }
  }

  private async resolveRenameChain(
    item: WorkspaceQueuedMutation,
    queue: WorkspaceQueuedMutation[]
  ): Promise<{ item: WorkspaceQueuedMutation; absorbedQueueIds: number[] }> {
    if (item.operation !== "rename" || !item.newPath) return { item, absorbedQueueIds: [] };
    let destination = item.newPath;
    const absorbedQueueIds: number[] = [];
    // A chain of moves of one file (a.md -> c.md -> a.md -> b.md, made
    // offline) is one move from its first place to its last, or none: a
    // place passed twice is no cycle (review of release 0.9.0, the queue of
    // such a device hung for good). Each step is absorbed once, so it ends.
    while (!(await this.vault.exists(destination))) {
      const next = queue.find((candidate) =>
        candidate.id > item.id && !candidate.prepared && !absorbedQueueIds.includes(candidate.id) &&
        candidate.path === destination && (candidate.operation === "rename" || candidate.operation === "delete")
      );
      if (!next) break;
      absorbedQueueIds.push(next.id);
      if (next.operation === "delete") {
        return { item: { ...item, operation: "delete", newPath: null }, absorbedQueueIds };
      }
      protocolAssert(!!next.newPath, "format", "rename queue item is missing its destination");
      destination = next.newPath;
    }
    return { item: { ...item, newPath: destination }, absorbedQueueIds };
  }

  private async prepareMutation(item: WorkspaceQueuedMutation, queue: WorkspaceQueuedMutation[]): Promise<PreparedWorkspaceMutation | null> {
    return withPathMutation(this.state, [item.path, ...(item.newPath ? [item.newPath] : [])], () => this.prepareMutationLocked(item, queue));
  }

  private async prepareMutationLocked(item: WorkspaceQueuedMutation, queue: WorkspaceQueuedMutation[]): Promise<PreparedWorkspaceMutation | null> {
    const resolved = await this.resolveRenameChain(item, queue);
    item = resolved.item;
    const meta = await this.requireMeta();
    // A deleted object is no source (release 0.9.0, review of A4): a note
    // deleted and made again under its name is a new object. Taken as the
    // deleted one, it went out as a "write" without a revision parent, which
    // every reader refuses — and the push failed at it, with everything behind
    // it, for good.
    const found = await this.state.getObjectByPath(item.path);
    const source = found && !found.deleted ? found : null;
    const targetPath = item.operation === "rename" ? item.newPath : item.path;
    if (!targetPath) throw new WorkspaceProtocolError("format", "rename queue item is missing its destination");
    if (item.operation === "delete" && !source?.currentRevisionId) return null;
    if (item.operation !== "delete" && !(await this.vault.exists(targetPath))) return null;
    let info: Awaited<ReturnType<IVaultAdapter["getFileInfo"]>> | null;
    let plaintext: Uint8Array;
    try {
      info = item.operation === "delete" ? null : await this.vault.getFileInfo(targetPath);
      plaintext = item.operation === "delete" || item.operation === "mkdir" || info?.isDirectory === true ? new Uint8Array() : await this.vault.readBinaryFile(targetPath);
    } catch (error) {
      throw new WorkspaceUnreadableFileError(targetPath, error);
    }
    const directory = item.operation === "mkdir" || info?.isDirectory === true;
    const objectId = source?.objectId ?? createWorkspaceObjectId();
    const revisionId = item.operation === "delete" ? null : createWorkspaceRevisionId();
    const operationName: WorkspaceOperationName = item.operation === "write"
      ? source ? "write" : "create"
      : item.operation === "mkdir"
        ? source ? "write" : "mkdir"
        : item.operation === "rename" && !source
          ? directory ? "mkdir" : "create"
          : item.operation;
    const policy = this.activePolicy.payload;
    const accessObject: WorkspaceSliceObject = { ...sliceObjectWithContent(objectId, targetPath, directory ? "directory" : isTextFile(targetPath) ? "text" : "binary", plaintext), mime: mimeForPath(targetPath, directory) };
    const sliceIds = workspaceSliceIdsForObject(policy, accessObject);
    protocolAssert(evaluateWorkspaceAccess(policy, { memberId: meta.memberId, deviceId: meta.deviceId, capability: operationCapability(operationName), objectId, sliceIds, object: accessObject, objectAuthorMemberId: source?.authorMemberId ?? null }).allowed, "authorization", "local mutation is not permitted by the active workspace policy");
    if (item.operation === "rename" && source) {
      const sourceSliceIds = workspaceSliceIdsForObject(policy, { objectId, path: source.path, contentKind: source.contentKind });
      protocolAssert(evaluateWorkspaceAccess(policy, { memberId: meta.memberId, deviceId: meta.deviceId, capability: "content.rename", objectId, sliceIds: sourceSliceIds }).allowed, "authorization", "source object cannot be renamed by the current member");
    }
    const recipientGroupIds = item.operation === "delete" ? [] : workspaceRecipientGroupIds(policy, accessObject);
    const recipients = recipientGroupIds.map((groupId) => {
      const group = policy.groups.find((entry) => entry.groupId === groupId);
      protocolAssert(!!group, "integrity", "recipient group is missing from policy");
      return { groupId, keyEpoch: group.keyEpoch, publicKey: decodeBase64Exact(group.hpkePublicKey, 32, "recipient group public key") };
    });
    if (item.operation !== "delete") protocolAssert(recipients.length > 0, "authorization", "mutation would be unreadable because no recipient group has content.read");
    const createdAt = source?.createdAt ?? nowIso();
    const modifiedAt = nowIso();
    let objectLocalPath: string | null = null;
    let objectRemoteKey: string | null = null;
    let objectSha256: string | null = null;
    const chunks: PreparedWorkspaceMutation["chunks"] = [];
    if (revisionId) {
      const metadata = {
        path: assertCanonicalVaultPath(targetPath),
        mime: mimeForPath(targetPath, directory),
        parentObjectId: null,
        createdAt,
        modifiedAt,
        contentKind: (directory || isTextFile(targetPath) ? "text" : "binary") as "text" | "binary",
      };
      let objectBytes: Uint8Array;
      if (plaintext.length <= MAX_INLINE_PLAINTEXT_BYTES) {
        objectBytes = await sealInlinePvo1({
          workspaceId: meta.workspaceId,
          objectId,
          revisionId,
          recipients,
          metadata,
          plaintext,
        });
      } else {
        const sealed = await sealChunkedPvo1({
          workspaceId: meta.workspaceId,
          objectId,
          revisionId,
          recipients,
          metadata,
          chunks: splitPvo1Chunks(plaintext),
        });
        objectBytes = sealed.object;
        await this.vault.createDir(`${STAGING_ROOT}/${revisionId}/chunks`);
        for (let index = 0; index < sealed.chunks.length; index += 1) {
          const sha = sealed.manifest.chunks[index].sha256;
          const localPath = `${STAGING_ROOT}/${revisionId}/chunks/${index}-${sha}.pvchunk`;
          await this.vault.writeBinaryFile(localPath, sealed.chunks[index]);
          chunks.push({ localPath, remoteKey: `.pvws/chunks/${objectId}/${revisionId}/${index}-${sha}.pvchunk`, sha256: sha });
        }
      }
      objectSha256 = sha256Hex(objectBytes);
      objectLocalPath = `${STAGING_ROOT}/${revisionId}/${objectSha256}.pvobj`;
      objectRemoteKey = `.pvws/objects/${objectId}/${objectSha256}.pvobj`;
      await this.vault.createDir(`${STAGING_ROOT}/${revisionId}`);
      await this.vault.writeBinaryFile(objectLocalPath, objectBytes);
    }
    const sequence = meta.sequence + 1;
    const payload: WorkspaceOperationPayload = {
      operationId: createWorkspaceObjectId(),
      deviceId: meta.deviceId,
      memberId: meta.memberId,
      sequence,
      previousDeviceOperationHash: meta.previousOperationHash,
      policyHash: meta.policyHash,
      capability: operationCapability(operationName),
      operation: operationName,
      objectId,
      revisionId,
      parentRevisionIds: source?.currentRevisionId ? [source.currentRevisionId] : [],
      payloadHash: objectSha256,
      createdAt: modifiedAt,
    };
    const operationDocument = signWorkspaceDocument(
      { kind: "operation", protocolVersion: 1, workspaceId: meta.workspaceId, payload },
      deviceSigner(this.runtime),
      this.runtime.device.secrets.signing.privateKey
    );
    const operationHash = workspaceDocumentHash(operationDocument);
    const object: WorkspaceObjectRecord = item.operation === "delete"
      ? { ...source!, currentRevisionId: null, payloadHash: null, plaintextSha256: null, deleted: true, modifiedAt }
      : {
          objectId,
          path: targetPath,
          currentRevisionId: revisionId,
          payloadHash: objectSha256,
          plaintextSha256: sha256Hex(plaintext),
          contentKind: directory ? "directory" : isTextFile(targetPath) ? "text" : "binary",
          deleted: false,
          authorMemberId: source?.authorMemberId || meta.memberId,
          createdAt,
          modifiedAt,
        };
    const revision: WorkspaceRevisionRecord | null = revisionId ? {
      revisionId,
      objectId,
      payloadHash: objectSha256,
      parentRevisionIds: payload.parentRevisionIds,
      operationHash,
      deviceId: meta.deviceId,
      sequence,
      materializedPath: targetPath,
      plaintextSha256: sha256Hex(plaintext),
      createdAt: modifiedAt,
    } : null;
    const prepared: PreparedWorkspaceMutation = {
      operationHash,
      operationDocument: toBase64(encodeWorkspaceDocument(operationDocument)),
      operationRemoteKey: `.pvws/operations/${meta.deviceId}/${sequence}-${operationHash}.pvop`,
      objectRemoteKey,
      objectLocalPath,
      objectSha256,
      chunks,
      absorbedQueueIds: resolved.absorbedQueueIds,
      object,
      revision,
    };
    meta.sequence = sequence;
    meta.previousOperationHash = operationHash;
    meta.operationHeads[meta.deviceId] = { sequence, operationHash };
    await this.state.reservePrepared(item.id, prepared, meta);
    return prepared;
  }

  private async uploadPrepared(item: WorkspaceQueuedMutation, prepared: PreparedWorkspaceMutation, signal?: AbortSignal): Promise<void> {
    for (const chunk of prepared.chunks) {
      const bytes = await this.vault.readBinaryFile(chunk.localPath);
      await this.objectStore.putImmutable(chunk.remoteKey, bytes, chunk.sha256, { signal });
    }
    if (prepared.objectLocalPath && prepared.objectRemoteKey && prepared.objectSha256) {
      const bytes = await this.vault.readBinaryFile(prepared.objectLocalPath);
      await this.objectStore.putImmutable(prepared.objectRemoteKey, bytes, prepared.objectSha256, { signal });
    }
    const operationBytes = fromBase64(prepared.operationDocument);
    await this.objectStore.putImmutable(prepared.operationRemoteKey, operationBytes, prepared.operationHash, { signal });
    const meta = await this.requireMeta();
    if (meta.phase === "migrating") meta.migrationCompleted = Math.min(meta.migrationTotal, meta.migrationCompleted + 1);
    meta.needsPublication = true;
    await this.state.commitQueued(item.id, {
      object: prepared.object,
      revision: prepared.revision,
      operationHash: prepared.operationHash,
      operationDocument: prepared.operationDocument,
      deviceId: meta.deviceId,
      sequence: prepared.revision?.sequence ?? meta.sequence,
    }, meta, prepared.absorbedQueueIds ?? []);
    if (prepared.objectLocalPath) {
      const folder = prepared.objectLocalPath.split("/").slice(0, -1).join("/");
      await this.vault.deleteItem(folder, true).catch(() => { /* silent: a staging folder left over after the object was committed; nothing reads it */ });
    }
  }

  /**
   * Brings every published slice back in line with the vault (S4b).
   *
   * After the checkpoint rather than before: a publication must not hand out a
   * revision the main workspace has not accepted yet.
   *
   * Swallowed rather than thrown, and deliberately so - the per-publication
   * reasons are already written to their records, and a provider outage on a
   * shared folder must not put the vault's own sync into an error state.
   */
  private async refreshPublications(signal?: AbortSignal): Promise<void> {
    const openPublicationRuntime = this.options.openPublicationRuntime;
    if (!openPublicationRuntime) return;
    try {
      const outcomes = await refreshWorkspacePublications({
        state: this.state,
        vault: this.vault,
        policy: this.activePolicy.payload,
        store: this.objectStore,
        workspaceId: this.runtime.workspaceId,
        openPublicationRuntime,
        signal,
      });
      if (outcomes.length > 0) this.options.onPublicationsRefreshed?.(outcomes);
    } catch {
      // Reading the publication list failed; the next cycle tries again.
    }
  }

  private async publishCheckpoint(signal?: AbortSignal): Promise<void> {
    const meta = await this.requireMeta();
    if (!meta.needsPublication && !meta.pendingPublication) return;
    if (!meta.pendingPublication) meta.pendingPublication = await this.preparePublication(meta);
    await this.state.saveMeta(meta);
    const publication = meta.pendingPublication;
    const catalogs = publication.catalogs ?? [{ groupId: meta.groupId, keyEpoch: meta.keyEpoch, version: publication.catalogVersion, hash: publication.catalogHash, document: publication.catalogDocument, remoteKey: publication.catalogRemoteKey }];
    for (const catalog of catalogs) await this.objectStore.putImmutable(catalog.remoteKey, fromBase64(catalog.document), catalog.hash, { signal });
    await this.objectStore.putImmutable(publication.checkpointRemoteKey, fromBase64(publication.checkpointDocument), publication.checkpointHash, { signal });
    if (publication.headDocument && publication.headRemoteKey) {
      const headBytes = fromBase64(publication.headDocument);
      const result = await this.objectStore.compareAndSwapPointer(publication.headRemoteKey, headBytes, meta.remoteHeadEtag, { signal });
      if (!result.swapped) {
        const current = await this.objectStore.get(publication.headRemoteKey, { signal });
        protocolAssert(current !== null && sha256Hex(current) === sha256Hex(headBytes), "conflict", "workspace head changed concurrently");
      }
      meta.remoteHeadEtag = result.etag ?? (await this.objectStore.head(publication.headRemoteKey, { signal }))?.etag ?? null;
    }
    meta.catalogVersion = publication.catalogVersion;
    meta.previousCatalogHash = publication.catalogHash;
    meta.catalogHeads ??= {};
    for (const catalog of catalogs) meta.catalogHeads[`${catalog.groupId}:${catalog.keyEpoch}`] = { version: catalog.version, hash: catalog.hash };
    meta.checkpointVersion = publication.checkpointVersion;
    meta.previousCheckpointHash = publication.checkpointHash;
    meta.pendingPublication = null;
    meta.needsPublication = false;
    await this.state.saveMeta(meta);
  }

  private async preparePublication(meta: WorkspaceRuntimeMeta): Promise<WorkspacePendingPublication> {
    const objects = (await this.state.listObjects())
      .filter((object) => object.currentRevisionId && object.payloadHash)
      .sort((left, right) => left.objectId.localeCompare(right.objectId));
    meta.catalogHeads ??= {};
    const catalogs = this.runtime.groupKeys.map((groupKey) => {
      const previous = meta.catalogHeads![`${groupKey.groupId}:${groupKey.keyEpoch}`];
      const objectRefs = objects.filter((object) => workspaceRecipientGroupIds(this.activePolicy.payload, { objectId: object.objectId, path: object.path, contentKind: object.contentKind }).includes(groupKey.groupId))
        .map((object) => ({ objectId: object.objectId, revisionId: object.currentRevisionId!, payloadHash: object.payloadHash! }))
        .sort((left, right) => `${left.objectId}:${left.revisionId}:${left.payloadHash}`.localeCompare(`${right.objectId}:${right.revisionId}:${right.payloadHash}`));
      const version = (previous?.version ?? 0) + 1;
      const document = createWorkspaceCatalog({ workspaceId: meta.workspaceId, groupId: groupKey.groupId, keyEpoch: groupKey.keyEpoch, catalogVersion: version, previousCatalogHash: previous?.hash ?? null, catalogKey: groupKey.catalogKey, objectRefs, signer: deviceSigner(this.runtime), signerPrivateKey: this.runtime.device.secrets.signing.privateKey });
      const hash = workspaceDocumentHash(document);
      return { groupId: groupKey.groupId, keyEpoch: groupKey.keyEpoch, version, hash, document: toBase64(encodeWorkspaceDocument(document)), remoteKey: `.pvws/catalogs/${groupKey.groupId}/${groupKey.keyEpoch}/${hash}.pvcat` };
    }).sort((a, b) => `${a.groupId}:${a.keyEpoch}`.localeCompare(`${b.groupId}:${b.keyEpoch}`));
    protocolAssert(catalogs.length > 0, "integrity", "workspace has no catalog key");
    const primary = catalogs.find((catalog) => catalog.groupId === meta.groupId && catalog.keyEpoch === meta.keyEpoch) ?? catalogs[0];
    const refs = objects.map((object) => ({ objectId: object.objectId, revisionId: object.currentRevisionId!, payloadHash: object.payloadHash! }));
    const checkpointVersion = meta.checkpointVersion + 1;
    const operationHeads = Object.entries(meta.operationHeads)
      .map(([deviceId, value]) => ({ deviceId, sequence: value.sequence, operationHash: value.operationHash }))
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
    const checkpoint = signWorkspaceDocument({
      kind: "checkpoint",
      protocolVersion: 1,
      workspaceId: meta.workspaceId,
      payload: {
        checkpointVersion,
        policyHash: meta.policyHash,
        operationHeads,
        objectRootHash: sha256Hex(utf8Encode(canonicalJson(refs))),
        createdAt: nowIso(),
      },
    }, deviceSigner(this.runtime), this.runtime.device.secrets.signing.privateKey);
    const checkpointHash = workspaceDocumentHash(checkpoint);
    const ownHead = meta.operationHeads[meta.deviceId];
    const head = ownHead ? signWorkspaceDocument({
      kind: "head",
      protocolVersion: 1,
      workspaceId: meta.workspaceId,
      payload: { deviceId: meta.deviceId, sequence: ownHead.sequence, operationHash: ownHead.operationHash, checkpointHash },
    }, deviceSigner(this.runtime), this.runtime.device.secrets.signing.privateKey) : null;
    return {
      catalogHash: primary.hash,
      catalogDocument: primary.document,
      catalogRemoteKey: primary.remoteKey,
      catalogs,
      checkpointHash,
      checkpointDocument: toBase64(encodeWorkspaceDocument(checkpoint)),
      checkpointRemoteKey: `.pvws/checkpoints/${checkpointHash}.pvcheck`,
      headDocument: head ? toBase64(encodeWorkspaceDocument(head)) : null,
      headRemoteKey: head ? `.pvws/heads/${meta.deviceId}.pvhead` : null,
      operationHash: ownHead?.operationHash ?? null,
      sequence: ownHead?.sequence ?? 0,
      catalogVersion: primary.version,
      checkpointVersion,
    };
  }

  private async verifyRemoteHeads(meta: WorkspaceRuntimeMeta, policy: WorkspacePolicyPayload, signal?: AbortSignal): Promise<void> {
    const infos = await listAll(this.objectStore, ".pvws/heads/", signal);
    for (const info of infos) {
      const bytes = await this.objectStore.get(info.key, { signal });
      if (!bytes) continue;
      try {
        const parsed = parseWorkspaceDocument(bytes);
        protocolAssert(parsed.kind === "head" && parsed.workspaceId === meta.workspaceId, "integrity", "workspace head binding mismatch");
        const payload = parsed.payload as { deviceId: string; sequence: number; operationHash: string; checkpointHash: string | null };
        const device = policy.devices.find((entry) => entry.deviceId === payload.deviceId);
        protocolAssert(!!device && verifyWorkspaceDocumentSignatures(parsed, (entry) => entry.signerId === device.deviceId ? decodeBase64Exact(device.signingPublicKey, 32, "head signing key") : null), "crypto", "workspace head signature verification failed");
        // A revoked device's pointer is not evidence of anything any more
        // (finding 2026-09-04). Heads are hints; taking this one would let a
        // revoked device raise the very boundary that holds it back.
        if (device.state === "revoked") continue;
        const observed = meta.operationHeads[payload.deviceId];
        // Our OWN pointer is not evidence about us (finding 2026-09-04). The
        // local head advances when an operation is PREPARED, the remote file is
        // written at the end of the cycle - so between the two this device
        // accused itself of rolling back the cloud, on every cycle that carried
        // local work. A lagging own pointer means one thing: write it again.
        // The checkpoint it names is still read below; ours is the one that
        // witnesses the other devices.
        const own = payload.deviceId === meta.deviceId;
        if (own) { if (observed && payload.sequence < observed.sequence) meta.needsPublication = true; }
        else protocolAssert(!observed || payload.sequence >= observed.sequence, "rollback", "remote workspace head rolled back below the locally observed sequence");
        if (payload.checkpointHash) {
          const checkpointKey = `.pvws/checkpoints/${payload.checkpointHash}.pvcheck`;
          const checkpointBytes = await this.objectStore.get(checkpointKey, { signal });
          protocolAssert(checkpointBytes !== null && sha256Hex(checkpointBytes) === payload.checkpointHash, "integrity", "workspace head checkpoint is missing or changed");
          try {
            const checkpoint = parseWorkspaceDocument(checkpointBytes);
            protocolAssert(checkpoint.kind === "checkpoint" && verifyWorkspaceDocumentSignatures(checkpoint, (entry) => {
              if (entry.signerKind === "device") {
                const signerDevice = policy.devices.find((candidate) => candidate.deviceId === entry.signerId);
                return signerDevice ? decodeBase64Exact(signerDevice.signingPublicKey, 32, "checkpoint signing key") : null;
              }
              return null;
            }), "crypto", "workspace checkpoint signature verification failed");
            // What an ACTIVE device vouched for: the boundary a revocation
            // gets (finding 2026-09-04). Only an active signer counts - a
            // revoked one would otherwise witness its own future.
            const signerId = checkpoint.signatures[0]?.signerId ?? null;
            const signerActive = policy.devices.some((candidate) => candidate.deviceId === signerId && candidate.state === "active");
            if (signerActive) {
              const heads = (checkpoint.payload as { operationHeads: Array<{ deviceId: string; sequence: number }> }).operationHeads;
              meta.checkpointHeads ??= {};
              for (const head of heads) {
                if ((meta.checkpointHeads[head.deviceId] ?? 0) < head.sequence) meta.checkpointHeads[head.deviceId] = head.sequence;
              }
            }
            await this.acceptArtifact("checkpoint", checkpointKey);
          } catch (error) {
            await this.quarantineArtifact("checkpoint", checkpointKey, checkpointBytes, error);
            throw error;
          }
        }
        // A device held behind a deletion keeps the head of what was applied:
        // pinned to its remote head, the held operations would no longer
        // continue the chain and go to quarantine on the next pull.
        if (!own && !this.heldDeviceIds.has(payload.deviceId)) meta.operationHeads[payload.deviceId] = { sequence: payload.sequence, operationHash: payload.operationHash };
        await this.acceptArtifact("head", info.key);
      } catch (error) {
        await this.quarantineArtifact("head", info.key, bytes, error);
      }
    }
    // Missing remote heads are not deletes. The last verified observation stays
    // pinned locally and will be compared again if that device reappears.
    await this.state.saveMeta(meta);
  }
}
