import {
  acceptWorkspacePairing,
  approveWorkspacePairing,
  applyWorkspaceGovernanceUpdate,
  assignWorkspaceRole,
  createPersonalWorkspaceBootstrap,
  createPublication,
  createWorkspaceGroup,
  createWorkspaceSlice,
  createWorkspaceSliceDefinition,
  defaultPublishedPropertyPolicy,
  emptyPublicationManifest,
  evaluateWorkspaceAccess,
  previewPublishedProjection,
  previewWorkspaceSlice,
  publishableObjects,
  refreshWorkspaceSliceMaterialization,
  type WorkspaceSliceObject,
  inviteWorkspaceMember,
  createWorkspacePairingRequest,
  createWorkspaceRecoveryPackage,
  deserializePersonalWorkspaceRuntime,
  wipeWorkspaceRuntimeSecrets,
  initializePersonalWorkspaceMigration,
  personalWorkspaceRuntime,
  workspaceDocumentHash,
  loadWorkspacePairingApproval,
  parseWorkspacePairingRequest,
  publishWorkspacePairingRequest,
  publishWorkspacePairingApproval,
  findWorkspacePairingRequest,
  pairingFingerprint,
  pendingPublicationChanges,
  invitePublicationRecipient,
  planPublicationTeardown,
  publicationStoreFor,
  publicationRecipientGroupId,
  publicationRecipients,
  type PublicationRecipient,
  publishWorkspaceGovernanceUpdate,
  publishWorkspaceRecoveryRotation,
  restoreWorkspaceFromRecoveryPackage,
  revokeWorkspaceDeviceAndRotate,
  revokePublicationRecipient,
  revokeWorkspaceMemberAndRotate,
  rotateWorkspaceRecoveryPackage,
  runPublicationRefresh,
  serializePersonalWorkspaceRuntime,
  startWorkspaceRekey,
  transferWorkspaceOwnership,
  toBase64,
  fromBase64,
  type CreatedWorkspacePairingRequest,
  type IVaultAdapter,
  type PersonalWorkspaceRuntime,
  type PublishedProjectionPreview,
  type PublishedSliceMode,
  type PublishedSliceProvider,
  type WorkspaceGovernanceUpdate,
  collectPublicationComments,
  type PublicationComment,
  type WorkspaceObjectStore,
  type WorkspacePublicationRecord,
  type WorkspaceRekeyMode,
  type WorkspaceRole,
  type WorkspaceStateStore,
} from "@plainva/core";
import { createLimiter } from "@plainva/ui";
import { Preferences } from "@capacitor/preferences";
import { WorkspaceQuarantineService, type QuarantineRetryOutcome, type QuarantineSync } from "@plainva/core";
import type { MobileVault } from "./vaultService";
import { Capacitor } from "@capacitor/core";
import { secureCredentialStore } from "../platform/secureStore";

export interface MobileWorkspaceStatus {
  version: 1;
  workspaceId: string;
  fingerprint: string;
  deviceName: string;
  /**
   * `setup-incomplete` is its own answer, not a flavour of `error` (desktop
   * finding 2026-08-25, B7; phone since C32, 2026-09-04): the key bundle is on
   * this device and the conversion can simply be picked up again. `error`
   * stays reserved for a workspace nobody here can open.
   */
  phase: "pairing" | "active" | "locked" | "setup-incomplete" | "error";
  lastError: string | null;
  /** When the recovery code was confirmed at setup - a resume needs it for the migration record. */
  recoveryConfirmedAt?: string;
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
/**
 * One slot per publication (S4b). The name carries BOTH ids because neither
 * keystore can be enumerated afterwards to discover a collision that already
 * happened - the same publication id under two vaults has to miss, not merge.
 */
const publicationKey = (vaultId: string, publicationId: string) => `workspace_pub_mobile_${vaultId}_${publicationId}`;
const publicationCache = new Map<string, PersonalWorkspaceRuntime>();

/**
 * Every credential slot this vault's workspace owns (finding 2026-08-30).
 *
 * Exists so the names are defined ONCE. "Forget this vault" builds its sweep
 * list from here rather than repeating the shapes, because a sweep that spells
 * the name a second time is exactly how a slot gets left behind when a builder
 * changes - and a keystore cannot be enumerated to find it again.
 *
 * The status key is deliberately absent: it ends in `_<vaultId>` and is a
 * preference, so the store-key sweep already covers it.
 */
export function mobileWorkspaceSecretKeys(vaultId: string, publicationIds: string[]): string[] {
  return [
    runtimeKey(vaultId),
    pendingKey(vaultId),
    ...publicationIds.map((id) => publicationKey(vaultId, id)),
  ];
}

function forgetPublications(vaultId: string): void {
  const prefix = `workspace_pub_mobile_${vaultId}_`;
  for (const slot of [...publicationCache.keys()]) if (slot.startsWith(prefix)) publicationCache.delete(slot);
}

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

/**
 * The publisher's runtime for one published slice.
 *
 * It goes into the platform keystore beside the vault's own, never into it: it
 * holds the publication's admin half (invite a recipient, revoke one), so a
 * recipient of one publication must not end up sitting on the bundle of every
 * other. Locking the vault locks its publications with it - truthful rather
 * than merely tidy, because a refresh needs the vault runtime to read the slice
 * in the first place.
 */
export async function persistMobilePublicationRuntime(vaultId: string, publicationId: string, runtime: PersonalWorkspaceRuntime): Promise<void> {
  await secureCredentialStore.writeSecret(publicationKey(vaultId, publicationId), serializePersonalWorkspaceRuntime(runtime));
  publicationCache.set(publicationKey(vaultId, publicationId), runtime);
}

export async function loadMobilePublicationRuntime(vaultId: string, publicationId: string): Promise<PersonalWorkspaceRuntime | null> {
  if (locked.has(vaultId)) return null;
  const slot = publicationKey(vaultId, publicationId);
  const remembered = publicationCache.get(slot); if (remembered) return remembered;
  const stored = await secureCredentialStore.readSecret<ReturnType<typeof serializePersonalWorkspaceRuntime>>(slot);
  if (!stored) return null;
  const runtime = deserializePersonalWorkspaceRuntime(stored); publicationCache.set(slot, runtime); return runtime;
}

/**
 * Ids are handed in rather than discovered: the keystore has no listing, so the
 * caller has to read them from the workspace state BEFORE that state is cleared
 * (the same ordering the vault-forget sweep learned on 2026-08-19).
 */
export async function clearMobilePublicationRuntimes(vaultId: string, publicationIds: string[]): Promise<void> {
  for (const publicationId of publicationIds) {
    const slot = publicationKey(vaultId, publicationId);
    const runtime = publicationCache.get(slot); if (runtime) wipeWorkspaceRuntimeSecrets(runtime);
    publicationCache.delete(slot);
    await secureCredentialStore.removeSecret(slot);
  }
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
    // Resumable, not orphaned (C32): the runtime was persisted above, so the
    // Security area can offer to pick the conversion up. Until 2026-09-04 this
    // wrote `error`, whose only offer is to decommission - the opposite of
    // what a device holding a perfectly good key bundle needs.
    await saveStatus(input.vaultId, {
      version: 1,
      workspaceId: draft.runtime.workspaceId,
      fingerprint: draft.fingerprint,
      deviceName: draft.runtime.device.publicIdentity.displayName,
      phase: "setup-incomplete",
      lastError: error instanceof Error ? error.message : String(error),
      recoveryConfirmedAt: draft.recoveryConfirmedAt,
    });
    throw error;
  }
}

/**
 * Picks a `setup-incomplete` conversion back up with the key bundle already
 * on this device (C32). The sweep skips what it has already encrypted, so
 * resuming is the same call as starting; success returns the status to
 * `active`, a second failure keeps it resumable.
 */
export async function resumeMobileWorkspaceSetup(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  vault: IVaultAdapter;
  state: WorkspaceStateStore;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ queued: number; total: number }> {
  const status = await getMobileWorkspaceStatus(input.vaultId);
  if (!status || status.phase !== "setup-incomplete") throw new Error("workspace-setup-not-resumable");
  const runtime = await loadMobileWorkspaceRuntime(input.vaultId);
  if (!runtime) throw new Error("workspace-key-bundle-missing");
  const recoveryConfirmedAt = status.recoveryConfirmedAt ?? new Date(0).toISOString();
  try {
    const migration = await initializePersonalWorkspaceMigration({
      store: input.store,
      state: input.state,
      vault: input.vault,
      runtime,
      recoveryConfirmedAt,
      onProgress: input.onProgress,
    });
    await saveStatus(input.vaultId, { ...status, phase: "active", lastError: null });
    return { queued: migration.queued, total: migration.total };
  } catch (error) {
    await saveStatus(input.vaultId, { ...status, phase: "setup-incomplete", lastError: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** The expiry travels with the request (P5, finding B10): it is a signed field
 * of the token, and the approving side has always shown it. The requesting side
 * says it too now, so a screen that still says "waiting" can be recognised as
 * one that is waiting for nothing. */
export async function beginMobileWorkspacePairing(input: { vaultId: string; store: WorkspaceObjectStore; workspaceId: string; fingerprint: string; memberId: string; deviceName: string }): Promise<{ token: string; shortCode: string; fingerprint: string; expiresAt: string }> {
  const created = await createWorkspacePairingRequest({ workspaceId: input.workspaceId, workspaceFingerprint: input.fingerprint, memberId: input.memberId, deviceDisplayName: input.deviceName, platform: Capacitor.getPlatform() === "ios" ? "ios" : "android" });
  await publishWorkspacePairingRequest(input.store, created);
  await secureCredentialStore.writeSecret<StoredPendingPairing>(pendingKey(input.vaultId), {
    token: created.token, shortCode: created.shortCode, fingerprint: created.fingerprint,
    signingPrivateKey: toBase64(created.device.secrets.signing.privateKey), signingPublicKey: toBase64(created.device.secrets.signing.publicKey),
    hpkePrivateKey: toBase64(created.device.secrets.hpke.privateKey), hpkePublicKey: toBase64(created.device.secrets.hpke.publicKey),
  });
  await saveStatus(input.vaultId, { version: 1, workspaceId: input.workspaceId, fingerprint: input.fingerprint, deviceName: input.deviceName, phase: "pairing", lastError: null });
  return { token: created.token, shortCode: created.shortCode, fingerprint: created.fingerprint, expiresAt: created.request.payload.expiresAt };
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
 * Rekey, ownership transfer and decommission were held back here at first
 * (E8 / C14) and this comment said a ratchet kept them off the phone. That
 * stopped being true: all three shipped on mobile, and `mobileLint` now guards
 * the OPPOSITE — that decommission sits behind a typed confirmation rather than
 * behind absence. Corrected 2026-08-20, because a comment claiming a boundary
 * that no longer exists is worse than no comment: the next reader trusts it.
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

/**
 * What a folder slice would actually cover, before it is published (P6).
 *
 * The desktop has always been able to answer this; the phone created a share and
 * only then said how many objects it held. The answer comes from the same call
 * that materializes the slice at creation, so the number shown is the number
 * that will be signed — not an estimate of it.
 */
export function previewMobileWorkspaceSlice(input: {
  name: string;
  folder: string;
  objects: readonly WorkspaceSliceObject[];
}): { objectId: string; path: string }[] {
  const matched = new Set(
    previewWorkspaceSlice(
      { sliceId: "preview", name: input.name, kind: "folder", definition: createWorkspaceSliceDefinition({ kind: "folder", folder: input.folder }), materializedObjectIds: [] },
      input.objects
    ).matchedObjectIds
  );
  return input.objects.filter((object) => matched.has(object.objectId)).map((object) => ({ objectId: object.objectId, path: object.path }));
}

export async function createMobileWorkspaceSlice(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  name: string;
  folder: string;
  /** The vault as the rule sees it — see `materializedObjectIds` below. */
  objects: readonly WorkspaceSliceObject[];
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
    // Not `[]` any more (finding 2026-08-25): authorization reads this list, so a slice
    // created here used to be permanently empty — the phone could hand out a share that
    // covered nothing. It is materialized at creation and refreshed by the call below.
    materializedObjectIds: previewWorkspaceSlice(
      { sliceId: "preview", name: input.name, kind: "folder", definition: createWorkspaceSliceDefinition({ kind: "folder", folder: input.folder }), materializedObjectIds: [] },
      input.objects
    ).matchedObjectIds,
    ...(input.publication
      // The policy is shared with the desktop rather than copied (S3b): two copies
      // of a property policy are equal only until somebody edits one of them.
      ? { publication: { ...input.publication, ...defaultPublishedPropertyPolicy() } }
      : {}),
  });
  await commitGovernance(input.vaultId, input.store, input.runtime, { policy, grants: [] });
  return sliceId;
}

/**
 * Keeps the slice object lists in step with the vault. Same reason as on the desktop:
 * `materializeWorkspaceSlices` never had a caller, so a folder slice kept the count it
 * had on the day it was made — and on this shell that count was zero (finding 2026-08-25).
 */
export async function refreshMobileWorkspaceSliceCounts(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  objects: readonly WorkspaceSliceObject[];
}): Promise<boolean> {
  if (input.runtime.policy.payload.slices.length === 0) return false;
  const refreshed = refreshWorkspaceSliceMaterialization({ runtime: input.runtime, objects: input.objects });
  if (!refreshed) return false;
  await commitGovernance(input.vaultId, input.store, input.runtime, { policy: refreshed.policy, grants: [] });
  return true;
}


/**
 * Turns a slice into a publication — the mobile half of the desktop's
 * `addSlicePublication` (M3; schliesst die Paritaets-Luecke
 * `workspace-publication-create`).
 *
 * Creating a slice WITH a `publication` block (above) writes only the policy's
 * **claim**: mode, access and provider, as intent. This is the **realization** —
 * the publication's own workspace, its own keys, its own folder. Both shells
 * split it the same way, and they have to: the claim is governance and travels
 * with the policy, while the keys are per-device material that never may.
 *
 * The id is derived inside `createPublication` and comes back on the handle; it
 * is never passed in, so what gets persisted here is what was actually written.
 */
export async function createMobilePublication(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  /** Handed in, never built here — this service owns no state store. */
  state: WorkspaceStateStore;
  sliceId: string;
  name: string;
  mode: "exact" | "sanitized";
  access: "read" | "comment" | "suggest";
  provider: PublishedSliceProvider;
}): Promise<string> {
  // The same gate as the desktop: handing a slice to somebody outside the vault
  // IS an invitation, so it takes the capability that governs invitations.
  const permitted = evaluateWorkspaceAccess(input.runtime.policy.payload, {
    memberId: input.runtime.memberId,
    deviceId: input.runtime.device.publicIdentity.deviceId,
    capability: "members.invite",
  }).allowed;
  if (!permitted) throw new Error("workspace-publication-not-permitted");

  const deviceDisplayName =
    input.runtime.policy.payload.devices.find(
      (device) => device.deviceId === input.runtime.device.publicIdentity.deviceId,
    )?.displayName ?? input.runtime.device.publicIdentity.displayName;

  const handle = await createPublication({
    runtime: input.runtime,
    store: input.store,
    config: {
      sliceId: input.sliceId,
      name: input.name,
      mode: input.mode,
      access: input.access,
      provider: input.provider,
      // Shared with the desktop rather than copied (S3b): two copies of a
      // property policy are equal only until somebody edits one of them. An
      // exact publication carries no allowlist — that is what "exact" means.
      ...(input.mode === "sanitized"
        ? defaultPublishedPropertyPolicy()
        : { propertyAllowlist: null, privateProperties: [] }),
    },
    deviceDisplayName,
    platform: Capacitor.getPlatform() === "ios" ? "ios" : "android",
    // The service's own floor, kept identical to the desktop wizard's — a
    // publication created on the phone stays joinable from a desktop of the
    // same generation.
    minimumClientVersion: MINIMUM_CLIENT_VERSION,
  });

  // Key material to the keystore, like the vault's own; the record that follows
  // carries config and manifest, and nothing openable.
  await persistMobilePublicationRuntime(input.vaultId, handle.publicationId, handle.runtime);
  await input.state.savePublication({
    publicationId: handle.publicationId,
    sliceId: handle.config.sliceId,
    config: handle.config,
    manifest: emptyPublicationManifest(handle.publicationId),
    lastError: null,
    lastRefreshedAt: null,
    createdAt: handle.config.createdAt,
  });
  return handle.publicationId;
}

/**
 * What this device actually published, read from the state records.
 *
 * Deliberately NOT `policy.slices[].publication`: that block is the claim (see
 * above), and a screen built on it lists a publication the moment somebody
 * ticked the box — including where the realization never ran, or failed. A
 * record exists only where a publication workspace exists.
 */
export async function listMobilePublications(
  state: WorkspaceStateStore,
): Promise<WorkspacePublicationRecord[]> {
  return state.listPublications();
}

/**
 * Every remark the guests of this vault's publications wrote back (Stufe F, F4).
 *
 * The desktop grew this for its column (D7); the phone never had the column and
 * so never collected them. For a notification that difference does not hold up:
 * a guest remark reaches the owner on EVERY level precisely because a share
 * would otherwise be a one-way street - and that argument is about the person,
 * not about which device is at hand.
 *
 * Nothing is rebuilt here. `collectPublicationComments` is the same core helper
 * the desktop calls, on the same records; this walks the publications once,
 * unlocking each at most a single time, and keys the result by the publisher's
 * own note path.
 *
 * A publication whose key is missing on this device is skipped rather than
 * raised. A missing key is a fact the security surface states plainly; a
 * notification cycle is not where somebody should learn it.
 */
export async function listAllMobilePublicationComments(input: {
  state: WorkspaceStateStore;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  vaultId: string;
}): Promise<Map<string, Array<PublicationComment & { publicationName: string }>>> {
  const byPath = new Map<string, Array<PublicationComment & { publicationName: string }>>();
  const known = new Set((await input.state.listObjects()).map((object) => object.objectId));
  for (const record of await input.state.listPublications()) {
    const sourceObjectIds = record.manifest.objects
      .map((entry) => entry.sourceObjectId)
      .filter((objectId) => known.has(objectId));
    if (sourceObjectIds.length === 0) continue;
    try {
      const publicationRuntime = await loadMobilePublicationRuntime(input.vaultId, record.publicationId);
      if (!publicationRuntime) continue;
      const found = await collectPublicationComments({
        publicationId: record.publicationId,
        runtime: publicationRuntime,
        store: publicationStoreFor(input.store, input.runtime.workspaceId, record.config.sliceId),
        manifest: record.manifest,
        mode: record.config.mode,
        sourceObjectIds,
      });
      for (const entry of found) {
        const withName = { ...entry, publicationName: record.config.name };
        const list = byPath.get(entry.path);
        if (list) list.push(withName);
        else byPath.set(entry.path, [withName]);
      }
    } catch {
      continue;
    }
  }
  return byPath;
}

/**
 * What the published copy would actually contain, asked before it exists (M4).
 *
 * Composed from the same three pieces the refresh runs on — `publishableObjects`
 * for the filter, the shared default property policy, `previewPublishedProjection`
 * for the projection — because a preview that computes differently from the run
 * it previews is worse than no preview. Mobile rebuilds none of it.
 *
 * Reads every covered note. That is the price of an answer about content rather
 * than about ids, so it runs once per explicit step, with the reads overlapped
 * and bounded. `mode: "exact"` runs no projection at all and comes back marked
 * unchanged — that IS the honest preview for it.
 */
export async function previewMobilePublication(input: {
  state: WorkspaceStateStore;
  /** App-facing vault adapter — the notes are read as they are stored. */
  vault: IVaultAdapter;
  objectIds: readonly string[];
  mode: PublishedSliceMode;
}): Promise<PublishedProjectionPreview> {
  const records = publishableObjects(input.objectIds, await input.state.listObjects());
  const limiter = createLimiter(8);
  const objects = await Promise.all(
    records.map((record) =>
      limiter.run(async () => ({ path: record.path, markdown: await input.vault.readTextFile(record.path) }))
    )
  );
  return previewPublishedProjection({ mode: input.mode, objects, ...defaultPublishedPropertyPolicy() });
}

/**
 * How much each publication would move on its next refresh (M5).
 *
 * The record already carries WHY the last refresh stopped and WHEN it ran; what
 * it cannot carry is how much has changed since. That number is derived, never
 * stored: it is a statement about the vault as it is right now, and a stored
 * copy would go stale the moment somebody edits a covered note.
 *
 * `listObjects()` rather than the enriched `workspaceSliceObjects()`, exactly as
 * on the desktop: coverage comes from the slice's `materializedObjectIds`, so
 * reading tags and properties here would be work nobody looks at.
 */
export async function mobilePublicationPendingCounts(input: {
  state: WorkspaceStateStore;
  runtime: PersonalWorkspaceRuntime;
}): Promise<Record<string, number>> {
  const records = await input.state.listPublications();
  if (records.length === 0) return {};
  const objects = await input.state.listObjects();
  const slices = new Map(input.runtime.policy.payload.slices.map((slice) => [slice.sliceId, slice]));
  const pending: Record<string, number> = {};
  for (const record of records) {
    pending[record.publicationId] = pendingPublicationChanges({
      slice: slices.get(record.sliceId),
      objects,
      manifest: record.manifest,
    });
  }
  return pending;
}

/**
 * Withdraws a publication — the mobile half of the desktop's `removePublication`
 * (M5), on the same core primitives and in the same order.
 *
 * The ordering IS the design. Tombstones need the publication runtime, so the
 * key is cleared LAST: a device that dropped its key first would leave a folder
 * full of readable content and no way left to retract it. And the record is
 * deleted only after the tombstones landed, so a run that dies half-way leaves a
 * publication the manifest still describes and the next attempt can finish.
 *
 * What stays behind is deliberate and named on the sheet: the publication's own
 * objects (the store is put-only, there is no delete) and the share at the
 * provider, which Plainva does not manage.
 */
export async function withdrawMobilePublication(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  state: WorkspaceStateStore;
  /** The VAULT runtime — its presence is what says this vault is unlocked. */
  runtime: PersonalWorkspaceRuntime;
  publicationId: string;
}): Promise<{ retracted: number; error: string | null }> {
  const record = await input.state.getPublication(input.publicationId);
  if (!record) throw new Error("publication-unknown");
  // A vault runtime was handed in, so the vault is open; a missing publication
  // runtime therefore means exactly one thing here — the key for THIS
  // publication is not on this device. The desktop separates the two cases
  // because it resolves the vault itself.
  const publicationRuntime = await loadMobilePublicationRuntime(input.vaultId, input.publicationId);
  if (!publicationRuntime) throw new Error("publication-key-missing");
  const publicationStore = publicationStoreFor(input.store, input.runtime.workspaceId, record.config.sliceId);

  const plan = planPublicationTeardown(record.manifest);
  let manifest = record.manifest;
  let retracted = 0;
  if (plan.length > 0) {
    const result = await runPublicationRefresh({
      handle: { publicationId: input.publicationId, runtime: publicationRuntime, store: publicationStore },
      manifest,
      plan,
      // A teardown plans only retractions, so a call here would mean the plan
      // and the run disagree about what is happening.
      project: async () => {
        throw new Error("publication-teardown-projection");
      },
      persist: async (next) => {
        await input.state.savePublication({ ...record, manifest: next });
      },
    });
    manifest = result.manifest;
    retracted = result.applied.length;
    if (result.error) {
      await input.state.savePublication({ ...record, manifest, lastError: result.error });
      return { retracted, error: result.error };
    }
  }

  await input.state.deletePublication(input.publicationId);
  await clearMobilePublicationRuntimes(input.vaultId, [input.publicationId]);
  return { retracted, error: null };
}

/**
 * The two things every publication action needs, resolved the one way.
 *
 * A vault runtime is handed in, so the vault is open; a missing publication
 * runtime therefore means exactly one thing — the key for THIS publication is
 * not on this device.
 */
async function openPublication(input: {
  vaultId: string;
  state: WorkspaceStateStore;
  publicationId: string;
}): Promise<{ record: WorkspacePublicationRecord; runtime: PersonalWorkspaceRuntime }> {
  const record = await input.state.getPublication(input.publicationId);
  if (!record) throw new Error("publication-unknown");
  const runtime = await loadMobilePublicationRuntime(input.vaultId, input.publicationId);
  if (!runtime) throw new Error("publication-key-missing");
  return { record, runtime };
}

/**
 * A publication's own governance, committed into the publication's slot.
 *
 * `commitGovernance` above persists into the VAULT runtime slot, which is
 * exactly right for the vault and exactly wrong here: a publication is a
 * workspace of its own, and writing its runtime over the vault's would cost
 * the vault its key. Same reasoning for the store — the policy belongs to the
 * publication's namespace, so it goes through the scoped store the refresh
 * runner already uses.
 */
async function commitPublicationGovernance(input: {
  vaultId: string;
  publicationId: string;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  update: MobileGovernanceUpdate;
}): Promise<void> {
  await publishWorkspaceGovernanceUpdate(input.store, {
    policy: input.update.policy,
    grants: input.update.grants,
  });
  applyWorkspaceGovernanceUpdate(input.runtime, {
    policy: input.update.policy,
    grants: input.update.grants,
    groupKeys: input.update.groupKeys ?? input.runtime.groupKeys,
  });
  await persistMobilePublicationRuntime(input.vaultId, input.publicationId, input.runtime);
}

/**
 * Everything the recipient surface of one publication needs, in one read.
 *
 * Recipients come from the PUBLICATION's policy, never from the vault's
 * members — that separation is the whole promise of Stufe B, and reading the
 * wrong list here would quietly break it.
 */
export async function mobilePublicationRecipients(
  vaultId: string,
  publicationId: string,
): Promise<{ recipients: PublicationRecipient[]; locked: boolean }> {
  const runtime = await loadMobilePublicationRuntime(vaultId, publicationId);
  if (!runtime) return { recipients: [], locked: true };
  const groupId = publicationRecipientGroupId(runtime.policy.payload);
  if (!groupId) return { recipients: [], locked: false };
  return { recipients: publicationRecipients(runtime.policy.payload, groupId), locked: false };
}

/**
 * Invites one recipient and hands back the code — once.
 *
 * The code is not stored, here or on the desktop: it is derived from the
 * member id, the workspace id and the genesis fingerprint, so it can be
 * regenerated for an existing recipient at any time from facts this device
 * already holds. Storing it would create a second way into a publication that
 * membership alone is supposed to open.
 */
export async function invitePublicationRecipientFromMobile(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  state: WorkspaceStateStore;
  /** The VAULT runtime — the publication's store is scoped under its id. */
  runtime: PersonalWorkspaceRuntime;
  publicationId: string;
  displayName: string;
}): Promise<{ memberId: string; invite: string }> {
  const { record, runtime: publication } = await openPublication(input);
  const groupId = publicationRecipientGroupId(publication.policy.payload);
  if (!groupId) throw new Error("publication-recipient-group-missing");

  const update = await invitePublicationRecipient({
    runtime: publication,
    recipientGroupId: groupId,
    displayName: input.displayName,
  });
  await commitPublicationGovernance({
    vaultId: input.vaultId,
    publicationId: input.publicationId,
    store: publicationStoreFor(input.store, input.runtime.workspaceId, record.config.sliceId),
    runtime: publication,
    update,
  });
  return { memberId: update.memberId, invite: update.invite };
}

/**
 * The way back out. S6 built this on the desktop for a reason: a recipient who
 * could be let in and never out is a door without a handle on the inside.
 *
 * What it buys is the future, not the past — the object store is put-only, and
 * the epoch rotation only stops what comes NEXT from being readable. The sheet
 * says so before the tap.
 */
export async function revokePublicationRecipientFromMobile(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  state: WorkspaceStateStore;
  /** The VAULT runtime — the publication's store is scoped under its id. */
  runtime: PersonalWorkspaceRuntime;
  publicationId: string;
  memberId: string;
  reason: string;
}): Promise<void> {
  const { record, runtime: publication } = await openPublication(input);
  const update = await revokePublicationRecipient({
    runtime: publication,
    memberId: input.memberId,
    reason: input.reason,
  });
  await commitPublicationGovernance({
    vaultId: input.vaultId,
    publicationId: input.publicationId,
    store: publicationStoreFor(input.store, input.runtime.workspaceId, record.config.sliceId),
    runtime: publication,
    update,
  });
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

/* ---------------------------------------------------------------------------
 * Taking access away again (S11, C14). The desktop twin is
 * `VaultContext.removeWorkspaceDevice` / `removeWorkspaceMember`.
 *
 * Two things happen, and they are deliberately not one call: the policy that
 * revokes is committed FIRST, so the removed device or member loses new keys
 * immediately even if everything after this fails. The rekey is queued second,
 * because rewriting every encrypted object is long work that the worker picks
 * up and RESUMES (`resumeWorkspaceRekey`, already run by
 * `EncryptedWorkspaceWorker` on this platform too) — an interrupted rekey must
 * never mean the revocation did not happen.
 *
 * `mode: "future"` only rotates onward; `"full"` queues the rewrite. Neither
 * can take back plaintext the other side already downloaded, and the question
 * on screen says so.
 * ------------------------------------------------------------------------- */

async function revokeAndRekey(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  state: WorkspaceStateStore;
  mode: WorkspaceRekeyMode;
  subjectKind: "device" | "member";
  subjectId: string;
  update: WorkspaceGovernanceUpdate;
}): Promise<void> {
  await commitGovernance(input.vaultId, input.store, input.runtime, input.update);
  await startWorkspaceRekey({ state: input.state, mode: input.mode, subjectKind: input.subjectKind, subjectId: input.subjectId });
}

export async function revokeMobileWorkspaceDevice(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  state: WorkspaceStateStore;
  deviceId: string;
  reason: string;
  mode: WorkspaceRekeyMode;
}): Promise<void> {
  // Revoking the device you are holding would lock this phone out of the
  // workspace with no way back except the recovery package.
  if (input.deviceId === input.runtime.device.publicIdentity.deviceId) throw new Error("workspace-cannot-revoke-current-device");
  const update = await revokeWorkspaceDeviceAndRotate({ runtime: input.runtime, deviceId: input.deviceId, reason: input.reason });
  await revokeAndRekey({ ...input, subjectKind: "device", subjectId: input.deviceId, update });
}

export async function revokeMobileWorkspaceMember(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  state: WorkspaceStateStore;
  memberId: string;
  reason: string;
  mode: WorkspaceRekeyMode;
}): Promise<void> {
  if (input.memberId === input.runtime.memberId) throw new Error("workspace-cannot-revoke-current-member");
  const update = await revokeWorkspaceMemberAndRotate({ runtime: input.runtime, memberId: input.memberId, reason: input.reason });
  await revokeAndRekey({ ...input, subjectKind: "member", subjectId: input.memberId, update });
}

/** What the screen shows about a running rewrite. The worker owns the work;
 *  this only reads what it wrote, so the number keeps moving across restarts. */
export async function getMobileWorkspaceRekey(state: WorkspaceStateStore | null): Promise<{ phase: string; completed: number; total: number; lastError: string | null } | null> {
  const job = (await state?.loadMeta())?.rekeyJob;
  if (!job) return null;
  return { phase: job.phase, completed: job.completed, total: job.total, lastError: job.lastError };
}

/* ---------------------------------------------------------------------------
 * Handing the workspace to someone else (S10, C14). The desktop twin is
 * `VaultContext.prepare/activateWorkspaceOwnerTransfer`.
 *
 * Two phases, and the split is the whole point: ownership and the RECOVERY set
 * move together. The new owner has to be holding a working recovery file and
 * code before the old one stops being owner — otherwise a workspace whose only
 * owner has lost their devices can never be recovered by anyone. So prepare
 * produces the replacement package, the caller gets it into the new owner's
 * hands, and only then does activate publish the anchor and the policy.
 * ------------------------------------------------------------------------- */

export interface PreparedMobileOwnerTransfer {
  bytes: Uint8Array;
  recoveryCode: string;
  activation: { anchor: Awaited<ReturnType<typeof rotateWorkspaceRecoveryPackage>>["anchor"]; update: WorkspaceGovernanceUpdate; ownerMemberId: string };
}

/** Builds the successor policy and the replacement recovery package. Publishes
 *  NOTHING — until `activate…` runs, this device is still the owner. */
export async function prepareMobileWorkspaceOwnerTransfer(input: {
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  targetMemberId: string;
  bytes: Uint8Array;
  code: string;
}): Promise<PreparedMobileOwnerTransfer> {
  const transfer = await transferWorkspaceOwnership({ runtime: input.runtime, targetMemberId: input.targetMemberId });
  const rotated = await rotateWorkspaceRecoveryPackage({
    store: input.store, runtime: input.runtime, bytes: input.bytes, recoveryCode: input.code,
    replacement: { ownerMemberId: transfer.ownerMemberId, ownerGroup: transfer.ownerGroup, policy: transfer.policy, grants: [...input.runtime.grants, ...transfer.grants] },
  });
  return { bytes: rotated.bytes, recoveryCode: rotated.recoveryCode, activation: { anchor: rotated.anchor, update: transfer, ownerMemberId: transfer.ownerMemberId } };
}

/** The point of no return: anchor first, then the policy that demotes this
 *  device to Admin. Runtime and keystore follow so a restart agrees. */
export async function activateMobileWorkspaceOwnerTransfer(input: {
  vaultId: string;
  store: WorkspaceObjectStore;
  runtime: PersonalWorkspaceRuntime;
  activation: PreparedMobileOwnerTransfer["activation"];
}): Promise<void> {
  await publishWorkspaceRecoveryRotation({ store: input.store, runtime: input.runtime, anchor: input.activation.anchor });
  await publishWorkspaceGovernanceUpdate(input.store, input.activation.update);
  applyWorkspaceGovernanceUpdate(input.runtime, input.activation.update);
  input.runtime.ownerMemberId = input.activation.ownerMemberId;
  await persistMobileWorkspaceRuntime(input.vaultId, input.runtime);
}

export async function lockMobileWorkspace(vaultId: string): Promise<void> {
  cache.delete(vaultId); forgetPublications(vaultId); locked.add(vaultId);
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
  // Read the publication ids while the table still exists: the keystore cannot
  // be listed, so after `clearWorkspaceState` their slots would be unreachable
  // and their keys would outlive the workspace they belong to.
  const publicationIds = (await state?.listPublications() ?? []).map((record) => record.publicationId);
  await secureCredentialStore.removeSecret(runtimeKey(vaultId));
  await secureCredentialStore.removeSecret(pendingKey(vaultId));
  await clearMobilePublicationRuntimes(vaultId, publicationIds);
  await state?.clearWorkspaceState();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-workspace-security-changed"));
}

/**
 * Lifting the encryption on the phone (catalog gap `lift-encryption` until
 * 2026-09-04). The desktop's twin is `VaultContext.liftWorkspaceEncryption`:
 * decommission, then reopen as a NEW plaintext connection so every local file
 * is queued and uploaded as plain text into the same cloud folder. On the
 * phone the upload is the one thing the shell deliberately meters (consent
 * before mobile data, foreground only, the rest queued), so "lifting" is not
 * one call here but a state: the queue holds every file, the worker drains it
 * across app switches, and this flag lets the Security area say so — with the
 * pending count as the honest progress — until the queue is empty. Nothing is
 * deleted; the `.pvws/` objects stay until the user removes the folder.
 */
const liftKey = (vaultId: string) => `plainva-mobile-lift-${vaultId}`;

export async function markMobileEncryptionLift(vaultId: string): Promise<void> {
  await Preferences.set({ key: liftKey(vaultId), value: new Date().toISOString() });
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-workspace-security-changed"));
}

/** ISO time the lift started, or null when none is under way. */
export async function readMobileEncryptionLift(vaultId: string): Promise<string | null> {
  const value = await Preferences.get({ key: liftKey(vaultId) });
  return value.value || null;
}

export async function clearMobileEncryptionLift(vaultId: string): Promise<void> {
  await Preferences.remove({ key: liftKey(vaultId) });
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-workspace-security-changed"));
}

/** Forgets a local fork once it was compared and resolved (C36). */
export async function discardMobileLocalFork(vault: MobileVault, forkId: string): Promise<void> {
  if (!vault.workspaceState) throw new Error("workspace-unavailable-or-locked");
  await vault.workspaceState.deleteLocalFork(forkId);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-workspace-security-changed"));
}

/**
 * The quarantine's actions on the phone (finding 2026-09-03): the same
 * service the desktop uses, over this vault's state and this shell's sync.
 * A retry answers with what is still open; the diagnosis is a JSON string
 * the screen hands to the clipboard - the phone has no "save as" dialog.
 */
export async function updateMobileQuarantine(vault: MobileVault, sync: QuarantineSync, quarantineIds: readonly string[], action: "retry" | "ignore" | "repaired"): Promise<QuarantineRetryOutcome | null> {
  if (!vault.workspaceState) throw new Error("workspace-unavailable-or-locked");
  const service = new WorkspaceQuarantineService(vault.workspaceState, sync);
  let outcome: QuarantineRetryOutcome | null = null;
  if (action === "retry") outcome = await service.retry(quarantineIds);
  else if (action === "ignore") await service.ignore(quarantineIds);
  else await service.markRepaired(quarantineIds);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-workspace-security-changed"));
  return outcome;
}

export async function exportMobileQuarantineDiagnostics(vault: MobileVault, sync: QuarantineSync, quarantineIds?: readonly string[]): Promise<string> {
  if (!vault.workspaceState) throw new Error("workspace-unavailable-or-locked");
  const service = new WorkspaceQuarantineService(vault.workspaceState, sync);
  return service.exportDiagnostics(quarantineIds, {
    workspaceId: vault.workspaceRuntime?.workspaceId ?? null,
    deviceId: vault.workspaceRuntime?.device.publicIdentity.deviceId ?? null,
  });
}
