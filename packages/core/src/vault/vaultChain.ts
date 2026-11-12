import { BackupVaultAdapter, type BackupVaultAdapterOptions } from "./BackupVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "./ConflictAwareVaultAdapter.js";
import { ConflictFileStore } from "./ConflictFileStore.js";
import type { IVaultAdapter, VaultStorageReader } from "./IVaultAdapter.js";
import { QueueingVaultAdapter } from "./QueueingVaultAdapter.js";
import { SyncStateRepository } from "./SyncStateRepository.js";
import { StructureRefusingVaultAdapter } from "./StructureRefusingVaultAdapter.js";
import { WORKSPACE_FORKS_FOLDER } from "./backupNaming.js";
import type { QueueEntryReport } from "./owedQueueEntries.js";
import type { TextFileShape } from "../textFileShape.js";
import type { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import type { SyncQueue } from "../sync/SyncQueue.js";
import { PermissionedVaultAdapter, type WorkspaceMutationAuthorizationRequest, type WorkspaceMutationAuthorizer } from "../workspace/authorization.js";
import { createWorkspaceObjectId } from "../workspace/identity.js";
import { WorkspaceQueueingVaultAdapter } from "../workspace/queueingVaultAdapter.js";
import type { WorkspaceStateStore } from "../workspace/state.js";

/**
 * The one way a vault's write chain is put together (stability plan R2,
 * finding S2). Until 2026-11-11 the desktop's vault context, the phone's vault
 * service and the assistant's test bench each built it by hand, link by link,
 * and its rules were held by guards that read source text. The order of the
 * links is behaviour, so it is written down once, here:
 *
 *   storage          the files themselves (Tauri, Capacitor, a picked folder, Node)
 *   versions         a snapshot of the file as it was, before every write and
 *                    every deletion (`BackupVaultAdapter`, the net rule D1)
 *   permissions      encrypted workspace only: may this member make this change?
 *                    Checked ABOVE the versions and BELOW the queue — a refused
 *                    change takes no version and is never queued
 *   sync-queue       the change goes into the sync's queue once it is on disk
 *   workspace-queue  … or into the encrypted workspace's own queue instead
 *   conflict-guard   on top: is the file on disk still the one the app knows,
 *                    three-way merge, conflict copies, the text's shape (line
 *                    ends), the merge base kept by the sync state
 *
 * A vault without its index database (the phone, when SQLite does not open)
 * has no queue: `storage → versions → structure-refusal → conflict-guard`,
 * its conflict state kept in files under `.plainva/conflicts`. What only the
 * queue can carry to the other devices — a deletion, a rename, a move — is
 * refused there before it touches the disk (`StructureRefusingVaultAdapter`,
 * stability plan R5); writing and creating go through and reach the sync at
 * the next start with the database. A vault that syncs with no remote (a
 * local vault, a picked folder) has nobody to tell: `storage → versions →
 * conflict-guard`, everything allowed. An encrypted workspace's vault gets the
 * same chain in that state: its permission state lives in the same database,
 * so no link could check a change; a write made meanwhile is judged at the
 * next start as a change from outside (`authorizeExternalChange`: queued if
 * allowed, kept as a local fork if not), and a deletion or a rename cannot
 * happen at all.
 *
 * What the app writes goes through `files`, the top. What lies below it is
 * handed out by type: `reader` can only read, `versions` can only take and
 * keep versions, and the writable lowest link is `belowChain` — for the sync,
 * the workspace and the app's own sideband files, each place listed with its
 * reason by the shells' guards (`rawVaultAdapter.test.ts`).
 */

/** The links of a chain, bottom first. */
export type VaultChainLink = "storage" | "versions" | "permissions" | "sync-queue" | "workspace-queue" | "structure-refusal" | "conflict-guard";

/** The order every vault with an index database gets, bottom first. */
export const PLAIN_VAULT_CHAIN: readonly VaultChainLink[] = ["storage", "versions", "sync-queue", "conflict-guard"];
/** The order of an encrypted workspace's vault, bottom first. */
export const WORKSPACE_VAULT_CHAIN: readonly VaultChainLink[] = ["storage", "versions", "permissions", "workspace-queue", "conflict-guard"];
/** The order of a vault whose index database did not open, bottom first. */
export const UNINDEXED_VAULT_CHAIN: readonly VaultChainLink[] = ["storage", "versions", "structure-refusal", "conflict-guard"];
/** The order of a vault without its index database that syncs with no remote, bottom first. */
export const UNINDEXED_LOCAL_VAULT_CHAIN: readonly VaultChainLink[] = ["storage", "versions", "conflict-guard"];

/**
 * The versions layer's own controls, for the app: read a file, take a version
 * of it as it is (before a restore, before the assistant changes a note, before
 * a conflict copy takes the file's place), change how long versions are kept.
 * The write that follows goes through the chain's top.
 */
export type VaultVersionsControl = VaultStorageReader & Pick<BackupVaultAdapter, "forceBackup" | "ensureSnapshot" | "updatePolicy">;

/** Where a vault's conflict copies and diagnostics say they come from. */
export type VaultChainKind = "external-folder" | "container" | "cloud";

export interface VaultChainWorkspace {
  /** The workspace's state: the store its worker records into, whose path lock the worker holds. */
  state: WorkspaceStateStore;
  /** May this member make this change (`workspaceWriteAuthorizer`)? */
  authorize: WorkspaceMutationAuthorizer;
}

export interface VaultChainPorts {
  /** The files themselves. Initialized by the caller. */
  storage: IVaultAdapter;
  /** How the versions layer keeps versions, and whom it tells when one fails. */
  versions?: BackupVaultAdapterOptions;
  /** This device's identity: names its conflict journal, marks what the sync state records. */
  deviceId: string;
  /**
   * The index database and the sync queue on it. `null`: the database did not
   * open — conflict state goes to files, and nothing is queued.
   */
  index: { db: IDatabaseAdapter; queue: SyncQueue } | null;
  /**
   * The vault syncs with a remote. Only asked without an index database: then
   * a deletion, a rename or a move is refused (R5), because the queue that
   * would carry it to the remote is in that database.
   */
  remote?: boolean;
  /** An encrypted workspace: its permission check and its own queue replace the sync queue. */
  workspace?: VaultChainWorkspace | null;
  /** Told about every entry of a queue that had to be made up for or was given up (D2). */
  onQueueEntry?: (report: QueueEntryReport) => void;
  /** The conflict guard merged a change from outside with the app's and wrote the result. */
  onAutoMerged?: (path: string, mergedText: string) => void;
  /** A write turned line ends the file's shape does not keep. */
  onLineEndsConverted?: (path: string, eol: TextFileShape["eol"]) => void;
  kind: VaultChainKind;
}

export interface VaultChain {
  /** The top: every write of the app goes through it. */
  files: ConflictAwareVaultAdapter;
  /** The versions layer — the lowest link, writable: only for the places the shells' guards list. */
  belowChain: BackupVaultAdapter;
  /** The plain vault's queue link, or the workspace's; null without an index database. */
  queueing: QueueingVaultAdapter | WorkspaceQueueingVaultAdapter | null;
  /** The workspace's permission link, or null. */
  permissions: PermissionedVaultAdapter | null;
  /** The sync state on the index database, or null without one. */
  syncRepo: SyncStateRepository | null;
  /** The links this chain is made of, bottom first. */
  links: readonly VaultChainLink[];
}

/**
 * What a change the workspace refuses leaves behind when it came from outside
 * the app (`PermissionedVaultAdapter.authorizeExternalChange`): a copy of the
 * file under `.plainva/workspace/forks`, recorded as the member's local fork.
 * Written below the permission check — the copy is the member's own and goes
 * nowhere.
 */
export function workspaceDeniedFork(versions: IVaultAdapter, state: WorkspaceStateStore) {
  return async (request: WorkspaceMutationAuthorizationRequest): Promise<void> => {
    const forkId = createWorkspaceObjectId();
    const safeName = request.path.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "_") || "external-change";
    const forkPath = `${WORKSPACE_FORKS_FOLDER}/${forkId}-${safeName}`;
    if (await versions.exists(request.path)) {
      await versions.createDir(WORKSPACE_FORKS_FOLDER);
      await versions.writeBinaryFile(forkPath, await versions.readBinaryFile(request.path));
    }
    await state.saveLocalFork({ forkId, originalPath: request.path, forkPath, reason: "permission-denied", createdAt: new Date().toISOString() });
  };
}

/** Builds a vault's write chain in its one order (see the header). */
export function buildVaultChain(ports: VaultChainPorts): VaultChain {
  const versions = new BackupVaultAdapter(ports.storage, ports.versions ?? {});
  const queueOptions = ports.onQueueEntry ? { onEntry: ports.onQueueEntry } : {};

  if (!ports.index) {
    // No database: the conflict guard keeps its sessions in files, below the
    // versions layer's net — which leaves the app's own files alone (`.plainva`).
    const conflictFiles = new ConflictFileStore(versions, ports.deviceId);
    // No queue to carry a deletion, a rename or a move to a remote: refused
    // (R5). A workspace vault in this state gets the same chain (see the header).
    const refusing = ports.remote ? new StructureRefusingVaultAdapter(versions) : null;
    const files = new ConflictAwareVaultAdapter(refusing ?? versions, conflictFiles, ports.onAutoMerged, versions, ports.kind, ports.onLineEndsConverted);
    return { files, belowChain: versions, queueing: null, permissions: null, syncRepo: null, links: refusing ? UNINDEXED_VAULT_CHAIN : UNINDEXED_LOCAL_VAULT_CHAIN };
  }

  const workspace = ports.workspace ?? null;
  const permissions = workspace
    ? new PermissionedVaultAdapter(versions, workspace.state, workspace.authorize, workspaceDeniedFork(versions, workspace.state))
    : null;
  const queueing = workspace
    ? new WorkspaceQueueingVaultAdapter(permissions!, workspace.state, queueOptions)
    : new QueueingVaultAdapter(versions, ports.index.queue, queueOptions);
  const syncRepo = new SyncStateRepository(ports.index.db, versions, ports.deviceId);
  const files = new ConflictAwareVaultAdapter(queueing, syncRepo, ports.onAutoMerged, workspace?.state ?? syncRepo, ports.kind, ports.onLineEndsConverted);
  return { files, belowChain: versions, queueing, permissions, syncRepo, links: workspace ? WORKSPACE_VAULT_CHAIN : PLAIN_VAULT_CHAIN };
}
