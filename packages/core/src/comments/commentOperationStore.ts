import { MigratingWorkspaceCommentStore } from "./MigratingWorkspaceCommentStore.js";
import { sameCommentOperationPlan, type CommentOperation, type CommentOperationJournal } from "./commentOperations.js";
import type { CommentStore } from "./store.js";

/** Only an already durable operation may finish on the old storage route.
 * A caller cannot manufacture an old writer key to start a new bundle write. */
export async function commentOperationStore(store: CommentStore, journal: CommentOperationJournal,
  operation?: CommentOperation): Promise<CommentStore> {
  if (!(store instanceof MigratingWorkspaceCommentStore) || !operation) return store;
  if (operation.authorKey === await store.writerKey()) return store;
  const saved = await journal.read(operation.operationId);
  if (!saved || !sameCommentOperationPlan(saved, operation) || operation.authorKey !== await store.legacy.writerKey())
    throw new Error("The comment operation has no matching legacy journal");
  return store.legacy;
}
