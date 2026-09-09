import { CommentOperationError, parseCommentOperation, type CommentOperation, type CommentOperationService } from "@plainva/core";
import { getWindowBus } from "./windowBus";

/** A window reply is a transport value; it must satisfy the durable contract. */
export function clientCommentOperations(vaultPath: string): CommentOperationService {
  const scope = { vaultPath };
  const invalid = () => new Error("Invalid comment operation reply from the vault owner");
  const decode = (value: unknown, id?: string): CommentOperation => {
    const operation = parseCommentOperation(JSON.stringify(value));
    if (operation.contextKey !== vaultPath || (id && operation.operationId !== id)) throw invalid();
    return operation;
  };
  return {
    prepare: async (input) => {
      const operation = decode(await (await getWindowBus()).request("comment-operation-prepare", input, scope));
      if (operation.phase !== "prepared" || operation.notePath !== input.notePath || operation.kind !== input.kind) throw invalid();
      return operation;
    },
    pending: async (path) => {
      const reply = await (await getWindowBus()).request("comment-operation-pending", { path }, scope);
      if (!Array.isArray(reply)) throw invalid();
      const operations = reply.map((value) => decode(value));
      if (operations.some((op) => op.phase === "completed") || new Set(operations.map((op) => op.operationId)).size !== operations.length) throw invalid();
      return operations;
    },
    read: async (operationId) => {
      const reply = await (await getWindowBus()).request("comment-operation-read", { operationId }, scope);
      return reply === null ? null : decode(reply, operationId);
    },
    run: async (operation) => {
      const result = await (await getWindowBus()).request("comment-operation-run", { operation }, scope);
      if (!result || typeof result.ok !== "boolean") throw invalid();
      if (!result.ok) {
        if (result.operationId !== operation.operationId || !["prepared", "text-confirmed", "markers-pending", "needs-review", "completed"].includes(result.phase)
          || !["storage", "context", "needs-review"].includes(result.reason)) throw invalid();
        throw new CommentOperationError(result.operationId, result.phase, result.reason);
      }
      const confirmed = decode(result.operation, operation.operationId);
      if (confirmed.phase !== "completed" || confirmed.authorKey !== operation.authorKey || confirmed.notePath !== operation.notePath) throw invalid();
      return confirmed;
    },
  };
}
