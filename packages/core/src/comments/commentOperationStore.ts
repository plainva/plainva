import { MigratingWorkspaceCommentStore } from "./MigratingWorkspaceCommentStore.js";
import { sameCommentOperationPlan, type CommentOperation, type CommentOperationJournal } from "./commentOperations.js";
import type { CommentStore } from "./store.js";

/** Only an already durable operation may finish on the old storage route.
 * A caller cannot manufacture an old writer key to start a new bundle write. */
export async function commentOperationStore(store: CommentStore, journal: CommentOperationJournal,
  operation?: CommentOperation): Promise<CommentStore> {
  if (!(store instanceof MigratingWorkspaceCommentStore) || !operation) return store;
  const current = operation.authorKey === await store.writerKey();
  const saved = await journal.read(operation.operationId);
  if (!current && (!saved || !sameCommentOperationPlan(saved, operation) || operation.authorKey !== await store.legacy.writerKey()))
    throw new Error("The comment operation has no matching legacy journal");
  const route = current ? store : store.legacy;
  // Completed journals perform no writes. Every unfinished operation must
  // still have today's rights, including one prepared before the upgrade.
  if (saved?.phase !== "completed") {
    const path = await route.resolvePath(operation.notePath, operation.createdAt, operation.markers[0].targetObjectId);
    const capabilities = await store.capabilities(path);
    if (!capabilities?.includes("comment.create") || (operation.text && !capabilities.includes("content.write")))
      throw new Error("workspace-comment-operation-not-permitted");
  }
  return route;
}
