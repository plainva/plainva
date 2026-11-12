import { formatQueueEntryReport, type BackupVaultAdapterOptions, type IDatabaseAdapter, type IVaultAdapter, type PersonalWorkspaceRuntime, type SyncQueue, type VaultChainKind, type VaultChainPorts, type WorkspaceStateStore } from "@plainva/core";
import { logDiagnostic, sayLineEndsConverted, workspaceWriteAuthorizer, type WorkspaceMoveQuestion } from "@plainva/ui";

/**
 * What the phone hands `buildVaultChain` when a vault boots (stability plan
 * R2): its storage, its versions settings, its index — or none, when the
 * database did not open —, and for an encrypted workspace the permission
 * check, with the phone's own dialog for a move that takes access away. Kept
 * out of `boot` so that a test builds the chain from exactly these ports and
 * sees what it refuses (review of 2026-11-12).
 */
export interface MobileChainInput {
  storage: IVaultAdapter;
  versions: BackupVaultAdapterOptions;
  deviceId: string;
  index: { db: IDatabaseAdapter; queue: SyncQueue } | null;
  /** The workspace's state and, when it is unlocked, its runtime; null for a plain vault. */
  workspace: { state: WorkspaceStateStore; runtime: PersonalWorkspaceRuntime | null } | null;
  kind: VaultChainKind;
  /**
   * The vault syncs with a provider. Without its index a deletion, a rename or
   * a move would not reach the remote, so the chain refuses them (R5); a local
   * vault — and the web shell, which never has a database — refuses nothing.
   */
  remote?: boolean;
  /** The question before a move that takes access away; the system dialog by default. */
  confirm?: (question: WorkspaceMoveQuestion) => Promise<boolean>;
}

/** The question the workspace's permission check puts before a move, in the phone's own dialog. */
export async function confirmWorkspaceMove(question: WorkspaceMoveQuestion): Promise<boolean> {
  const { Dialog } = await import("@capacitor/dialog");
  const answer = await Dialog.confirm({
    title: question.title,
    message: question.message,
    okButtonTitle: question.confirmLabel,
    cancelButtonTitle: question.cancelLabel,
  });
  return answer.value;
}

export function mobileChainPorts(input: MobileChainInput): VaultChainPorts {
  return {
    storage: input.storage,
    versions: input.versions,
    deviceId: input.deviceId,
    index: input.index,
    // A locked workspace (no runtime) allows nothing (`workspaceWriteAuthorizer`).
    workspace: input.workspace
      ? { state: input.workspace.state, authorize: workspaceWriteAuthorizer(input.workspace.runtime, input.workspace.state, input.confirm ?? confirmWorkspaceMove) }
      : null,
    // An entry of a queue made up for or given up is named in the diagnostics, as on the desktop (D2).
    onQueueEntry: (report) => logDiagnostic("sync", formatQueueEntryReport(report)),
    onAutoMerged: (path, mergedText) => {
      window.dispatchEvent(new CustomEvent("m-auto-merged", { detail: { path, mergedText } }));
    },
    // A write turned line ends the file's shape does not keep (a carriage
    // return of its own): said here for every writer of the app at once.
    onLineEndsConverted: (path, lineEnd) => sayLineEndsConverted(path, lineEnd),
    kind: input.kind,
    remote: input.remote,
  };
}
