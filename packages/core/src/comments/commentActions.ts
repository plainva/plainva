import { canonicalJson } from "../settingsSync/canonicalJson.js";
import { buildCommentAnchor, mintAnchorMarkerId, resolveCommentAnchor } from "../workspace/commentAnchor.js";
import { createWorkspaceObjectId } from "../workspace/identity.js";
import type { WorkspaceCommentRecord } from "../workspace/state.js";
import type { CommentOperationInput, CommentOperationService } from "./commentOperationService.js";
import type { CommentOperation } from "./commentOperations.js";

/** The meaning of a retry excludes freshly minted bookkeeping identities. */
function intent(input: CommentOperationInput | CommentOperation): string {
  return canonicalJson({ kind: input.kind, markers: input.markers.map((marker) => ({
    body: marker.body, parent: marker.parentCommentId ?? null,
    resolved: marker.resolvedCommentId ?? null, retracts: marker.retractsCommentId ?? null,
    outcome: marker.suggestionOutcome ?? null, suggestion: marker.suggestion ?? null,
    anchor: marker.anchor ? { ...marker.anchor, markerId: undefined } : null,
    batch: marker.batch ? { index: marker.batch.index, note: marker.batch.note } : null,
    reviewed: [...(marker.reviewedDecisionIds ?? [])].sort(),
  })) });
}

export function commentOperationMatchesInput(operation: CommentOperation, input: CommentOperationInput): boolean {
  return intent(operation) === intent(input);
}

export function planCommentRound(path: string, base: string, chunks: readonly { fromA: number; toA: number; replacement: string }[], note: string): CommentOperationInput {
  const batchId = createWorkspaceObjectId();
  return { notePath: path, kind: "post", markers: chunks.map((chunk, index) => ({ path, body: "", parentCommentId: null,
    anchor: buildCommentAnchor(base, chunk.fromA, chunk.toA, mintAnchorMarkerId(base)),
    suggestion: { replacement: chunk.replacement }, batch: { batchId, index, note: note.trim() || null } })) };
}

export class PendingCommentActionError extends Error {
  constructor(readonly operationId: string) { super("comment-operation-pending"); }
}
/** Thrown only before run() has been called; safe to release an unstarted identity. */
export class CommentActionNotStartedError extends Error {
  constructor() { super("comment-editor-changed"); }
}

/** Keeps the identity even when an RPC times out before its journal is visible. */
export class CommentActionController {
  private readonly remembered = new Map<string, CommentOperation>();
  private running = false;
  constructor(readonly service: CommentOperationService) {}

  async execute(input: CommentOperationInput, start: (operation: CommentOperation) => Promise<CommentOperation>): Promise<CommentOperation> {
    if (this.running) throw new Error("comment-operation-running");
    this.running = true;
    try {
      const captured = structuredClone(input);
      const pending = await this.service.pending(captured.notePath);
      const prepared = await this.service.prepare(captured);
      let operation = this.remembered.get(captured.notePath) ?? pending[0];
      if (operation) {
        const stored = await this.service.read(operation.operationId);
        if (stored) operation = stored;
        // A lost completion acknowledgement belongs to this click's retry.
        if (intent(operation) !== intent(prepared) || operation.authorKey !== prepared.authorKey ||
            operation.markers.some((marker, index) => marker.targetObjectId !== prepared.markers[index]?.targetObjectId)) {
          if (operation.phase !== "completed") throw new PendingCommentActionError(operation.operationId);
          this.remembered.delete(captured.notePath);
          operation = prepared;
        }
      } else operation = prepared;
      this.remembered.set(captured.notePath, operation);
      let result: CommentOperation;
      try { result = await start(operation); }
      catch (error) {
        if (error instanceof CommentActionNotStartedError && !await this.service.read(operation.operationId)) this.remembered.delete(captured.notePath);
        throw error;
      }
      this.remembered.delete(captured.notePath);
      return result;
    } finally { this.running = false; }
  }

  async resume(operation: CommentOperation, start: (operation: CommentOperation) => Promise<CommentOperation>): Promise<CommentOperation> {
    if (this.running) throw new Error("comment-operation-running");
    this.running = true;
    try {
      const current = await this.service.read(operation.operationId) ?? operation;
      const result = await start(current);
      for (const [path, saved] of this.remembered) if (saved.operationId === operation.operationId) this.remembered.delete(path);
      return result;
    } finally { this.running = false; }
  }
}

const controllers = new WeakMap<CommentOperationService, CommentActionController>();
export function commentActionController(service: CommentOperationService): CommentActionController {
  let controller = controllers.get(service);
  if (!controller) { controller = new CommentActionController(service); controllers.set(service, controller); }
  return controller;
}

/** Recompute every affected range against the flushed text, before any write. */
export function planCommentDecision(path: string, before: string, comments: readonly WorkspaceCommentRecord[], outcome: "applied" | "declined", reviewed = false): CommentOperationInput {
  if (!comments.length || new Set(comments.map((c) => c.commentId)).size !== comments.length) throw new Error("comment-decision-empty-or-duplicate");
  if (comments.some((c) => !c.suggestion || (!reviewed && c.suggestionDecision?.status === "conflict"))) throw new Error("comment-decision-needs-review");
  let intended = before;
  if (outcome === "applied" && !reviewed) {
    const spans = comments.map((comment) => {
      if (!comment.anchor) throw new Error("comment-suggestion-orphan");
      const resolution = resolveCommentAnchor(before, comment.anchor);
      if (resolution.status === "orphan") throw new Error("comment-suggestion-orphan");
      return { ...resolution, replacement: comment.suggestion!.replacement };
    }).sort((a, b) => b.from - a.from || b.to - a.to);
    for (let i = 1; i < spans.length; i++) {
      if (spans[i].to > spans[i - 1].from || spans[i].from === spans[i - 1].from) throw new Error("comment-suggestion-overlap");
    }
    for (const span of spans) intended = intended.slice(0, span.from) + span.replacement + intended.slice(span.to);
  }
  return { notePath: path, kind: outcome === "applied" ? "apply" : "decline",
    text: outcome === "applied" || reviewed ? { before, intended } : null,
    markers: comments.map((c) => ({ path, body: "", resolvedCommentId: c.commentId, suggestionOutcome: outcome,
      ...(c.targetRevisionId ? { targetObjectId: c.targetObjectId } : {}),
      ...(reviewed ? { reviewedDecisionIds: c.suggestionDecision?.knownIds ?? [] } : {}) })),
  };
}
