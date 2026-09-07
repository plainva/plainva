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
 * What differs is only what must differ: where the master key is cached, and
 * which adapter writes the file. The phone has no sealed workspace store (the
 * desktop's `WorkspaceCommentStore`); in an encrypted workspace it keeps
 * writing the sideband bundle - a gap the parity catalogue names.
 */
import {
  BUNDLE_COMMENT_CAPABILITIES,
  BundleCommentStore,
  createWorkspaceObjectId,
  effectiveWorkspaceCapabilities,
  workspaceSliceIdsForObject,
  type CommentAuthor,
  type CommentStore,
  type CommentStoreState,
  type WorkspaceCapability,
  type WorkspaceCommentAnchor,
  type WorkspaceCommentRecord,
} from "@plainva/core";
import { getMobileSettings } from "./mobileSettings";
import { mobileCommentsMode, mobileSyncDeviceId } from "./mobileSettingsSync";
import type { MobileVault } from "./vaultService";

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
  if (!runtime || !vault.workspaceState) return null;
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

const stores = new WeakMap<MobileVault, CommentStore>();

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
  let store = stores.get(vault);
  if (!store) {
    store = new BundleCommentStore({
      vault: vault.adapter,
      deviceId: mobileSyncDeviceId,
      mode: () => mobileCommentsMode(vault),
      // The reviewer name this vault already carries (D1), the person at this
      // phone - rather than a second name field asking the same question.
      authorName: async () => getMobileSettings().verifierName,
      written: (path) => window.dispatchEvent(new CustomEvent("plainva-workspace-comments-changed", { detail: { path } })),
      // A comment file that could not be read (N3): the shell shows it once,
      // with the reason and a way to export the diagnosis.
      faulted: (faults) => window.dispatchEvent(new CustomEvent("plainva-comment-faults", { detail: { vaultId: vault.vaultId, faults } })),
    });
    stores.set(vault, store);
  }
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
export function mobileCommentSelfId(): Promise<string> {
  return mobileSyncDeviceId();
}

export interface PostMobileCommentInput {
  path: string;
  body: string;
  parentCommentId?: string | null;
  resolvedCommentId?: string | null;
  anchor?: WorkspaceCommentAnchor | null;
  suggestion?: { replacement: string } | null;
  suggestionOutcome?: "applied" | "declined" | null;
  /** A retraction marker (K7): deletes the record it names, if this device wrote that record. */
  retractsCommentId?: string | null;
  /** The proposal round (V5), on proposals only. */
  suggestionBatchId?: string | null;
  batchIndex?: number | null;
  batchNote?: string | null;
  /** A named author acting through this device (the KI harness, v4). */
  author?: CommentAuthor | null;
}

/**
 * Appends one immutable record the moment somebody presses send.
 *
 * Written before the next cycle rather than after the network answers: a reply
 * must appear now, and the union merge makes an early local write safe.
 */
export async function postMobileComment(vault: MobileVault, input: PostMobileCommentInput): Promise<void> {
  await mobileCommentStore(vault).post({
    path: input.path,
    body: input.body,
    parentCommentId: input.parentCommentId,
    resolvedCommentId: input.resolvedCommentId,
    anchor: input.anchor,
    suggestion: input.suggestion,
    suggestionOutcome: input.suggestionOutcome,
    retractsCommentId: input.retractsCommentId,
    batch: input.suggestionBatchId ? { batchId: input.suggestionBatchId, index: input.batchIndex ?? 0, note: input.batchNote ?? null } : null,
    author: input.author,
  });
}
