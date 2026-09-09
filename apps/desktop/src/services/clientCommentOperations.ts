import { CommentOperationError, type CommentOperationService } from "@plainva/core";
import { getWindowBus } from "./windowBus";

/** Every asynchronous request keeps the vault that created this client. */
export function clientCommentOperations(vaultPath: string): CommentOperationService {
  const scope = { vaultPath };
  return {
    prepare: async (input) => (await getWindowBus()).request("comment-operation-prepare", input, scope),
    pending: async (path) => (await getWindowBus()).request("comment-operation-pending", { path }, scope),
    read: async (operationId) => (await getWindowBus()).request("comment-operation-read", { operationId }, scope),
    run: async (operation) => {
      const result = await (await getWindowBus()).request("comment-operation-run", { operation }, scope);
      if (!result.ok) throw new CommentOperationError(result.operationId, result.phase, result.reason);
      return result.operation;
    },
  };
}
