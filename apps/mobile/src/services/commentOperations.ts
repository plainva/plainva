import { commentOperationStore, createCommentOperationService, type CommentOperation, type CommentOperationService, type CommentStore } from "@plainva/core";
import { mobileCommentStore, ensureMobileCommentAuthorName } from "./mobileComments";
import { mobileCommentOperationJournal } from "./commentOperationJournal";
import { noteSaver, vaultOps, type MobileVault } from "./vaultService";

const services = new WeakMap<MobileVault, { store: CommentStore; service: CommentOperationService }>();

/** Same durable operation as desktop, on this captured vault's native writer. */
export function mobileCommentOperations(vault: MobileVault): CommentOperationService {
  const existing = services.get(vault);
  const store = mobileCommentStore(vault);
  if (existing?.store === store) return existing.service;
  const journal = mobileCommentOperationJournal(vault.vaultId);
  const route = async (operation?: CommentOperation) => {
    if (mobileCommentStore(vault) !== store) throw new Error("The comment store changed");
    return commentOperationStore(store, journal, operation);
  };
  const paths = new Map<string, string>();
  const service = createCommentOperationService({
    contextKey: vault.vaultId,
    journal,
    authorKey: async operation => (await route(operation)).writerKey(),
    prepareMarkers: async (input) => {
      if (input.markers.some((marker) => !marker.resolvedCommentId && !marker.retractsCommentId && (marker.body.trim() || marker.suggestion)))
        await ensureMobileCommentAuthorName(vault);
      const targetObjectId = await store.captureTarget(input.notePath);
      return input.markers.map((marker) => {
        if (marker.targetObjectId !== undefined && marker.targetObjectId !== targetObjectId) throw new Error("The comment target changed");
        return { ...marker, ...(targetObjectId ? { targetObjectId } : {}) };
      });
    },
    resolvePath: async (operation) => {
      const path = await (await route(operation)).resolvePath(operation.notePath, operation.createdAt, operation.markers[0].targetObjectId);
      paths.set(operation.operationId, path);
      return path;
    },
    withNoteLock: (path, work) => noteSaver.withWriteLock(path, vault, work),
    readText: (path) => vault.files.readTextFile(path),
    writeText: (path, text) => vaultOps.save(vault, path, text),
    post: async (marker, operation) => (await route(operation)).post(marker),
    changed: (operation) => {
      window.dispatchEvent(new CustomEvent("plainva-comment-operation-changed", { detail: { vaultId: vault.vaultId, path: paths.get(operation.operationId) ?? operation.notePath, operation } }));
      if (operation.phase === "completed") paths.delete(operation.operationId);
    },
  });
  services.set(vault, { store, service });
  return service;
}
