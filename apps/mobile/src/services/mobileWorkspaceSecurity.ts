import {
  acceptWorkspacePairing,
  approveWorkspacePairing,
  applyWorkspaceGovernanceUpdate,
  assignWorkspaceRole,
  createPersonalWorkspaceBootstrap,
  createWorkspaceGroup,
  createWorkspaceSlice,
  inviteWorkspaceMember,
  createWorkspacePairingRequest,
  createWorkspaceRecoveryPackage,
  deserializePersonalWorkspaceRuntime,
  initializePersonalWorkspaceMigration,
  personalWorkspaceRuntime,
  workspaceDocumentHash,
  loadWorkspacePairingApproval,
  parseWorkspacePairingRequest,
  publishWorkspacePairingRequest,
  publishWorkspacePairingApproval,
  findWorkspacePairingRequest,
  pairingFingerprint,
  publishWorkspaceGovernanceUpdate,
  publishWorkspaceRecoveryRotation,
  restoreWorkspaceFromRecoveryPackage,
  rotateWorkspaceRecoveryPackage,
  serializePersonalWorkspaceRuntime,
  toBase64,
  fromBase64,
  type CreatedWorkspacePairingRequest,
  type IVaultAdapter,
  type PersonalWorkspaceRuntime,
  type WorkspaceGovernanceUpdate,
  type WorkspaceObjectStore,
  type WorkspaceRole,
  type WorkspaceStateStore,
} from "@plainva/core";
import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";
import { secureCredentialStore } from "../platform/secureStore";

export interface MobileWorkspaceStatus {
  version: 1;
  workspaceId: string;
  fingerprint: string;
  deviceName: string;
  phase: "pairing" | "active" | "locked" | "error";
  lastError: string | null;
}

interface StoredPendingPairing {
  token: string;
  shortCode: string;
  fingerprint: string;
  signingPrivateKey: string;
  signingPublicKey: string;
  hpkePrivateKey: string;
  hpkePublicKey: string;
}

/** Written into genesis + policy: the oldest Plainva that may open this
 *  workspace. Kept identical to the desktop wizard so a workspace created on
 *  the phone stays joinable from a desktop of the same generation. */
const MINIMUM_CLIENT_VERSION = "0.4.1";

const runtimeKey = (vaultId: string) => `workspace_runtime_mobile_${vaultId}`;
const pendingKey = (vaultId: string) => `workspace_pairing_mobile_${vaultId}`;
const statusKey = (vaultId: string) => `workspace_status_mobile_${vaultId}`;
const cache = new Map<string, PersonalWorkspaceRuntime>();
const locked = new Set<string>();

export async function getMobileWorkspaceStatus(vaultId: string): Promise<MobileWorkspaceStatus | null> {
  const value = await Preferences.get({ key: statusKey(vaultId) });
  return value.value ? JSON.parse(value.value) as MobileWorkspaceStatus : null;
}

async function saveStatus(vaultId: string, status: MobileWorkspaceStatus): Promise<void> {
  await Preferences.set({ key: statusKey(vaultId), value: JSON.stringify(status) });
  // The screens listen for this; guarded so the service also works where no DOM
  // exists (tests, and any future worker context).
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-workspace-security-changed"));
}

export async function loadMobileWorkspaceRuntime(vaultId: string): Promise<PersonalWorkspaceRuntime | null> {
  if (locked.has(vaultId)) return null;
  const remembered = cache.get(vaultId); if (remembered) return remembered;
  const stored = await secureCredentialStore.readSecret<ReturnType<typeof serializePersonalWorkspaceRuntime>>(runtimeKey(vaultId));
  if (!stored) return null;
  const runtime = deserializePersonalWorkspaceRuntime(stored); cache.set(vaultId, runtime); return runtime;
}

export async function persistMobileWorkspaceRuntime(vaultId: string, runtime: PersonalWorkspaceRuntime): Promise<void> {
  await secureCredentialStore.writeSecret(runtimeKey(vaultId), serializePersonalWorkspaceRuntime(runtime));
  cache.set(vaultId, runtime); locked.delete(vaultId);
  await saveStatus(vaultId, { version: 1, workspaceId: runtime.workspaceId, fingerprint: runtime.genesis ? (await import("@plainva/core")).workspaceDocumentHash(runtime.genesis) : "", deviceName: runtime.device.publicIdentity.displayName, phase: "active", lastError: null });
}

/* ---------------------------------------------------------------------------
 * First setup on the phone (2026-07-25). The desktop twin lives in
 * services/workspaceSecurity/workspaceLifecycle.ts and this mirrors it 1:1 on
 * the same core primitives: prepare (keys + recovery package, kept in memory
 * ONLY), then activate (persist to the keystore, publish, start the resumable
 * encryption sweep). Nothing is written anywhere until the user confirmed the
 * recovery backup, so an abandoned wizard leaves no trace.
 * No fallback-passphrase branch: the Android/iOS keystore is always available
 * (secureCredentialStore), unlike a headless Linux desktop.
 * ------------------------------------------------------------------------- */

interface MobileWorkspaceDraft {
  vaultId: string;
  runtime: PersonalWorkspaceRuntime;
  fingerprint: string;
  recoveryConfirmedAt: string;
  expiresAt: number;
}

export interface PreparedMobileWorkspace {
  draftId: string;
  recoveryPackage: Uint8Array;
  recoveryCode: string;
  fingerprint: string;
}

const drafts = new Map<string, MobileWorkspaceDraft>();
const DRAFT_TTL_MS = 30 * 60 * 1000;

/** Zeroes the private keys of a draft that never became a workspace. */
function destroyDraft(draft: MobileWorkspaceDraft): void {
  draft.runtime.device.secrets.signing.privateKey.fill(0);
  draft.runtime.device.secrets.hpke.privateKey.fill(0);
  draft.runtime.ownerGroup.hpke.privateKey.fill(0);
  draft.runtime.ownerGroup.catalogKey.fill(0);
}

export function discardPreparedMobileWorkspace(draftId: string): void {
  const draft = drafts.get(draftId);
  if (!draft) return;
  drafts.delete(draftId);
  destroyDraft(draft);
}

export async function prepareMobileWorkspace(input: { vaultId: string; ownerDisplayName: string; deviceDisplayName: string }): Promise<PreparedMobileWorkspace> {
  for (const [draftId, draft] of drafts) {
    if (draft.vaultId === input.vaultId || draft.expiresAt <= Date.now()) discardPreparedMobileWorkspace(draftId);
  }
  const bootstrap = await createPersonalWorkspaceBootstrap({
    ownerDisplayName: input.ownerDisplayName.trim(),
    deviceDisplayName: input.deviceDisplayName.trim(),
    platform: Capacitor.getPlatform() === "ios" ? "ios" : "android",
    minimumClientVersion: MINIMUM_CLIENT_VERSION,
  });
  const recoveryConfirmedAt = new Date().toISOString();
  const recovery = createWorkspaceRecoveryPackage(bootstrap, { now: recoveryConfirmedAt });
  const fingerprint = workspaceDocumentHash(bootstrap.genesis);
  const draftId = crypto.randomUUID();
  drafts.set(draftId, { vaultId: input.vaultId, runtime: personalWorkspaceRuntime(bootstrap), fingerprint, recoveryConfirmedAt, expiresAt: Date.now() + DRAFT_TTL_MS });
  return { draftId, recoveryPackage: recovery.bytes, recoveryCode: recovery.recoveryCode, fingerprint };
}

/**
 * Point of no return: persists the device keys, publishes genesis + owner
 * policy and encrypts the local files into `.pvws/`. The sweep is resumable —
 * the sync worker runs the same call at every start, so an interrupted first
 * pass continues instead of restarting.
 */
export async function activatePreparedMobileWorkspace(input: {
  vaultId: string;
  draftId: string;
  store: WorkspaceObjectStore;
  vault: IVaultAdapter;
  state: WorkspaceStateStore;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ runtime: PersonalWorkspaceRuntime; queued: number; total: number }> {
  const draft = drafts.get(input.draftId);
  if (!draft || draft.vaultId !== input.vaultId || draft.expiresAt <= Date.now()) {
    if (draft) discardPreparedMobileWorkspace(input.draftId);
    throw new Error("workspace-draft-expired");
  }
  await persistMobileWorkspaceRuntime(input.vaultId, draft.runtime);
  try {
    const migration = await initializePersonalWorkspaceMigration({
      store: input.store,
      state: input.state,
      vault: input.vault,
      runtime: draft.runtime,
      recoveryConfirmedAt: draft.recoveryConfirmedAt,
      onProgress: input.onProgress,
    });
    drafts.delete(input.draftId);
    return { runtime: draft.runtime, queued: migration.queued, total: migration.total };
  } catch (error) {
    await saveStatus(input.vaultId, {
      version: 1,
      workspaceId: draft.runtime.workspaceId,
      fingerprint: draft.fingerprint,
      deviceName: draft.runtime.device.publicIdentity.displayName,
      phase: "error",
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function beginMobileWorkspacePairing(input: { vaultId: string; store: WorkspaceObjectStore; workspaceId: string; fingerprint: string; memberId: string; deviceName: string }): Promise<{ token: string; shortCode: string; fingerprint: string }> {
  const created = await createWorkspacePairingRequest({ workspaceId: input.workspaceId, workspaceFingerprint: input.fingerprint, memberId: input.memberId, deviceDisplayName: input.deviceName, platform: Capacitor.getPlatform() === "ios" ? "ios" : "android" });
  await publishWorkspacePairingRequest(input.store, created);
  await secureCredentialStore.writeSecret<StoredPendingPairing>(pendingKey(input.vaultId), {
    token: created.token, shortCode: created.shortCode, fingerprint: created.fingerprint,
    signingPrivateKey: toBase64(created.device.secrets.signing.privateKey), signingPublicKey: toBase64(created.device.secrets.signing.publicKey),
    hpkePrivateKey: toBase64(created.device.secrets.hpke.privateKey), hpkePublicKey: toBase64(created.device.secrets.hpke.publicKey),
  });
  await saveStatus(input.vaultId, { version: 1, workspaceId: input.workspaceId, fingerprint: input.fingerprint, deviceName: input.deviceName, phase: "pairing", lastError: null });
  return { token: created.token, shortCode: created.shortCode, fingerprint: created.fingerprint };
}

function restoreCreated(stored: StoredPendingPairing): CreatedWorkspacePairingRequest {
  const request = parseWorkspacePairingRequest(stored.token, { allowExpired: true });
  return { token: stored.token, shortCode: stored.shortCode, fingerprint: stored.fingerprint, request, device: { publicIdentity: request.payload.device, secrets: { signing: { privateKey: fromBase64(stored.signingPrivateKey), publicKey: fromBase64(stored.signingPublicKey) }, hpke: { privateKey: fromBase64(stored.hpkePrivateKey), publicKey: fromBase64(stored.hpkePublicKey) } } } };
}

export async function completeMobileWorkspacePairing(vaultId: string, store: WorkspaceObjectStore): Promise<PersonalWorkspaceRuntime | null> {
  const stored = await secureCredentialStore.readSecret<StoredPendingPairing>(pendingKey(vaultId)); if (!stored) throw new Error("no pending pairing request");
  const created = restoreCreated(stored);
  const bundle = await loadWorkspacePairingApproval(store, created.request.payload.pairingId); if (!bundle) return null;
  const runtime = await acceptWorkspacePairing({ created, genesis: bundle.genesis, previousPolicy: bundle.previousPolicy, approval: bundle.approval });
  await persistMobileWorkspaceRuntime(vaultId, runtime);
  await secureCredentialStore.removeSecret(pendingKey(vaultId));
  return runtime;
}

export async function inspectMobileWorkspacePairing(store: WorkspaceObjectStore, runtime: PersonalWorkspaceRuntime, tokenOrCode: string) {
  const token = tokenOrCode.trim().startsWith("PVPAIR1.") ? tokenOrCode.trim() : await findWorkspacePairingRequest(store, tokenOrCode.trim());
  if (!token) throw new Error("workspace-pairing-request-not-found");
  const request = parseWorkspacePairingRequest(token);
  if (request.payload.workspaceId !== runtime.workspaceId) throw new Error("workspace-pairing-request-mismatch");
  return { token, deviceName: request.payload.device.displayName, platform: request.payload.device.platform, memberId: request.payload.memberId, fingerprint: pairingFingerprint(request), expiresAt: request.payload.expiresAt };
}

export async function approveMobileWorkspacePairing(vaultId: string, store: WorkspaceObjectStore, runtime: PersonalWorkspaceRuntime, token: string): Promise<void> {
  const previousPolicy = runtime.policy;
  const approval = await approveWorkspacePairing({ token, runtime });
  await publishWorkspaceGovernanceUpdate(store, approval);
  applyWorkspaceGovernanceUpdate(runtime, { policy: approval.policy, grants: approval.grants, groupKeys: runtime.groupKeys });
  await publishWorkspacePairingApproval(store, { version: 1, genesis: runtime.genesis, previousPolicy, approval });
  await persistMobileWorkspaceRuntime(vaultId, runtime);
}

/**
 * Managing shares from the phone (S38, decision E8).
 *
 * Every call below already existed in the shared core; the security area could
 * list members, groups, slices and publications and then said "manage on the
 * desktop app". These four wrappers are the missing sentence, not new policy
 * logic — the phone is a full device or it is a viewer, and E8 chose the first.
 *
 * All four follow the sequence `approveMobileWorkspacePairing` established, in
 * this order and for a reason: PUBLISH the successor policy, then APPLY it to
 * the in-memory runtime, then PERSIST that runtime. Applied but not published
 * leaves this device believing something the workspace does not know; published
 * but not persisted loses the change on the next start.
 *
 * Rekey, ownership transfer and decommission stay off the phone on purpose
 * (E8 / C14) and a ratchet keeps them off — a boundary that erodes quietly is
 * not a boundary.
 */
type MobileGovernanceUpdate = Pick<WorkspaceGovernanceUpdate, "policy" | "grants"> & {
  groupKeys?: PersonalWorkspaceRuntime["groupKeys"];
};

async function commitGovernance(
  vaultId: string,
  store: WorkspaceObjectStore,
  runtime: PersonalWorkspaceRuntime,
  update: MobileGovernanceUpdate,
): Promise<void> {
  await publishWorkspaceGovernanceUpdate(store, { policy: update.policy, grants: update.grants });
  applyWorkspaceGovernanceUpdate(runtime, {
    policy: update.policy,
    grants: update.grants,
    groupKeys: update.groupKeys ?? runtime.groupKeys,
  });
  await persistMobileWorkspaceRuntime(vaultId, runtime);
}

export async function inviteMobileWorkspaceMember(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  displayName: string;
  role: WorkspaceRole;
}): Promise<string> {
  const update = await inviteWorkspaceMember({ runtime: input.runtime, displayName: input.displayName, role: input.role });
  await commitGovernance(input.vaultId, input.store, input.runtime, update);
  return update.memberId;
}

export async function createMobileWorkspaceGroup(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  name: string;
  memberIds: string[];
  role: WorkspaceRole;
}): Promise<string> {
  const update = await createWorkspaceGroup({ runtime: input.runtime, name: input.name, memberIds: input.memberIds, role: input.role });
  await commitGovernance(input.vaultId, input.store, input.runtime, update);
  return update.groupId;
}

export async function createMobileWorkspaceSlice(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  name: string;
  folder: string;
  publication?: { mode: "exact" | "sanitized"; access: "read" | "comment" | "suggest"; provider: "google-drive" | "onedrive" | "nextcloud" | "dropbox" | "webdav" | "s3" };
}): Promise<string> {
  // Folder slices only on the phone: a selection slice needs a multi-select
  // over objects, and a dynamic one needs the query builder — both belong to a
  // surface that does not exist here. A folder is the share people actually ask
  // for, and it is expressible in one field.
  const { sliceId, policy } = createWorkspaceSlice({
    runtime: input.runtime,
    name: input.name,
    definition: { kind: "folder", folder: input.folder },
    materializedObjectIds: [],
    ...(input.publication
      ? { publication: { ...input.publication, propertyAllowlist: null, privateProperties: ["apiKey", "password", "private", "secret", "token"] } }
      : {}),
  });
  await commitGovernance(input.vaultId, input.store, input.runtime, { policy, grants: [] });
  return sliceId;
}

export async function assignMobileWorkspaceRole(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  subjectKind: "member" | "group";
  subjectId: string;
  role: WorkspaceRole;
}): Promise<void> {
  const policy = assignWorkspaceRole({
    runtime: input.runtime,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    role: input.role,
    scopeKind: "workspace",
  });
  await commitGovernance(input.vaultId, input.store, input.runtime, { policy, grants: [] });
}

export async function recoverMobileWorkspace(input: { vaultId: string; store: WorkspaceObjectStore; bytes: Uint8Array; code: string; deviceName: string }): Promise<PersonalWorkspaceRuntime> {
  const restored = await restoreWorkspaceFromRecoveryPackage({ bytes: input.bytes, recoveryCode: input.code, deviceDisplayName: input.deviceName, platform: Capacitor.getPlatform() === "ios" ? "ios" : "android", revokeOtherDevices: true, store: input.store });
  await publishWorkspaceGovernanceUpdate(input.store, restored);
  await persistMobileWorkspaceRuntime(input.vaultId, restored.runtime);
  return restored.runtime;
}

export async function rotateMobileWorkspaceRecovery(input: { store: WorkspaceObjectStore; runtime: PersonalWorkspaceRuntime; bytes: Uint8Array; code: string }) {
  const rotated = await rotateWorkspaceRecoveryPackage({ store: input.store, runtime: input.runtime, bytes: input.bytes, recoveryCode: input.code });
  return { bytes: rotated.bytes, recoveryCode: rotated.recoveryCode, activation: rotated.anchor };
}

export async function activateMobileWorkspaceRecovery(input: { store: WorkspaceObjectStore; runtime: PersonalWorkspaceRuntime; activation: Awaited<ReturnType<typeof rotateMobileWorkspaceRecovery>>["activation"] }): Promise<void> {
  await publishWorkspaceRecoveryRotation({ store: input.store, runtime: input.runtime, anchor: input.activation });
}

export async function lockMobileWorkspace(vaultId: string): Promise<void> {
  cache.delete(vaultId); locked.add(vaultId);
  const status = await getMobileWorkspaceStatus(vaultId); if (status) await saveStatus(vaultId, { ...status, phase: "locked" });
}

export async function unlockMobileWorkspace(vaultId: string): Promise<PersonalWorkspaceRuntime | null> {
  locked.delete(vaultId); const runtime = await loadMobileWorkspaceRuntime(vaultId);
  if (runtime) await saveStatus(vaultId, { version: 1, workspaceId: runtime.workspaceId, fingerprint: (await import("@plainva/core")).workspaceDocumentHash(runtime.genesis), deviceName: runtime.device.publicIdentity.displayName, phase: "active", lastError: null });
  return runtime;
}

/**
 * Decommission on the phone (S9, C14). The desktop twin is
 * `VaultContext.decommissionWorkspace`; this removes the SAME three things —
 * the workspace state rows, the device runtime and the status flag — and the
 * caller reopens the vault as a plain one afterwards.
 *
 * Nothing here reaches the network, and that is the point rather than an
 * accident: the encrypted objects in the cloud are deliberately left alone
 * (the dialog says so), so a phone with no signal can still stop being a
 * workspace. A remote call added here later would take that away silently,
 * which is why a test pins it.
 *
 * Two orderings carry the whole safety of this function:
 *
 * 1. **The keystore is proven BEFORE anything is cleared.** The device key is
 *    the one thing here that cannot be re-derived, so if the keystore refuses
 *    we refuse too — with everything still in place — instead of tearing down
 *    the state around a key we cannot remove.
 * 2. **The status flag goes first.** On the phone it is what decides at boot
 *    whether a vault comes up as a workspace at all (`vaultService`:
 *    `workspaceState = workspaceStatus ? … : null`). Clearing it first means a
 *    run interrupted midway leaves a WORKING plain vault with inert leftovers,
 *    not a vault that still claims to be a workspace and has no state. The
 *    desktop clears in the other order because its gate is the keychain entry
 *    it clears last — same principle, different gate.
 */
export async function decommissionMobileWorkspace(input: {
  vaultId: string;
  state: WorkspaceStateStore | null;
  /** Stops and drains the sync worker. Injected so this module stays free of
   *  the vault/sync services (they import this one), and so the test can prove
   *  no cycle is still running when the state goes. */
  stopSync: () => Promise<void>;
}): Promise<void> {
  const { vaultId, state, stopSync } = input;
  // (1) Refusal path: a locked keystore throws here, before any change.
  const runtime = await secureCredentialStore.readSecret<ReturnType<typeof serializePersonalWorkspaceRuntime>>(runtimeKey(vaultId));
  if (!runtime && !(await getMobileWorkspaceStatus(vaultId))) throw new Error("this vault is not an encrypted workspace on this device");
  // A cycle mid-flight would write workspace objects into a state we are about
  // to clear.
  await stopSync();
  // (2) The gate.
  await Preferences.remove({ key: statusKey(vaultId) });
  cache.delete(vaultId); locked.delete(vaultId);
  await secureCredentialStore.removeSecret(runtimeKey(vaultId));
  await secureCredentialStore.removeSecret(pendingKey(vaultId));
  await state?.clearWorkspaceState();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-workspace-security-changed"));
}
