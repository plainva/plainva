/**
 * Comments and suggestions for a vault WITHOUT an encrypted workspace (Stufe D,
 * D4).
 *
 * The workspace path signs every comment, seals it for a recipient group and
 * files it as its own object. A plain vault has none of that machinery - but the
 * surface above it (threads, anchors, suggestions, resolve markers) is worth
 * having regardless, so this module is the second storage path for exactly those
 * records. They travel in the sideband bundle beside `settings.json`, never in
 * the note: a typed reply must not become a write to the Markdown, or every
 * answer would land in the note's own version history.
 *
 * Everything here maps INTO `WorkspaceCommentRecord`, so the column, the anchor
 * resolution and the suggestion flow stay one implementation. The fields the
 * workspace fills with protocol facts (object id, revision, operation hashes)
 * carry the honest plain-vault equivalents; the surface reads none of them.
 */
import {
  appendLocalComment,
  createWorkspaceObjectId,
  localCommentAuthorNames,
  localCommentsForPath,
  readLocalComments,
  type CommentsCrypto,
  type IVaultAdapter,
  type LocalCommentRecord,
  type WorkspaceCapability,
  type WorkspaceCommentAnchor,
  type WorkspaceCommentRecord,
} from "@plainva/core";
import { hasLocalKeyfile, loadCachedMasterKey } from "./encryptionSession";
import { commentsCryptoFor, getDeviceId } from "./settingsProfile";
import { getSettingsStore } from "./settingsStore";

/**
 * What this device may do with comments in a plain vault.
 *
 * Deliberately not the workspace owner's set: a plain vault has no policy, so
 * there is nobody to grant `content.publish` or `member.manage` to. These four
 * are exactly what the comment surface asks for - read the note, write it (for
 * accepting a suggestion), and read and write comments.
 */
export const LOCAL_COMMENT_CAPABILITIES: readonly WorkspaceCapability[] = [
  "content.read",
  "content.write",
  "comment.read",
  "comment.create",
];

/**
 * How this device can store comments right now.
 *
 * `locked` is the case the profile sync learned the hard way: with a keyfile in
 * the vault the sideband is sealed, and a device that cannot seal must NOT write
 * the plaintext variant beside it. For the profile that produced two competing
 * files that never converged. Here the merge is a union, so convergence is not
 * the problem - the ping-pong is: an unlocked device folds a plaintext bundle in
 * and deletes it, the locked device writes it again next cycle, forever. On top
 * of that the user asked for a passphrase; publishing comment text in the clear
 * beside the sealed file would quietly undo that.
 */
export type LocalCommentsMode =
  | { kind: "plain" }
  | { kind: "sealed"; crypto: CommentsCrypto }
  | { kind: "locked" };

export async function localCommentsMode(vaultPath: string, raw: IVaultAdapter): Promise<LocalCommentsMode> {
  const mk = await loadCachedMasterKey(vaultPath);
  if (mk) return { kind: "sealed", crypto: commentsCryptoFor(mk) };
  return (await hasLocalKeyfile(raw)) ? { kind: "locked" } : { kind: "plain" };
}

function cryptoOf(mode: LocalCommentsMode): CommentsCrypto | undefined {
  return mode.kind === "sealed" ? mode.crypto : undefined;
}

// Both shells read the same list (D5): the mapping now lives in the core so the
// phone cannot drift from the desktop. Re-exported here because the surface
// imports it by this name.
export { localCommentsForPath };

export async function listLocalComments(vaultPath: string, raw: IVaultAdapter, path: string): Promise<WorkspaceCommentRecord[]> {
  const mode = await localCommentsMode(vaultPath, raw);
  if (mode.kind === "locked") return [];
  return localCommentsForPath(await readLocalComments(raw, cryptoOf(mode)), path);
}

/** deviceId -> what that device calls itself. Never a claim about anyone else. */
export async function listLocalCommentAuthors(vaultPath: string, raw: IVaultAdapter): Promise<Map<string, string>> {
  const mode = await localCommentsMode(vaultPath, raw);
  if (mode.kind === "locked") return new Map();
  return localCommentAuthorNames(await readLocalComments(raw, cryptoOf(mode)));
}

/**
 * Who this device is, as a comment author.
 *
 * The SAME id `postLocalComment` writes into `authorDeviceId` below - which is
 * what the surface maps into `authorMemberId`. Reading it from anywhere else
 * would be a second answer to one question, and "is this comment mine?" would
 * start disagreeing with the byline right above it.
 */
export async function localCommentSelfId(): Promise<string> {
  return getDeviceId(await getSettingsStore());
}

export interface PostLocalCommentInput {
  path: string;
  body: string;
  parentCommentId?: string | null;
  resolvedCommentId?: string | null;
  anchor?: WorkspaceCommentAnchor | null;
  suggestion?: { replacement: string } | null;
  suggestionOutcome?: "applied" | "declined" | null;
  /**
   * How this device signs the record. Passed in rather than read here: the
   * reviewer name belongs to the vault context, and reaching back into it from a
   * service would make the module graph circular for the sake of one string.
   */
  authorName?: string | null;
}

/**
 * Appends one immutable record plus this device's display name.
 *
 * Written the moment somebody presses send, through the same adapter the
 * sideband step uses: a reply must be on disk before the next cycle, not after
 * the network answers. The name the caller hands in is the reviewer field this
 * vault already has - the person at this keyboard, kept on this device only -
 * rather than a second name field asking the same question again.
 */
export async function postLocalComment(vaultPath: string, raw: IVaultAdapter, input: PostLocalCommentInput): Promise<void> {
  const mode = await localCommentsMode(vaultPath, raw);
  if (mode.kind === "locked") throw new Error("local-comments-locked");
  const store = await getSettingsStore();
  const record: LocalCommentRecord = {
    commentId: createWorkspaceObjectId(),
    path: input.path,
    parentCommentId: input.parentCommentId ?? null,
    resolvedCommentId: input.resolvedCommentId ?? null,
    suggestionOutcome: input.suggestionOutcome ?? null,
    authorDeviceId: await getDeviceId(store),
    body: input.body,
    anchor: input.anchor ?? null,
    suggestion: input.suggestion ?? null,
    createdAt: new Date().toISOString(),
  };
  await appendLocalComment(raw, record, {
    crypto: cryptoOf(mode),
    authorName: input.authorName?.trim() || undefined,
  });
}
