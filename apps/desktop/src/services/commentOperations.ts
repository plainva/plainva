import { createCommentOperationService, type CommentOperationInput, type CommentOperationService, type CommentStore, type IVaultAdapter } from "@plainva/core";
import { applyTextShape, readTextShape } from "@plainva/ui";
import { desktopCommentOperationJournal } from "./commentOperationJournal";
import { withPendingWrite } from "./pendingWrites";

/** Captured once for this vault/adapter/store lifetime, in the owner window. */
export function desktopCommentOperations(deps: {
  vaultPath: string;
  adapter: IVaultAdapter;
  store: CommentStore;
  assertCurrent(): void;
  ensureAuthorName(input: CommentOperationInput): Promise<void>;
  noteWritten(path: string): Promise<void>;
}): CommentOperationService {
  const { vaultPath, adapter, store } = deps;
  const paths = new Map<string, string>();
  return createCommentOperationService({
    contextKey: vaultPath,
    journal: desktopCommentOperationJournal(vaultPath),
    authorKey: async () => { deps.assertCurrent(); return store.writerKey(); },
    prepareMarkers: async (input) => {
      await deps.ensureAuthorName(input);
      deps.assertCurrent();
      const targetObjectId = await store.captureTarget(input.notePath);
      return input.markers.map((marker) => {
        if (marker.targetObjectId !== undefined && marker.targetObjectId !== targetObjectId) throw new Error("The comment target changed");
        return { ...marker, ...(targetObjectId ? { targetObjectId } : {}) };
      });
    },
    resolvePath: async (operation) => {
      const path = await store.resolvePath(operation.notePath, operation.createdAt, operation.markers[0].targetObjectId);
      paths.set(operation.operationId, path);
      return path;
    },
    withNoteLock: (path, work) => withPendingWrite(vaultPath, path, work),
    readText: async (path) => readTextShape(await adapter.readTextFile(path)).text,
    writeText: async (path, text) => {
      const { shape } = readTextShape(await adapter.readTextFile(path));
      await adapter.writeTextFile(path, applyTextShape(text, shape));
      // Indexing is derived work. Its failure must not turn a retained note
      // into an unconfirmed write or prevent recording the text receipt.
      try { await deps.noteWritten(path); }
      catch (error) { console.error("Could not refresh the note index after a comment operation", error); }
    },
    post: (marker) => store.post(marker),
    changed: (operation) => {
      const path = paths.get(operation.operationId) ?? operation.notePath;
      window.dispatchEvent(new CustomEvent("plainva-comment-operation-changed", { detail: { vaultPath, path, operation } }));
      if (operation.phase === "text-confirmed") {
        window.dispatchEvent(new CustomEvent("plainva-note-saved", { detail: { vaultPath, path } }));
        window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { vaultPath, path } }));
      }
      if (operation.phase === "completed") paths.delete(operation.operationId);
    },
  });
}
