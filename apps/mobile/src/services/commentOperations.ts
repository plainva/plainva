import { createCommentOperationService, type CommentOperationService } from "@plainva/core";
import { mobileCommentStore, ensureMobileCommentAuthorName } from "./mobileComments";
import { mobileCommentOperationJournal } from "./commentOperationJournal";
import { noteSaver, vaultOps, type MobileVault } from "./vaultService";

const services = new WeakMap<MobileVault, CommentOperationService>();

/** Same durable operation as desktop, on this captured vault's native writer. */
export function mobileCommentOperations(vault: MobileVault): CommentOperationService {
  const existing = services.get(vault);
  if (existing) return existing;
  const store = mobileCommentStore(vault);
  const service = createCommentOperationService({
    contextKey: vault.vaultId,
    journal: mobileCommentOperationJournal(vault.vaultId),
    authorKey: () => store.writerKey(),
    prepareMarkers: async (input) => {
      if (input.markers.some((marker) => !marker.resolvedCommentId && !marker.retractsCommentId && (marker.body.trim() || marker.suggestion)))
        await ensureMobileCommentAuthorName(vault);
      const targetObjectId = await store.captureTarget(input.notePath);
      return input.markers.map((marker) => {
        if (marker.targetObjectId !== undefined && marker.targetObjectId !== targetObjectId) throw new Error("The comment target changed");
        return { ...marker, ...(targetObjectId ? { targetObjectId } : {}) };
      });
    },
    resolvePath: (operation) => store.resolvePath(operation.notePath, operation.createdAt, operation.markers[0].targetObjectId),
    withNoteLock: (path, work) => noteSaver.withWriteLock(path, vault, work),
    readText: (path) => vault.files.readTextFile(path),
    writeText: (path, text) => vaultOps.save(vault, path, text),
    post: (marker) => store.post(marker),
    changed: (operation) => window.dispatchEvent(new CustomEvent("plainva-comment-operation-changed", { detail: { vaultId: vault.vaultId, operation } })),
  });
  services.set(vault, service);
  return service;
}
