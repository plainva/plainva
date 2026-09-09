/** Desktop compatibility entry; both shells use the shared store contract. */
export { WorkspaceCommentStore, mergeCommentOutbox, type WorkspaceCommentStoreDeps } from "@plainva/core";

import { MigratingWorkspaceCommentStore, type CommentStore, type IVaultAdapter, type WorkspaceCommentStoreDeps } from "@plainva/core";
import { createLocalCommentStore } from "./localComments";

/** The production store choice, including an offline or currently locked workspace. */
export function createDesktopCommentStore(input: {
  vaultPath: string; raw: IVaultAdapter; workspaceId?: string;
  authorName(): Promise<string | null | undefined>;
  plane: WorkspaceCommentStoreDeps["plane"];
  worker: WorkspaceCommentStoreDeps["worker"];
  changed(path: string): void;
}): CommentStore {
  const legacy = createLocalCommentStore(input.vaultPath, input.raw, input.authorName, path => {
    input.worker()?.triggerImmediate(); input.changed(path);
  });
  if (!input.workspaceId) return legacy;
  return new MigratingWorkspaceCommentStore({
    plane: () => {
      const plane = input.plane();
      if (plane.runtime.workspaceId !== input.workspaceId) throw new Error("workspace-comment-runtime-changed");
      return plane;
    },
    worker: input.worker,
    changed: input.changed,
  }, legacy);
}
