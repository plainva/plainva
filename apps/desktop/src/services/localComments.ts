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
  readLocalComments,
  type CommentsBundle,
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

/**
 * Maps the stored records of ONE note into the shape the column renders.
 *
 * The verdict on a suggestion is derived here rather than stored on the
 * proposal: a resolution marker carries `suggestionOutcome`, so the proposal
 * never has to be rewritten - the same reason the workspace path stamps the
 * target row when the marker arrives instead of re-signing the proposal.
 */
export function localCommentsForPath(bundle: CommentsBundle | null, path: string): WorkspaceCommentRecord[] {
  if (!bundle) return [];
  const all = Object.values(bundle.comments);
  const closedBy = new Map<string, { at: string; outcome: "applied" | "declined" | null; by: string }>();
  for (const record of all) {
    if (!record.resolvedCommentId) continue;
    closedBy.set(record.resolvedCommentId, {
      at: record.createdAt,
      outcome: record.suggestionOutcome,
      by: record.authorDeviceId,
    });
  }
  return all
    .filter((record) => record.path === path)
    .sort((a, b) => (a.createdAt === b.createdAt ? a.commentId.localeCompare(b.commentId) : a.createdAt.localeCompare(b.createdAt)))
    .map((record) => {
      const closed = closedBy.get(record.commentId);
      return {
        commentId: record.commentId,
        // No object id without a workspace; the path IS the identity here.
        targetObjectId: record.path,
        targetRevisionId: "",
        parentCommentId: record.parentCommentId,
        // A device is the author in a plain vault: there are no members, and the
        // column keys its name map by exactly this field.
        authorMemberId: record.authorDeviceId,
        authorDeviceId: record.authorDeviceId,
        operationHash: "",
        payloadHash: "",
        body: record.body,
        anchor: record.anchor,
        suggestion: record.suggestion
          ? {
              replacement: record.suggestion.replacement,
              appliedAt: closed?.outcome === "applied" ? closed.at : null,
              appliedBy: closed?.outcome === "applied" ? closed.by : null,
              declinedAt: closed?.outcome === "declined" ? closed.at : null,
            }
          : null,
        suggestionOutcome: record.suggestionOutcome,
        createdAt: record.createdAt,
        resolvedCommentId: record.resolvedCommentId,
        resolvedAt: closed?.at ?? null,
      } satisfies WorkspaceCommentRecord;
    });
}

export async function listLocalComments(vaultPath: string, raw: IVaultAdapter, path: string): Promise<WorkspaceCommentRecord[]> {
  const mode = await localCommentsMode(vaultPath, raw);
  if (mode.kind === "locked") return [];
  return localCommentsForPath(await readLocalComments(raw, cryptoOf(mode)), path);
}

/** deviceId -> what that device calls itself. Never a claim about anyone else. */
export async function listLocalCommentAuthors(vaultPath: string, raw: IVaultAdapter): Promise<Map<string, string>> {
  const mode = await localCommentsMode(vaultPath, raw);
  if (mode.kind === "locked") return new Map();
  const bundle = await readLocalComments(raw, cryptoOf(mode));
  const names = new Map<string, string>();
  for (const [deviceId, author] of Object.entries(bundle?.authors ?? {})) {
    if (author.name.trim()) names.set(deviceId, author.name);
  }
  return names;
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
