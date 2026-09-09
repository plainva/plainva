/**
 * Comments and suggestions on the phone (Stufe D, D5; Nachschaerfung N0).
 *
 * The desktop counterpart is `apps/desktop/src/services/localComments.ts`;
 * both are thin shells over ONE core store. Everything that decides
 * correctness - the bundle format, the union merge, the anchor and its
 * resolution, the mapping into the record the surface renders, the record a
 * post writes - lives in `@plainva/core` (`BundleCommentStore`), so a comment
 * anchored on the desktop keeps resolving here and is never silently dropped.
 *
 * Both shells use the signed workspace store when a workspace exists. Older
 * sideband history remains visible with its original provenance.
 */
import {
  BUNDLE_COMMENT_CAPABILITIES,
  BundleCommentStore,
  MigratingWorkspaceCommentStore,
  CommentStoreLockedError,
  createWorkspaceObjectId,
  effectiveWorkspaceCapabilities,
  workspaceSliceIdsForObject,
  type CommentPostInput,
  type CommentStore,
  type CommentStoreState,
  type WorkspaceCapability,
  type WorkspaceCommentRecord,
} from "@plainva/core";
import { Capacitor } from "@capacitor/core";
import i18n from "@plainva/ui/i18n";
import { mPrompt } from "./mobileDialogs";
import { getMobileSettings, updateMobileSettings } from "./mobileSettings";
import { mobileCommentsMode, mobileSyncDeviceId } from "./mobileSettingsSync";
import type { MobileVault } from "./vaultService";
import { mobileCommentWorker } from "./commentWorker";

/** The plain-vault set - what the surface falls back to without a workspace policy. */
export const MOBILE_COMMENT_CAPABILITIES: readonly WorkspaceCapability[] = BUNDLE_COMMENT_CAPABILITIES;

/**
 * What this device may do with ONE note, asked once for every screen that
 * needs it (finding 2026-09-04).
 *
 * The note screen worked this out for itself; the database now needs the same
 * answer before it offers to remark on a property, and two copies of a
 * permission computation is exactly the kind of drift that ends in one surface
 * offering what the other refuses. `null` means "no workspace" - the caller
 * falls back to `MOBILE_COMMENT_CAPABILITIES`, the plain-vault set.
 */
export async function noteWorkspaceCapabilities(vault: MobileVault, path: string): Promise<WorkspaceCapability[] | null> {
  const runtime = vault.workspaceRuntime;
  if (!vault.workspaceState) return null;
  if (!runtime) return [];
  const object = await vault.workspaceState.getObjectByPath(path);
  const objectId = object?.objectId ?? createWorkspaceObjectId();
  const sliceIds = workspaceSliceIdsForObject(runtime.policy.payload, { objectId, path, contentKind: object?.contentKind });
  return effectiveWorkspaceCapabilities(runtime.policy.payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, objectId, sliceIds });
}

/** Whether this device may write a comment on `path`, workspace or not. */
export async function canCommentOnNote(vault: MobileVault, path: string): Promise<boolean> {
  const capabilities = (await noteWorkspaceCapabilities(vault, path)) ?? MOBILE_COMMENT_CAPABILITIES;
  return capabilities.includes("comment.create");
}

const stores = new WeakMap<MobileVault, { state: MobileVault["workspaceState"]; store: CommentStore }>();

/**
 * What this phone calls itself when nobody typed a name (finding 2026-09-09):
 * the platform and the first four characters of the device id - "iOS device
 * 4f3a". Honest, because in a plain vault the device IS the author, and the
 * same shape the desktop signs with. Without this a remark from a phone with
 * an empty name field read "Unknown member".
 */
export function commentDeviceFallbackName(deviceId: string): string {
  const raw = Capacitor.getPlatform();
  const platform = raw === "ios" ? "iOS" : raw === "android" ? "Android" : "Web";
  return i18n.t("comments.commentDeviceName", { platform, id: deviceId.slice(0, 4) });
}

const nameAsked = new Set<string>();

/**
 * The name a remark is signed with, asked for ONCE where it is first needed -
 * the same question, the same field and the same rules as the desktop: only
 * for a remark or a proposal, never for a marker; a declined question is not
 * asked again this session, and the phone then signs with its own label.
 * "Mark as reviewed" fills the same field the same way.
 */
export async function ensureMobileCommentAuthorName(vault: MobileVault): Promise<void> {
  if (vault.workspaceState) return;
  if (nameAsked.has(vault.vaultId)) return;
  if (getMobileSettings().verifierName.trim()) return;
  nameAsked.add(vault.vaultId);
  const res = await mPrompt({
    title: i18n.t("comments.authorNamePromptTitle"),
    message: i18n.t("comments.authorNamePromptBody"),
    placeholder: i18n.t("comments.authorNamePlaceholder"),
  });
  if (res.cancelled || !res.value.trim()) return;
  updateMobileSettings({ verifierName: res.value.trim() });
}

/**
 * The one store of a vault, chosen once (N0).
 *
 * Reads and writes through the RAW sandbox adapter, like the sideband step
 * does: the app-facing chain would mint sync_state rows and `.CONFLICT` copies
 * of the comment file - a reply must never become a write to the note. The
 * reviewer name is read at post time, not captured: the settings screen can
 * change it while the vault stays open.
 */
export function mobileCommentStore(vault: MobileVault): CommentStore {
  const existing = stores.get(vault);
  if (existing && existing.state === vault.workspaceState) return existing.store;
  const changed = (path: string) => window.dispatchEvent(new CustomEvent("plainva-workspace-comments-changed", { detail: { path, vaultId: vault.vaultId } }));
  const legacy = new BundleCommentStore({
      vault: vault.adapter,
      vaultKey: vault.vaultId,
      deviceId: mobileSyncDeviceId,
      mode: () => mobileCommentsMode(vault),
      // The reviewer name this vault already carries (D1), the person at this
      // phone - rather than a second name field asking the same question -
      // else the phone's own label, never nothing.
      authorName: async () => getMobileSettings().verifierName.trim() || commentDeviceFallbackName(await mobileSyncDeviceId()),
      written: changed,
      // A comment file that could not be read (N3): the shell shows it once,
      // with the reason and a way to export the diagnosis.
      faulted: (faults) => window.dispatchEvent(new CustomEvent("plainva-comment-faults", { detail: { vaultId: vault.vaultId, faults } })),
  });
  const workspaceState = vault.workspaceState;
  let workspaceId = vault.workspaceRuntime?.workspaceId;
  const store = workspaceState ? new MigratingWorkspaceCommentStore({
    plane: () => {
      const runtime = vault.workspaceRuntime;
      if (!runtime) throw new CommentStoreLockedError();
      workspaceId ??= runtime.workspaceId;
      if (vault.workspaceState !== workspaceState || runtime.workspaceId !== workspaceId) throw new Error("workspace-comment-runtime-changed");
      return { runtime, workspaceState };
    },
    worker: () => mobileCommentWorker(vault),
    changed,
  }, legacy) : legacy;
  stores.set(vault, { state: workspaceState, store });
  return store;
}

export function mobileCommentStoreState(vault: MobileVault): Promise<CommentStoreState> {
  return mobileCommentStore(vault).state();
}

export function listMobileComments(vault: MobileVault, path: string): Promise<WorkspaceCommentRecord[]> {
  return mobileCommentStore(vault).list(path);
}

/** Every note that carries comments, for the vault-wide overview (D9). */
export function listAllMobileComments(vault: MobileVault): Promise<Map<string, WorkspaceCommentRecord[]>> {
  return mobileCommentStore(vault).listAll();
}

/** author id -> what that device calls itself. Never a claim about anyone else. */
export function listMobileCommentAuthors(vault: MobileVault): Promise<Map<string, string>> {
  return mobileCommentStore(vault).authors();
}

/**
 * Who this device is, as a comment author - the SAME id the store writes into
 * `authorDeviceId`, which is what the surface maps into `authorMemberId`.
 */
export function mobileCommentSelfId(vault: MobileVault): Promise<string | null> {
  return mobileCommentStore(vault).selfId();
}

export interface PostMobileCommentInput extends CommentPostInput {
  /** Compatibility fields for existing suggestion-round callers. */
  suggestionBatchId?: string | null;
  batchIndex?: number | null;
  batchNote?: string | null;
}

/**
 * Appends one immutable record the moment somebody presses send.
 *
 * Written before the next cycle rather than after the network answers: a reply
 * must appear now, and the union merge makes an early local write safe.
 */
export async function postMobileComment(vault: MobileVault, input: PostMobileCommentInput): Promise<void> {
  const captured = structuredClone(input);
  const store = mobileCommentStore(vault);
  if (!captured.resolvedCommentId && !captured.retractsCommentId && (captured.body.trim() || captured.suggestion)) await ensureMobileCommentAuthorName(vault);
  await store.post({
    ...captured,
    batch: captured.batch ?? (captured.suggestionBatchId ? { batchId: captured.suggestionBatchId, index: captured.batchIndex ?? 0, note: captured.batchNote ?? null } : null),
  });
}
