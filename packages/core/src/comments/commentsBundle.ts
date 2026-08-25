/**
 * The comment bundle for a vault WITHOUT an encrypted workspace (Stufe D, D4).
 *
 * A workspace stores every comment as its own sealed object, signed by the
 * device that wrote it. A plain vault has no policy, no groups and no signing
 * identity, so that machinery has nothing to stand on - but the surface above
 * it (anchors, threads, suggestions, resolve markers) is worth having anyway.
 * This module is the second storage path for exactly those records, carried by
 * the sideband next to `settings.json`/`secrets.enc` and NEVER through the file
 * queue: a typed reply must not turn into a write to the note (plan section 4).
 *
 * Why the merge is trivial here and elaborate for the profile: a comment record
 * is IMMUTABLE. Nothing edits one; a thread grows by appending, and "resolved"
 * is itself a new record pointing back. Two devices that both appended
 * therefore hold two sets whose UNION is the answer - no revision counter, no
 * last-writer rule that could drop somebody's sentence.
 */
import { assertWorkspaceCommentAnchor, type WorkspaceCommentAnchor } from "../workspace/commentAnchor.js";

/** Same ceiling the sealed path asserts, so both storage paths accept the same thing. */
export const MAX_LOCAL_COMMENT_BODY_BYTES = 64 * 1024;

/** A single immutable record. Ids are lowercase hex, as in the workspace path. */
export interface LocalCommentRecord {
  commentId: string;
  /** Vault-relative note path. Without a workspace there is no object id. */
  path: string;
  parentCommentId: string | null;
  resolvedCommentId: string | null;
  suggestionOutcome: "applied" | "declined" | null;
  /** The device that wrote it. In a plain vault a device IS the author. */
  authorDeviceId: string;
  body: string;
  anchor: WorkspaceCommentAnchor | null;
  suggestion: { replacement: string } | null;
  createdAt: string;
}

/** What one device calls itself in this vault. Never a claim about anyone else. */
export interface LocalCommentAuthor {
  name: string;
  updatedAt: string;
}

export interface CommentsBundle {
  format: "plainva-comments";
  version: 1;
  updatedAt: string;
  /** Keyed by commentId. Grow-only: see the module note. */
  comments: Record<string, LocalCommentRecord>;
  /** Keyed by deviceId. Each device only ever writes its own entry. */
  authors: Record<string, LocalCommentAuthor>;
}

export class CommentBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentBundleError";
  }
}

export function emptyCommentsBundle(now: string): CommentsBundle {
  return { format: "plainva-comments", version: 1, updatedAt: now, comments: {}, authors: {} };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isHexId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);

/**
 * Deterministic order for two records that claim the same id.
 *
 * With immutable records this cannot arise from normal use - two devices would
 * have to mint the same 128-bit id. If it ever does, what matters is not which
 * one "wins" but that BOTH devices pick the same one; otherwise the two vaults
 * never converge and every cycle rewrites the file. Comparing the serialized
 * form gives that for free.
 */
function pickStable(a: LocalCommentRecord, b: LocalCommentRecord): LocalCommentRecord {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  if (left === right) return a;
  return left < right ? a : b;
}

/** Union of two bundles. Neither side can remove what the other appended. */
export function mergeCommentsBundles(local: CommentsBundle | null, remote: CommentsBundle | null, now: string): CommentsBundle {
  const comments: Record<string, LocalCommentRecord> = {};
  const ids = new Set<string>([...Object.keys(local?.comments ?? {}), ...Object.keys(remote?.comments ?? {})]);
  for (const id of ids) {
    const mine = local?.comments[id];
    const theirs = remote?.comments[id];
    comments[id] = mine && theirs ? pickStable(mine, theirs) : (mine ?? theirs)!;
  }
  const authors: Record<string, LocalCommentAuthor> = {};
  const deviceIds = new Set<string>([...Object.keys(local?.authors ?? {}), ...Object.keys(remote?.authors ?? {})]);
  for (const deviceId of deviceIds) {
    const mine = local?.authors[deviceId];
    const theirs = remote?.authors[deviceId];
    // A device owns its own name, so the newer statement about it is the true
    // one. Nothing here lets one device rename another.
    authors[deviceId] = mine && theirs ? (mine.updatedAt >= theirs.updatedAt ? mine : theirs) : (mine ?? theirs)!;
  }
  return { format: "plainva-comments", version: 1, updatedAt: now, comments, authors };
}

/**
 * Validates the complete decoded document before a single record reaches the
 * surface. A malformed bundle is rejected whole: half-applying it would leave a
 * thread with a missing middle, which reads as "somebody deleted a reply".
 */
export function assertCommentsBundleStructure(value: unknown): asserts value is CommentsBundle {
  if (!isRecord(value)) throw new CommentBundleError("comments bundle root is malformed");
  if (value.format !== "plainva-comments") throw new CommentBundleError("comments bundle format is unknown");
  if (value.version !== 1) throw new CommentBundleError("comments bundle version is unsupported");
  if (!isNonEmptyString(value.updatedAt)) throw new CommentBundleError("comments bundle timestamp is missing");
  if (!isRecord(value.comments)) throw new CommentBundleError("comments bundle records are malformed");
  if (!isRecord(value.authors)) throw new CommentBundleError("comments bundle authors are malformed");
  for (const [id, raw] of Object.entries(value.comments)) {
    if (!isHexId(id)) throw new CommentBundleError("comment id is malformed");
    if (!isRecord(raw)) throw new CommentBundleError("comment record is malformed");
    if (raw.commentId !== id) throw new CommentBundleError("comment record id does not match its key");
    if (!isNonEmptyString(raw.path)) throw new CommentBundleError("comment record path is missing");
    if (!isNonEmptyString(raw.authorDeviceId)) throw new CommentBundleError("comment record author is missing");
    if (!isNonEmptyString(raw.createdAt)) throw new CommentBundleError("comment record timestamp is missing");
    if (typeof raw.body !== "string") throw new CommentBundleError("comment record body is malformed");
    if (new TextEncoder().encode(raw.body).length > MAX_LOCAL_COMMENT_BODY_BYTES) throw new CommentBundleError("comment record body is too large");
    if (raw.parentCommentId !== null && !isHexId(raw.parentCommentId)) throw new CommentBundleError("comment parent is malformed");
    if (raw.resolvedCommentId !== null && !isHexId(raw.resolvedCommentId)) throw new CommentBundleError("comment resolution target is malformed");
    if (raw.suggestionOutcome !== null && raw.suggestionOutcome !== "applied" && raw.suggestionOutcome !== "declined") throw new CommentBundleError("comment suggestion outcome is malformed");
    if (raw.anchor !== null) {
      // Same bounds the sealed path enforces - an anchor that arrives from
      // another device is never trusted just because it is well-formed JSON.
      if (!isRecord(raw.anchor)) throw new CommentBundleError("comment anchor is malformed");
      try {
        assertWorkspaceCommentAnchor(raw.anchor as unknown as WorkspaceCommentAnchor);
      } catch (error) {
        throw new CommentBundleError(`comment anchor is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (raw.suggestion !== null) {
      if (!isRecord(raw.suggestion) || typeof raw.suggestion.replacement !== "string") throw new CommentBundleError("comment suggestion is malformed");
      // A proposal names the passage it replaces; without an anchor there is no
      // passage, and the reader would have nothing to strike through.
      if (raw.anchor === null) throw new CommentBundleError("comment suggestion has no anchor");
    }
    // Same rule as the sealed path: a marker carries no text of its own, but
    // anything that is not a marker has to say something.
    if (raw.body.length === 0 && raw.resolvedCommentId === null && raw.suggestion === null) {
      throw new CommentBundleError("comment record has no content");
    }
  }
  for (const [deviceId, raw] of Object.entries(value.authors)) {
    if (!isNonEmptyString(deviceId)) throw new CommentBundleError("comment author device is malformed");
    if (!isRecord(raw) || typeof raw.name !== "string" || !isNonEmptyString(raw.updatedAt)) throw new CommentBundleError("comment author entry is malformed");
  }
}

/** Parses and validates. Returns null for an empty document, throws for a broken one. */
export function parseCommentsBundle(json: string): CommentsBundle | null {
  const trimmed = json.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new CommentBundleError("comments bundle is not valid JSON");
  }
  assertCommentsBundleStructure(value);
  return value;
}

/** Stable serialization: key order must not depend on insertion order, or every cycle looks changed. */
export function serializeCommentsBundle(bundle: CommentsBundle): string {
  assertCommentsBundleStructure(bundle);
  const comments: Record<string, LocalCommentRecord> = {};
  for (const id of Object.keys(bundle.comments).sort()) comments[id] = bundle.comments[id];
  const authors: Record<string, LocalCommentAuthor> = {};
  for (const deviceId of Object.keys(bundle.authors).sort()) authors[deviceId] = bundle.authors[deviceId];
  return JSON.stringify({ format: bundle.format, version: bundle.version, updatedAt: bundle.updatedAt, comments, authors }, null, 2);
}
