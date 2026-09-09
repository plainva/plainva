import { containsTextChanges } from "../conflict-resolver.js";
import { createWorkspaceObjectId } from "../workspace/identity.js";
import { sha256Hex, utf8Encode } from "../workspace/encoding.js";
import { assertWorkspaceCommentAnchor } from "../workspace/commentAnchor.js";
import { assertWorkspaceSuggestion, assertWorkspaceSuggestionBatch } from "../workspace/collaboration.js";
import { commentWriteIdentity, sameCommentContent } from "./commentIdentity.js";
import type { CommentPostInput } from "./store.js";
import { isCommentDecisionReference } from "./commentDecisions.js";

export type DurableCommentPost = CommentPostInput & { identity: { commentId: string; createdAt: string } };
export type CommentOperationMarker = DurableCommentPost & { reviewedDecisionIds?: string[] };
export type CommentOperationPhase = "prepared" | "text-confirmed" | "markers-pending" | "completed" | "needs-review";
export interface CommentTextReceipt {
  beforeHash: string;
  intendedHash: string;
  confirmedHash: string;
  confirmedText: string;
  confirmedAt: string;
}
/** A local recovery record. Its text must never be included in diagnostics. */
export interface CommentOperation {
  version: 1;
  operationId: string;
  contextKey: string;
  authorKey: string;
  notePath: string;
  kind: "apply" | "decline" | "post" | "retract" | "resolve";
  createdAt: string;
  /** Null for a pure comment operation which does not edit the note. */
  text: { before: string; intended: string } | null;
  markers: CommentOperationMarker[];
  phase: CommentOperationPhase;
  receipt: CommentTextReceipt | null;
  postedIds: string[];
}

export interface CommentOperationJournal {
  /** Missing alone returns null. Unreadable or invalid records must reject. */
  read(id: string): Promise<CommentOperation | null>;
  /** Atomic, durable, and verified before resolving. */
  write(operation: CommentOperation): Promise<void>;
  list(): Promise<CommentOperation[]>;
}

export interface CommentOperationFiles {
  read(file: string): Promise<string | null>;
  writeAtomic(file: string, text: string): Promise<void>;
  /** Only the files of this dedicated journal directory. */
  list(): Promise<string[]>;
}

const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{32}$/.test(id);
const hashText = (text: string) => sha256Hex(utf8Encode(text));
function includesOperationText(before: string, intended: string, actual: string): boolean {
  // A decision made after reviewing unchanged text must still refer to that
  // exact text. An empty delta is not evidence for an arbitrary later note.
  return actual === intended || (before !== intended && containsTextChanges(before, intended, actual));
}
function requireRecord(condition: unknown): asserts condition {
  if (!condition) throw new Error("Invalid comment operation journal");
}
function validPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && !path.includes("\\") && !path.includes("\0")
    && !path.startsWith("/") && !path.split("/").some((part) => part === ".." || part === "." || part === "");
}

/** Strictly read our recovery format; malformed state is never a fresh start. */
export function parseCommentOperation(text: string): CommentOperation {
  const op = JSON.parse(text) as CommentOperation;
  requireRecord(op?.version === 1 && validId(op.operationId) && validPath(op.notePath)
    && typeof op.contextKey === "string" && op.contextKey.length > 0
    && typeof op.authorKey === "string" && op.authorKey.length > 0
    && ["apply", "decline", "post", "retract", "resolve"].includes(op.kind)
    && ["prepared", "text-confirmed", "markers-pending", "completed", "needs-review"].includes(op.phase));
  commentWriteIdentity({ commentId: op.operationId, createdAt: op.createdAt });
  requireRecord(op.text === null || (typeof op.text?.before === "string" && typeof op.text.intended === "string"));
  requireRecord(Array.isArray(op.markers) && op.markers.length > 0 && Array.isArray(op.postedIds));
  requireRecord(!op.markers.some((marker) => marker.suggestionOutcome === "applied") || op.text !== null);
  const ids = new Set<string>();
  for (const marker of op.markers) {
    requireRecord(marker && marker.path === op.notePath && typeof marker.body === "string" && marker.identity);
    requireRecord(marker.targetObjectId == null || validId(marker.targetObjectId));
    // The runner derives proof from its durable receipt, never from a caller's
    // unconfirmed assertion. The planned markers remain immutable on retries.
    requireRecord(marker.decisionProof == null);
    requireRecord(marker.reviewedDecisionIds === undefined || (op.text !== null && marker.suggestionOutcome
      && Array.isArray(marker.reviewedDecisionIds) && marker.reviewedDecisionIds.every(isCommentDecisionReference)
      && new Set(marker.reviewedDecisionIds).size === marker.reviewedDecisionIds.length));
    commentWriteIdentity(marker.identity);
    requireRecord(utf8Encode(marker.body).length <= 64 * 1024 && (marker.body.length > 0
      || marker.resolvedCommentId || marker.retractsCommentId || marker.suggestion));
    requireRecord(!ids.has(marker.identity.commentId));
    ids.add(marker.identity.commentId);
    for (const id of [marker.parentCommentId, marker.resolvedCommentId, marker.retractsCommentId]) requireRecord(id == null || validId(id));
    if (marker.anchor) assertWorkspaceCommentAnchor(marker.anchor);
    assertWorkspaceSuggestion(marker.suggestion, marker.anchor, marker.suggestionOutcome, marker.resolvedCommentId ?? null);
    assertWorkspaceSuggestionBatch(marker.batch ? { suggestionBatchId: marker.batch.batchId, batchIndex: marker.batch.index, batchNote: marker.batch.note } : {}, marker.suggestion);
    requireRecord(!marker.author || (typeof marker.author.id === "string" && marker.author.id.length > 0
      && (marker.author.displayName == null || typeof marker.author.displayName === "string")));
  }
  requireRecord(new Set(op.postedIds).size === op.postedIds.length && op.postedIds.every((id) => ids.has(id)));
  if (op.receipt !== null) {
    const receipt = op.receipt;
    requireRecord(op.text && typeof receipt?.confirmedText === "string"
      && receipt.beforeHash === hashText(op.text.before) && receipt.intendedHash === hashText(op.text.intended)
      && receipt.confirmedHash === hashText(receipt.confirmedText)
      && includesOperationText(op.text.before, op.text.intended, receipt.confirmedText));
    commentWriteIdentity({ commentId: op.operationId, createdAt: receipt.confirmedAt });
  }
  requireRecord(!op.text || !["text-confirmed", "markers-pending", "completed"].includes(op.phase) || op.receipt !== null);
  requireRecord(!["prepared", "needs-review"].includes(op.phase) || op.receipt === null);
  requireRecord(op.postedIds.length === 0 || op.phase === "markers-pending" || op.phase === "completed");
  requireRecord(op.phase !== "completed" || op.postedIds.length === op.markers.length);
  return op;
}

/** Both shells supply their existing local atomic file writer. */
export class FileCommentOperationJournal implements CommentOperationJournal {
  constructor(private readonly files: CommentOperationFiles) {}
  private file(id: string): string { requireRecord(validId(id)); return `${id}.json`; }
  async read(id: string): Promise<CommentOperation | null> {
    const raw = await this.files.read(this.file(id));
    if (raw === null) return null;
    const operation = parseCommentOperation(raw);
    requireRecord(operation.operationId === id);
    return operation;
  }
  async write(operation: CommentOperation): Promise<void> {
    const raw = JSON.stringify(operation);
    parseCommentOperation(raw);
    const file = this.file(operation.operationId);
    await this.files.writeAtomic(file, raw);
    // Native success alone does not confirm the bytes retained in the journal.
    requireRecord((await this.files.read(file)) === raw);
  }
  async list(): Promise<CommentOperation[]> {
    const operations: CommentOperation[] = [];
    for (const file of await this.files.list()) {
      if (!file.endsWith(".json")) continue;
      const id = file.slice(0, -5);
      requireRecord(validId(id));
      const op = await this.read(id);
      if (op) operations.push(op);
    }
    return operations.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.operationId.localeCompare(b.operationId));
  }
}

export function prepareCommentOperation(input: {
  contextKey: string; authorKey: string; notePath: string; kind: CommentOperation["kind"];
  text?: CommentOperation["text"]; markers: Array<CommentPostInput & { reviewedDecisionIds?: string[] }>; now?: string;
}): CommentOperation {
  const createdAt = input.now ?? new Date().toISOString();
  const op: CommentOperation = {
    version: 1, operationId: createWorkspaceObjectId(), contextKey: input.contextKey, authorKey: input.authorKey,
    notePath: input.notePath, kind: input.kind, createdAt, text: input.text ?? null,
    markers: input.markers.map((marker) => ({ ...marker, identity: commentWriteIdentity(marker.identity, createdAt) })),
    phase: "prepared", receipt: null, postedIds: [],
  };
  // Detach from caller-owned objects: later UI state must not alter the plan.
  return parseCommentOperation(JSON.stringify(op));
}

export interface CommentOperationDeps {
  /** Stable vault identity, shared by all wrappers of this local vault. */
  contextKey: string;
  journal: CommentOperationJournal;
  /** Must include the actual writer/device and workspace (where present). */
  authorKey(): Promise<string>;
  /** Captures the note's adapter and includes pending writes in teardown. */
  withNoteLock(path: string, work: () => Promise<void>): Promise<void>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  post(marker: DurableCommentPost): Promise<void>;
  changed?(operation: CommentOperation): void;
  now?(): string;
}

export class CommentOperationError extends Error {
  constructor(readonly operationId: string, readonly phase: CommentOperationPhase,
    readonly reason: "storage" | "context" | "needs-review", options?: ErrorOptions) {
    super("The comment operation is not complete", options);
    this.name = "CommentOperationError";
  }
}

const operationLanes = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (operationLanes.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  operationLanes.set(key, run);
  const clear = () => { if (operationLanes.get(key) === run) operationLanes.delete(key); };
  void run.then(clear, clear);
  return run;
}
function immutablePlan(op: CommentOperation) {
  const { version, operationId, contextKey, authorKey, notePath, kind, createdAt, text, markers } = op;
  return { version, operationId, contextKey, authorKey, notePath, kind, createdAt, text, markers };
}

/**
 * Text first, durable receipt second, immutable markers last. Recovery after
 * the receipt never replays text, even when the note has since been edited.
 * The caller flushes its editor BEFORE entering this note write lane.
 */
export class CommentOperationRunner {
  constructor(private readonly deps: CommentOperationDeps) {}
  run(prepared: CommentOperation): Promise<CommentOperation> {
    // Capture before the first await; do not trust a later caller mutation.
    const proposed = parseCommentOperation(JSON.stringify(prepared));
    return serialize(`${this.deps.contextKey}\0${proposed.operationId}`, async () => {
      let op = proposed;
      const publishState = () => this.deps.changed?.(parseCommentOperation(JSON.stringify(op)));
      const save = async () => { await this.deps.journal.write(op); publishState(); };
      const checkContext = async () => {
        if (op.contextKey !== this.deps.contextKey || await this.deps.authorKey() !== op.authorKey)
          throw new CommentOperationError(op.operationId, op.phase, "context");
      };
      try {
        await checkContext();
        const stored = await this.deps.journal.read(op.operationId);
        if (stored) {
          requireRecord(sameCommentContent(immutablePlan(stored), immutablePlan(op)));
          op = stored;
        } else {
          requireRecord(op.phase === "prepared" && op.postedIds.length === 0 && op.receipt === null);
          await save();
        }
        if (op.phase === "completed") return op;
        await this.deps.withNoteLock(op.notePath, async () => {
          await checkContext();
          if (op.text && !op.receipt) {
            const plannedText = op.text;
            let actual = await this.deps.readText(op.notePath);
            if (!includesOperationText(plannedText.before, plannedText.intended, actual)) {
              if (actual !== plannedText.before) {
                op = { ...op, phase: "needs-review" };
                await save();
                throw new CommentOperationError(op.operationId, op.phase, "needs-review");
              }
              await checkContext();
              await this.deps.writeText(op.notePath, plannedText.intended);
              actual = await this.deps.readText(op.notePath);
              if (!includesOperationText(plannedText.before, plannedText.intended, actual)) {
                op = { ...op, phase: "needs-review" };
                await save();
                throw new CommentOperationError(op.operationId, op.phase, "needs-review");
              }
            }
            op = { ...op, phase: "text-confirmed", receipt: {
              beforeHash: hashText(plannedText.before), intendedHash: hashText(plannedText.intended),
              confirmedHash: hashText(actual), confirmedText: actual,
              confirmedAt: this.deps.now?.() ?? new Date().toISOString(),
            } };
            await save();
          }
          // Also journal this phase for operations that never edit the note.
          op = { ...op, phase: "markers-pending" };
          await save();
          for (const marker of op.markers) {
            if (op.postedIds.includes(marker.identity.commentId)) continue;
            await checkContext();
            const { reviewedDecisionIds, ...posted } = marker;
            if (marker.suggestionOutcome && op.receipt) {
              const { beforeHash, intendedHash, confirmedHash, confirmedAt } = op.receipt;
              posted.decisionProof = { operationId: op.operationId, supersedes: reviewedDecisionIds ?? [],
                text: { beforeHash, intendedHash, confirmedHash, confirmedAt } };
            }
            await this.deps.post(posted);
            op = { ...op, postedIds: [...op.postedIds, marker.identity.commentId] };
            await save();
          }
          op = { ...op, phase: "completed" };
          await save();
        });
        return op;
      } catch (error) {
        if (error instanceof CommentOperationError) throw error;
        // Preserve the last durable phase. Neither a failed save nor a failed
        // marker can justify restoring an old whole-buffer snapshot.
        throw new CommentOperationError(op.operationId, op.phase, "storage", { cause: error });
      }
    });
  }
  async pending(path?: string): Promise<CommentOperation[]> {
    return (await this.deps.journal.list()).filter((op) => op.contextKey === this.deps.contextKey
      && op.phase !== "completed" && (path === undefined || op.notePath === path));
  }
}
