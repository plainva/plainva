import { CommentActionNotStartedError, CommentOperationError, PendingCommentActionError, type CommentOperation, type CommentOperationService } from "@plainva/core";

export function commentActionErrorKey(error: unknown): string | null {
  if (error instanceof PendingCommentActionError) return "comments.operationPendingFirst";
  if (error instanceof CommentActionNotStartedError) return "comments.operationEditorChanged";
  if (error instanceof CommentOperationError) return error.reason === "needs-review" ? "comments.operationNeedsReview"
    : error.reason === "context" ? "comments.operationContextChanged" : "comments.operationSaveFailed";
  if (error instanceof Error) {
    if (error.message === "comment-editor-unavailable") return "comments.operationEditorChanged";
    if (error.message === "comment-suggestion-orphan" || error.message === "comment-suggestion-overlap") return "comments.suggestRoundOrphan";
    if (error.message === "comment-decision-needs-review") return "comments.decisionConflict";
    if (error.message === "comment-operation-running") return "comments.operationRunning";
  }
  return null;
}

/** An editor capture is a capability for one session and revision, not a path lookup. */
export interface CommentEditorSnapshot {
  text: string;
  alive?(): boolean;
  edit?(text: string): void;
  current(): boolean;
  adopt(confirmedText: string): void;
}

/** Listen before starting the write, so the receipt can reach the original
 * editor while the physical lane is still held and later typing is queued. */
export async function runVisibleCommentOperation(service: CommentOperationService, operation: CommentOperation, snapshot?: CommentEditorSnapshot): Promise<CommentOperation> {
  if (snapshot && !snapshot.current()) throw new CommentActionNotStartedError();
  let delivered = !!operation.receipt;
  const receive = (next: CommentOperation | null) => {
    if (!next || next.operationId !== operation.operationId || next.contextKey !== operation.contextKey || delivered || !next.receipt) return;
    delivered = true;
    snapshot?.adopt(next.receipt.confirmedText);
  };
  const changed = (event: Event) => {
    const detail = (event as CustomEvent<{ operation?: CommentOperation; operationId?: string; vaultPath?: string; vaultId?: string }>).detail;
    if ((detail.vaultPath ?? detail.vaultId) !== operation.contextKey) return;
    if (detail.operation) receive(detail.operation);
    else if (detail.operationId === operation.operationId) void service.read(operation.operationId).then(receive).catch(() => {});
  };
  window.addEventListener("plainva-comment-operation-changed", changed);
  try {
    const result = await service.run(operation);
    receive(result);
    return result;
  } finally {
    // A failed marker or lost RPC reply may follow a confirmed note write.
    try { receive(await service.read(operation.operationId)); } catch { /* The pending view reports an unreadable journal. */ }
    window.removeEventListener("plainva-comment-operation-changed", changed);
  }
}

/** Completion may arrive through another window or a recovery button. */
export function observeCompletedCommentRounds(service: CommentOperationService, contextKey: string, path: string, completed: (operation: CommentOperation) => void): () => void {
  let active = true;
  const changed = (event: Event) => {
    const d = (event as CustomEvent<{ operation?: CommentOperation; operationId?: string; vaultPath?: string; vaultId?: string; path?: string }>).detail;
    if ((d.vaultPath ?? d.vaultId) !== contextKey || (d.path && d.path !== path)) return;
    const receive = (operation: CommentOperation | null) => {
      if (active && operation?.contextKey === contextKey && (d.path ?? operation.notePath) === path
        && operation.phase === "completed" && operation.kind === "post" && operation.markers.every((m) => m.batch)) completed(operation);
    };
    if (d.operation) receive(d.operation);
    else if (d.operationId) void service.read(d.operationId).then(receive).catch(() => {});
  };
  window.addEventListener("plainva-comment-operation-changed", changed);
  return () => { active = false; window.removeEventListener("plainva-comment-operation-changed", changed); };
}

const editors = new Map<string, () => CommentEditorSnapshot>();
/** Mobile screen-to-editor bridge. Unregistering an old session cannot remove its replacement. */
export function registerCommentEditor(contextKey: string, path: string, capture: () => CommentEditorSnapshot): () => void {
  const key = JSON.stringify([contextKey, path]);
  editors.set(key, capture);
  return () => { if (editors.get(key) === capture) editors.delete(key); };
}
export function captureCommentEditor(contextKey: string, path: string): CommentEditorSnapshot {
  const capture = editors.get(JSON.stringify([contextKey, path]));
  if (!capture) throw new Error("comment-editor-unavailable");
  return capture();
}
