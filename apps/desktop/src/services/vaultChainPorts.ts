import { formatQueueEntryReport, type BackupVaultAdapterOptions, type IDatabaseAdapter, type IVaultAdapter, type PersonalWorkspaceRuntime, type SyncQueue, type VaultChainPorts, type WorkspaceStateStore } from "@plainva/core";
import { logDiagnostic, sayLineEndsConverted, workspaceWriteAuthorizer, type WorkspaceMoveQuestion } from "@plainva/ui";
import { getWindowBus } from "./windowBus";

/**
 * What the desktop hands `buildVaultChain` when a vault opens (stability plan
 * R2): its storage, its versions settings, its index, and — for an encrypted
 * workspace — the permission check, with the desktop's own dialog for a move
 * that takes access away. Kept out of the vault context so that a test builds
 * the chain from exactly these ports and sees what it refuses (review of
 * 2026-11-12: a source match proved only that a text was there).
 */
export interface DesktopChainInput {
  vaultPath: string;
  storage: IVaultAdapter;
  versions: BackupVaultAdapterOptions;
  deviceId: string;
  db: IDatabaseAdapter;
  queue: SyncQueue;
  /** The workspace's state and, when it is unlocked, its runtime; null for a plain vault. */
  workspace: { state: WorkspaceStateStore; runtime: PersonalWorkspaceRuntime | null } | null;
  /** The question before a move that takes access away (the app's confirm dialog). */
  confirm: (question: WorkspaceMoveQuestion) => Promise<boolean>;
}

export function desktopChainPorts(input: DesktopChainInput): VaultChainPorts {
  return {
    storage: input.storage,
    versions: input.versions,
    deviceId: input.deviceId,
    index: { db: input.db, queue: input.queue },
    // A locked workspace (no runtime) allows nothing (`workspaceWriteAuthorizer`).
    workspace: input.workspace
      ? { state: input.workspace.state, authorize: workspaceWriteAuthorizer(input.workspace.runtime, input.workspace.state, input.confirm) }
      : null,
    // The encrypted workspace's queue makes up for its entries the same way (D2).
    onQueueEntry: (report) => logDiagnostic("sync", formatQueueEntryReport(report)),
    // The adapter auto-merged external + local changes and wrote the result to disk.
    // Tell the editor so it adopts the merged content instead of overwriting it on the next save.
    onAutoMerged: (mergedPath, mergedText) => {
      window.dispatchEvent(new CustomEvent("plainva-auto-merged", { detail: { path: mergedPath, mergedText } }));
    },
    // A write turned line ends the file's shape does not keep (a carriage
    // return of its own) — every line of the file, unasked: said here for
    // every writer of the app at once, in this window and in the auxiliary
    // windows on this vault, whose saves come through this chain as well.
    onLineEndsConverted: (convertedPath, lineEnd) => {
      sayLineEndsConverted(convertedPath, lineEnd);
      void getWindowBus()
        .then((bus) => bus.broadcast("line-ends-converted", { path: convertedPath, eol: lineEnd }, input.vaultPath))
        .catch(() => { /* no bus (browser/test): a single window has said it */ });
    },
    kind: "external-folder",
  };
}
