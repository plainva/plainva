/**
 * Comments and suggestions on the phone (Stufe D, D5).
 *
 * The desktop counterpart is `apps/desktop/src/services/localComments.ts`; both
 * are thin shells over the same core. Everything that decides correctness — the
 * bundle format, the union merge, the anchor and its resolution, the mapping
 * into the record the surface renders — lives in `@plainva/core`, so a comment
 * anchored on the desktop keeps resolving here and is never silently dropped.
 *
 * What differs is only what must differ: where the master key is cached, and
 * which adapter writes the file.
 */
import {
  appendLocalComment,
  createWorkspaceObjectId,
  localCommentAuthorNames,
  localCommentsByPath,
  localCommentsForPath,
  readLocalComments,
  type CommentsCrypto,
  type LocalCommentRecord,
  type WorkspaceCapability,
  type WorkspaceCommentAnchor,
  type WorkspaceCommentRecord,
} from "@plainva/core";
import { getPlatformServices } from "@plainva/ui";
import { mobileCommentsMode, type MobileCommentsMode } from "./mobileSettingsSync";
import type { MobileVault } from "./vaultService";

/**
 * What this device may do with comments in a vault without a workspace.
 *
 * Deliberately not the owner's set: a plain vault has no policy, so there is
 * nobody to grant `content.publish` or `member.manage` to. These four are
 * exactly what the comment surface asks for — read the note, write it (for
 * accepting a suggestion), and read and write comments.
 */
export const MOBILE_COMMENT_CAPABILITIES: readonly WorkspaceCapability[] = [
  "content.read",
  "content.write",
  "comment.read",
  "comment.create",
];

function cryptoOf(mode: MobileCommentsMode): CommentsCrypto | undefined {
  return mode.kind === "sealed" ? mode.crypto : undefined;
}

/**
 * Reads through the RAW sandbox adapter, like the sideband step does.
 *
 * The app-facing chain would mint sync_state rows and `.CONFLICT` copies of the
 * comment file — a reply must never become a write to the note.
 */
export async function listMobileComments(vault: MobileVault, path: string): Promise<WorkspaceCommentRecord[]> {
  const mode = await mobileCommentsMode(vault);
  if (mode.kind === "locked") return [];
  return localCommentsForPath(await readLocalComments(vault.adapter, cryptoOf(mode)), path);
}

/**
 * Every note that carries comments, for the vault-wide overview (D9).
 *
 * One read of the bundle answers the whole question - the file holds all of
 * them anyway. The per-note list above is the same read narrowed to one path.
 */
export async function listAllMobileComments(vault: MobileVault): Promise<Map<string, WorkspaceCommentRecord[]>> {
  const mode = await mobileCommentsMode(vault);
  if (mode.kind === "locked") return new Map();
  return localCommentsByPath(await readLocalComments(vault.adapter, cryptoOf(mode)));
}

/** deviceId -> what that device calls itself. Never a claim about anyone else. */
export async function listMobileCommentAuthors(vault: MobileVault): Promise<Map<string, string>> {
  const mode = await mobileCommentsMode(vault);
  if (mode.kind === "locked") return new Map();
  return localCommentAuthorNames(await readLocalComments(vault.adapter, cryptoOf(mode)));
}

/**
 * Who this device is, as a comment author.
 *
 * The SAME id `postMobileComment` writes into `authorDeviceId` below - which is
 * what the surface maps into `authorMemberId`. There is deliberately no
 * workspace branch here as there is on the desktop: the phone writes comments
 * through the local path in every vault, so a member id would be an id nobody
 * ever signs with, and "is this comment mine?" would disagree with the byline
 * right above it.
 */
export async function mobileCommentSelfId(): Promise<string> {
  return deviceId();
}

export interface PostMobileCommentInput {
  path: string;
  body: string;
  parentCommentId?: string | null;
  resolvedCommentId?: string | null;
  anchor?: WorkspaceCommentAnchor | null;
  suggestion?: { replacement: string } | null;
  suggestionOutcome?: "applied" | "declined" | null;
  /** How this device signs the record — the reviewer name this vault already has. */
  authorName?: string | null;
}

const DEVICE_KEY = "settingsSyncDeviceIdMobile";

/** The same device id the settings sideband stamps, so one device stays one author. */
async function deviceId(): Promise<string> {
  const store = await getPlatformServices().loadSettings();
  let value = await store.get<string>(DEVICE_KEY);
  if (!value) {
    value = crypto.randomUUID();
    await store.set(DEVICE_KEY, value);
    await store.save();
  }
  return value;
}

/**
 * Appends one immutable record the moment somebody presses send.
 *
 * Written before the next cycle rather than after the network answers: a reply
 * must appear now, and the union merge makes an early local write safe.
 */
export async function postMobileComment(vault: MobileVault, input: PostMobileCommentInput): Promise<void> {
  const mode = await mobileCommentsMode(vault);
  if (mode.kind === "locked") throw new Error("mobile-comments-locked");
  const record: LocalCommentRecord = {
    commentId: createWorkspaceObjectId(),
    path: input.path,
    parentCommentId: input.parentCommentId ?? null,
    resolvedCommentId: input.resolvedCommentId ?? null,
    suggestionOutcome: input.suggestionOutcome ?? null,
    authorDeviceId: await deviceId(),
    body: input.body,
    anchor: input.anchor ?? null,
    suggestion: input.suggestion ?? null,
    createdAt: new Date().toISOString(),
  };
  await appendLocalComment(vault.adapter, record, {
    crypto: cryptoOf(mode),
    authorName: input.authorName?.trim() || undefined,
  });
}
