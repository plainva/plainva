import { IVaultAdapter } from "../vault/IVaultAdapter.js";
import { workspaceDocumentHash } from "./documents.js";
import { sha256Hex } from "./encoding.js";
import { publishWorkspaceBootstrap } from "./governance.js";
import { WorkspaceObjectStore } from "./objectStore.js";
import { PersonalWorkspaceRuntime } from "./personal.js";
import { isWorkspaceLocalOnlyPath } from "./queueingVaultAdapter.js";
import { protocolAssert } from "./errors.js";
import { WorkspaceLocalProbe, WorkspaceRuntimeMeta, WorkspaceStateStore } from "./state.js";
import { refreshWorkspacePolicy } from "./worker.js";

/**
 * The permission check of the vault's chain for a change made outside the
 * app (`PermissionedVaultAdapter`): its verdict without a side effect, and
 * the local fork that keeps a refused change.
 */
export interface WorkspaceExternalChangeCheck {
  judgeExternalChange(path: string, exists: boolean): Promise<"held" | "allowed" | "denied">;
  keepDeniedExternalChange(path: string, exists: boolean): Promise<void>;
}

export interface PersonalWorkspaceMigrationResult {
  total: number;
  alreadyCompleted: number;
  queued: number;
}

function initialMeta(runtime: PersonalWorkspaceRuntime, recoveryConfirmedAt: string): WorkspaceRuntimeMeta {
  return {
    workspaceId: runtime.workspaceId,
    memberId: runtime.memberId,
    deviceId: runtime.device.publicIdentity.deviceId,
    groupId: runtime.ownerGroup.groupId,
    keyEpoch: runtime.ownerGroup.keyEpoch,
    policyHash: workspaceDocumentHash(runtime.policy),
    phase: "preparing",
    recoveryConfirmedAt,
    sequence: 0,
    previousOperationHash: null,
    catalogVersion: 0,
    previousCatalogHash: null,
    catalogHeads: {},
    checkpointVersion: 0,
    previousCheckpointHash: null,
    remoteHeadEtag: null,
    migrationTotal: 0,
    migrationCompleted: 0,
    migrationInventoryComplete: false,
    lastSyncAt: null,
    lastError: null,
    operationHeads: {},
    needsPublication: true,
    pendingPublication: null,
  };
}

/**
 * Builds `.pvws/` side by side and fills the durable queue. Existing remote
 * plaintext is deliberately untouched; the desktop asks for an explicit,
 * separately confirmed cleanup only after the encrypted checkpoint is active.
 */
export async function initializePersonalWorkspaceMigration(input: {
  store: WorkspaceObjectStore;
  state: WorkspaceStateStore;
  vault: IVaultAdapter;
  runtime: PersonalWorkspaceRuntime;
  recoveryConfirmedAt: string;
  signal?: AbortSignal;
  /** Reports queue-building progress over the vault inventory so the first-run
   * setup UI can show a determinate bar while every file is hashed. */
  onProgress?: (done: number, total: number) => void;
  /**
   * The chain's permission link, asked before each change the reconcile finds
   * goes into the queue (release 0.9.0 A3) — the same question a change from
   * outside the app gets while the app runs. Without it a write the member may
   * not make went into the queue and failed only at its push ("local mutation
   * is not permitted by the active workspace policy"), again at every cycle,
   * instead of staying here as a local fork. Every start of a running vault
   * passes it; the conversion of one's own vault and a recovery, where the
   * device acts as the owner, do without.
   *
   * Every start asks anew: a change refused at an earlier start and allowed
   * since (a right granted meanwhile) goes into the queue; only the same
   * refusal is not recorded a second time.
   */
  permissions?: WorkspaceExternalChangeCheck | null;
}): Promise<PersonalWorkspaceMigrationResult> {
  let meta = await input.state.loadMeta();
  if (!meta) {
    meta = initialMeta(input.runtime, input.recoveryConfirmedAt);
    await input.state.saveMeta(meta);
  }
  protocolAssert(meta.workspaceId === input.runtime.workspaceId, "conflict", "local state belongs to another encrypted workspace");
  await publishWorkspaceBootstrap(input.store, input.runtime, input.signal);
  meta.phase = "migrating";

  // The walk with what it left out (issue #125): a folder it could not read
  // — a link to a drive that is not mounted, a folder without access — is no
  // folder whose objects are gone. The plain listing hands over the files
  // only, and every object under such a folder went out as a deletion.
  const listing = input.vault.listDirReport
    ? await input.vault.listDirReport("", true, { signal: input.signal })
    : { files: await input.vault.listDir("", true, { signal: input.signal }), skipped: [] };
  const unjudged = (path: string) => listing.skipped.some((s) => !s.path || s.path === path || path.startsWith(`${s.path}/`));
  const inventory = listing.files
    .filter((entry) => entry.path && !isWorkspaceLocalOnlyPath(entry.path))
    .sort((left, right) => {
      const leftDepth = left.path.split("/").length;
      const rightDepth = right.path.split("/").length;
      return leftDepth - rightDepth || Number(right.isDirectory) - Number(left.isDirectory) || left.path.localeCompare(right.path);
    });
  let queued = 0;
  let completed = 0;
  let processed = 0;
  const progressStep = Math.max(1, Math.ceil(inventory.length / 100));
  input.onProgress?.(0, inventory.length);
  const localPaths = new Set(inventory.map((entry) => entry.path));
  // Per-RUN lookups instead of per-file round-trips (the indexer's bulk-pass
  // treatment): one object map, one pending-path set, one probe map.
  const objectsByPath = new Map((await input.state.listObjects(true)).map((object) => [object.path, object]));
  const pendingPaths = new Set(await input.state.listQueuedPaths());
  const probesByPath = new Map((await input.state.listLocalProbes()).map((probe) => [probe.path, probe]));
  const probeUpserts: WorkspaceLocalProbe[] = [];
  const permissions = input.permissions ?? null;
  // A change refused once is a local fork already (`workspaceDeniedFork`).
  // The reconcile meets it again at every start — the file still differs
  // from what the workspace holds, the object is still missing here — and a
  // second copy of the same refusal is nothing the person needs.
  const deniedForks = permissions
    ? (await input.state.listLocalForks()).filter((fork) => fork.reason === "permission-denied")
    : [];
  // A file's refusal kept a copy of its bytes; a deletion's, or a folder's,
  // kept none.
  const refusedBefore = async (path: string, sha: string | null): Promise<boolean> => {
    for (const fork of deniedForks) {
      if (fork.originalPath !== path) continue;
      const kept = await input.vault.exists(fork.forkPath);
      if (sha === null ? !kept : kept && sha256Hex(await input.vault.readBinaryFile(fork.forkPath)) === sha) return true;
    }
    return false;
  };
  // The policy is brought up to date before the first change is judged
  // (`refreshWorkspacePolicy`). The device starts with the policy of its key
  // bundle — the one of its pairing or of its own last governance change —
  // and a right withdrawn or granted since is only known once the remote
  // policy chain has been read. Into the runtime, which the app's permission
  // check reads too. Once, and only when something differs.
  let policyFresh = false;
  /** A file that could not be read is left for the next start; the rest of the vault goes on. */
  const readHash = async (path: string): Promise<string | null> => {
    try {
      return sha256Hex(await input.vault.readBinaryFile(path));
    } catch (error) {
      console.warn(`[workspace] ${path} could not be read; it is looked at again at the next start`, error);
      return null;
    }
  };
  /**
   * "queue" when the change goes into the queue; "kept" when it stays here
   * (held already, or refused — then a local fork, recorded once); "later"
   * when it could not be judged now. `sha` is the file's hash where it is
   * known, `kind` what the change is.
   */
  const verdict = async (path: string, kind: "file" | "folder" | "deletion", sha: string | null): Promise<"queue" | "kept" | "later"> => {
    if (!permissions) return "queue";
    if (!policyFresh) {
      await refreshWorkspacePolicy({ store: input.store, state: input.state, vault: input.vault, runtime: input.runtime, signal: input.signal });
      policyFresh = true;
    }
    const exists = kind !== "deletion";
    const judged = await permissions.judgeExternalChange(path, exists);
    if (judged === "allowed") return "queue";
    if (judged === "held") return "kept";
    if (kind === "file" && sha === null) sha = await readHash(path);
    if (kind === "file" && sha === null) return "later";
    if (!(await refusedBefore(path, kind === "file" ? sha : null))) await permissions.keepDeniedExternalChange(path, exists);
    return "kept";
  };
  let deferred = 0;
  for (const entry of inventory) {
    if (input.signal?.aborted) throw new DOMException("Encrypted workspace migration aborted", "AbortError");
    processed += 1;
    if (processed === inventory.length || processed % progressStep === 0) input.onProgress?.(processed, inventory.length);
    const existing = objectsByPath.get(entry.path);
    if (pendingPaths.has(entry.path)) { queued += 1; continue; }
    // The file's hash, where it was taken; what the refusal check compares.
    let sha: string | null = null;
    if (existing && !existing.deleted) {
      let unchanged: boolean;
      if (entry.isDirectory) {
        unchanged = existing.contentKind === "directory";
      } else if (existing.contentKind === "directory") {
        unchanged = false;
      } else {
        // mtime skip: a probe that still matches the stat (mtime AND size, and a
        // real mtime — network mounts may report 0) carries the plaintext hash,
        // so unchanged files cost no read. Anything else falls back to hashing
        // once and refreshes the probe for the next open.
        const probe = probesByPath.get(entry.path);
        if (probe && entry.mtime > 0 && probe.mtime === entry.mtime && probe.size === entry.size) {
          sha = probe.plaintextSha256;
        } else {
          sha = await readHash(entry.path);
          if (sha === null) { deferred += 1; continue; }
          probeUpserts.push({ path: entry.path, mtime: entry.mtime, size: entry.size, plaintextSha256: sha });
        }
        unchanged = existing.plaintextSha256 === sha;
      }
      if (unchanged) { completed += 1; continue; }
    }
    const outcome = await verdict(entry.path, entry.isDirectory ? "folder" : "file", sha);
    if (outcome === "later") { deferred += 1; continue; }
    if (outcome === "kept") { completed += 1; continue; }
    await input.state.enqueue(entry.isDirectory ? "mkdir" : "write", entry.path);
    queued += 1;
  }
  // The watcher cannot observe changes made while Plainva was closed. Reconcile
  // the durable object map against the startup inventory so offline edits and
  // deletions enter the same signed queue before the first pull.
  const missingObjects = [...objectsByPath.values()].filter((object) => !object.deleted && !localPaths.has(object.path) && !unjudged(object.path));
  for (const object of missingObjects) {
    if (input.signal?.aborted) throw new DOMException("Encrypted workspace migration aborted", "AbortError");
    if (pendingPaths.has(object.path)) { queued += 1; continue; }
    if ((await verdict(object.path, "deletion", null)) === "kept") { completed += 1; continue; }
    // Unconfirmed: nobody deleted these in the app. Many of them at once are
    // held by the worker's mass-deletion guard until the person answers (A4).
    await input.state.enqueue("delete", object.path);
    queued += 1;
  }
  const staleProbes = [...probesByPath.keys()].filter((path) => !localPaths.has(path) && !unjudged(path));
  if (probeUpserts.length) await input.state.upsertLocalProbes(probeUpserts);
  if (staleProbes.length) await input.state.deleteLocalProbes(staleProbes);
  meta.migrationTotal = inventory.length + missingObjects.length - deferred;
  meta.migrationCompleted = completed;
  meta.migrationInventoryComplete = true;
  meta.lastError = null;
  await input.state.saveMeta(meta);
  return { total: inventory.length, alreadyCompleted: completed, queued };
}
