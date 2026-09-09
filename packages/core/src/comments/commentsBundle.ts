import { projectCommentRecords } from "./commentProjection.js";
import { isCommentDecisionProof, type CommentDecisionProof } from "./commentDecisions.js";
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
import type { WorkspaceCommentRecord } from "../workspace/state.js";

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
  decisionProof?: CommentDecisionProof | null;
  /**
   * A retraction marker (K7): deletes the record it names, if this device is
   * that record's author - a plain vault has no roles, so nobody else's marker
   * counts. Appended like a resolution, because the merge below is a union.
   */
  retractsCommentId?: string | null;
  /** The round a proposal was sent in (Vorschlagsmodus, V1). */
  suggestionBatchId?: string | null;
  batchIndex?: number | null;
  batchNote?: string | null;
  /** The device that wrote it. In a plain vault a device IS the author. */
  authorDeviceId: string;
  /**
   * A named author acting through that device (N0): the KI harness writes
   * `plainva-ai/<model>` here. Absent, the device is the author. The device
   * stays the WRITER either way - a retraction is judged by the device, so a
   * person can delete what an assistant proposed from their keyboard.
   */
  authorId?: string | null;
  body: string;
  anchor: WorkspaceCommentAnchor | null;
  suggestion: { replacement: string } | null;
  createdAt: string;
}

/**
 * A note moved (Nachschaerfung, N1). The open store addresses a note by PATH -
 * without a workspace there is no object id - so a rename used to orphan every
 * remark on it. Records stay immutable (rewriting `path` would break the union:
 * one id with two paths on two devices), so the move is its own immutable
 * record, and the reader follows the chain `from -> to` when it lists.
 *
 * `folder` marks a folder move: every path under `from` follows by prefix. One
 * marker instead of one per note, and a device that still remarks under the
 * old folder path (it had not seen the move yet) is carried along too.
 */
export interface LocalMoveRecord {
  moveId: string;
  from: string;
  to: string;
  folder: boolean;
  deviceId: string;
  at: string;
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
  /**
   * Keyed by author id - a device id, or the id of a named author (N0). Each
   * device only ever writes the entries it speaks for.
   */
  authors: Record<string, LocalCommentAuthor>;
  /** Keyed by moveId (N1). Optional: a bundle written before N1 has none. */
  moves?: Record<string, LocalMoveRecord>;
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
    authors[deviceId] = mine && theirs ? (mine.updatedAt > theirs.updatedAt || (mine.updatedAt === theirs.updatedAt && mine.name <= theirs.name) ? mine : theirs) : (mine ?? theirs)!;
  }
  // Moves are immutable events like the records: a union, never a choice.
  const moves: Record<string, LocalMoveRecord> = {};
  const moveIds = new Set<string>([...Object.keys(local?.moves ?? {}), ...Object.keys(remote?.moves ?? {})]);
  for (const id of moveIds) {
    const mine = local?.moves?.[id];
    const theirs = remote?.moves?.[id];
    moves[id] = mine && theirs ? (JSON.stringify(mine) <= JSON.stringify(theirs) ? mine : theirs) : (mine ?? theirs)!;
  }
  return { format: "plainva-comments", version: 1, updatedAt: now, comments, authors, ...(moveIds.size > 0 ? { moves } : {}) };
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
    if (raw.authorId !== undefined && raw.authorId !== null && (!isNonEmptyString(raw.authorId) || raw.authorId.length > 128)) throw new CommentBundleError("comment record named author is malformed");
    if (!isNonEmptyString(raw.createdAt)) throw new CommentBundleError("comment record timestamp is missing");
    if (typeof raw.body !== "string") throw new CommentBundleError("comment record body is malformed");
    if (new TextEncoder().encode(raw.body).length > MAX_LOCAL_COMMENT_BODY_BYTES) throw new CommentBundleError("comment record body is too large");
    if (raw.parentCommentId !== null && !isHexId(raw.parentCommentId)) throw new CommentBundleError("comment parent is malformed");
    if (raw.resolvedCommentId !== null && !isHexId(raw.resolvedCommentId)) throw new CommentBundleError("comment resolution target is malformed");
    if (raw.retractsCommentId !== undefined && raw.retractsCommentId !== null && !isHexId(raw.retractsCommentId)) throw new CommentBundleError("comment retraction target is malformed");
    if (raw.suggestionOutcome !== null && raw.suggestionOutcome !== "applied" && raw.suggestionOutcome !== "declined") throw new CommentBundleError("comment suggestion outcome is malformed");
    if (raw.decisionProof != null && (!isCommentDecisionProof(raw.decisionProof) || !raw.resolvedCommentId || !raw.suggestionOutcome)) throw new CommentBundleError("comment decision proof is malformed");
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
      // An insertion point (empty quote) only ever ADDS text (V1).
      if ((raw.anchor as { quote?: unknown }).quote === "" && raw.suggestion.replacement.length === 0) throw new CommentBundleError("comment insertion has no text");
    } else if (raw.anchor !== null && (raw.anchor as { quote?: unknown }).quote === "") {
      throw new CommentBundleError("comment insertion point without a suggestion");
    }
    // The round (V1): id, position and note travel together, on proposals only.
    const batchId = (raw as { suggestionBatchId?: unknown }).suggestionBatchId ?? null;
    const batchIndex = (raw as { batchIndex?: unknown }).batchIndex ?? null;
    const batchNote = (raw as { batchNote?: unknown }).batchNote ?? null;
    if (batchId !== null || batchIndex !== null || batchNote !== null) {
      if (raw.suggestion === null) throw new CommentBundleError("comment round without a suggestion");
      if (!isHexId(batchId)) throw new CommentBundleError("comment round id is malformed");
      if (typeof batchIndex !== "number" || !Number.isSafeInteger(batchIndex) || batchIndex < 0) throw new CommentBundleError("comment round index is malformed");
      if (batchNote !== null && (typeof batchNote !== "string" || new TextEncoder().encode(batchNote).length > 1024)) throw new CommentBundleError("comment round note is malformed");
    }
    // Same rule as the sealed path: a marker carries no text of its own, but
    // anything that is not a marker has to say something.
    if (raw.body.length === 0 && raw.resolvedCommentId === null && raw.suggestion === null && !raw.retractsCommentId) {
      throw new CommentBundleError("comment record has no content");
    }
  }
  for (const [deviceId, raw] of Object.entries(value.authors)) {
    if (!isNonEmptyString(deviceId)) throw new CommentBundleError("comment author device is malformed");
    if (!isRecord(raw) || typeof raw.name !== "string" || !isNonEmptyString(raw.updatedAt)) throw new CommentBundleError("comment author entry is malformed");
  }
  if (value.moves !== undefined) {
    if (!isRecord(value.moves)) throw new CommentBundleError("comment moves are malformed");
    for (const [id, raw] of Object.entries(value.moves)) {
      if (!isHexId(id)) throw new CommentBundleError("comment move id is malformed");
      if (!isRecord(raw) || raw.moveId !== id) throw new CommentBundleError("comment move record is malformed");
      if (!isNonEmptyString(raw.from) || !isNonEmptyString(raw.to) || raw.from === raw.to) throw new CommentBundleError("comment move paths are malformed");
      if (typeof raw.folder !== "boolean") throw new CommentBundleError("comment move kind is malformed");
      if (!isNonEmptyString(raw.deviceId) || !isNonEmptyString(raw.at)) throw new CommentBundleError("comment move origin is malformed");
    }
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
  const moveIds = Object.keys(bundle.moves ?? {}).sort();
  const moves: Record<string, LocalMoveRecord> = {};
  for (const id of moveIds) moves[id] = bundle.moves![id];
  // A bundle without moves serializes exactly as before N1: nothing changes on
  // disk for a vault that never renamed a commented note.
  return JSON.stringify({ format: bundle.format, version: bundle.version, updatedAt: bundle.updatedAt, comments, authors, ...(moveIds.length > 0 ? { moves } : {}) }, null, 2);
}

/** The bundle's moves in the order they happened; ties broken by id so every device walks them alike. */
export function sortedCommentMoves(bundle: CommentsBundle | null): LocalMoveRecord[] {
  return Object.values(bundle?.moves ?? {}).sort((a, b) => (a.at === b.at ? a.moveId.localeCompare(b.moveId) : a.at.localeCompare(b.at)));
}

function moveApplies(move: LocalMoveRecord, path: string): boolean {
  if (move.folder) return path === move.from || path.startsWith(move.from + "/");
  return path === move.from;
}

function applyMove(move: LocalMoveRecord, path: string): string {
  return move.folder && path !== move.from ? move.to + path.slice(move.from.length) : move.to;
}

/**
 * Where a record written against `path` at `createdAt` lives today (N1).
 *
 * The chain is walked in time order from the record's creation: at each step
 * the EARLIEST unused marker at or after the current floor that matches the
 * current path is taken, and the floor moves to that marker. A rename that
 * happened BEFORE the record was written does not apply to it - a new note
 * that reuses a freed name ("Untitled" is renamed, the next note is called
 * "Untitled" again) keeps its own remarks - while a chain A -> B -> C and a
 * rename-and-back A -> B -> A both end where the note is.
 *
 * The one case the data alone cannot tell apart is a record that arrived
 * LATE: written under a path that had already been renamed, by a device that
 * had not seen the rename yet. It looks exactly like the reused name - until
 * the file is checked: the reused name has a file, the late remark's path has
 * none. So the caller may pass the set of resolved paths it found MISSING, and
 * for those the latest earlier marker is taken instead (the most recent
 * whereabouts of that path) and the walk continues from there.
 *
 * Two devices that renamed the same note differently resolve to the earlier of
 * the two markers on every device alike; the other name's remarks are still
 * listed, under a path without a file (SD3).
 */
export function resolveCommentPath(moves: readonly LocalMoveRecord[], path: string, createdAt: string, missing?: ReadonlySet<string>): string {
  let current = path;
  let floor = createdAt;
  const used = new Set<string>();
  for (let step = 0; step <= moves.length; step += 1) {
    let pick: LocalMoveRecord | null = null;
    for (const move of moves) {
      if (used.has(move.moveId) || move.at < floor || !moveApplies(move, current)) continue;
      pick = move; // sorted ascending: the first hit is the earliest
      break;
    }
    if (!pick && missing?.has(current)) {
      for (let i = moves.length - 1; i >= 0; i -= 1) {
        const move = moves[i];
        if (used.has(move.moveId) || move.at >= floor || !moveApplies(move, current)) continue;
        pick = move; // descending: the latest earlier marker
        break;
      }
    }
    if (!pick) break;
    used.add(pick.moveId);
    current = applyMove(pick, current);
    floor = pick.at;
  }
  return current;
}

/**
 * The resolved paths whose fate depends on whether a file is there (see
 * `resolveCommentPath`): a root record that lands on a path some EARLIER
 * marker would move on. The store checks exactly these against the vault and
 * hands the missing ones back in - a handful of stats at most, and none in a
 * vault that never renamed a commented note.
 */
export function commentPathsToCheck(bundle: CommentsBundle | null): Set<string> {
  const out = new Set<string>();
  if (!bundle?.moves) return out;
  const moves = sortedCommentMoves(bundle);
  for (const record of Object.values(bundle.comments)) {
    if (record.parentCommentId) continue;
    const resolved = resolveCommentPath(moves, record.path, record.createdAt);
    if (moves.some((move) => moveApplies(move, resolved))) out.add(resolved);
  }
  return out;
}

/**
 * Maps the stored records of ONE note into the shape the comment surface renders
 * (Stufe D, D5).
 *
 * Lifted out of the desktop shell so both views read the same list: what a
 * comment "is" on screen - who wrote it, which passage it hangs on, whether a
 * proposal was accepted - must not be decided twice, or the phone would show a
 * thread the desktop does not.
 *
 * The verdict on a suggestion is DERIVED here rather than stored on the
 * proposal: a resolution marker carries `suggestionOutcome`, so the proposal
 * never has to be rewritten - which is what keeps every record immutable and the
 * merge a plain union.
 */
/**
 * Every comment of the bundle as workspace records, grouped by note (D9).
 *
 * The plain-vault side is the mirror image of the workspace store: the bundle is
 * one file, so the vault-wide list is already in memory and the per-note view is
 * the FILTER, not the other way round.
 *
 * Resolution markers are dropped here, exactly as `resolved_comment_id IS NULL`
 * drops them in the workspace store. They are bookkeeping, not comments - a
 * marker carries the path of the thread it closes and an empty body, so leaving
 * it in put a phantom card with no text into the plain-vault column (found
 * 2026-08-26 while lifting this query; the workspace path never had it).
 */
export function localCommentsByPath(bundle: CommentsBundle | null, missing?: ReadonlySet<string>): Map<string, WorkspaceCommentRecord[]> {
  const byPath = new Map<string, WorkspaceCommentRecord[]>();
  if (!bundle) return byPath;
  const all = Object.values(bundle.comments);
  const moves = sortedCommentMoves(bundle);
  const byId = new Map(all.map((record) => [record.commentId, record]));
  // Replies and decisions travel with their original thread, even when a
  // rename happened between the original comment and the new marker.
  const placeOf = (record: LocalCommentRecord): string => {
    let root = record;
    const visited = new Set<string>();
    while (!visited.has(root.commentId)) {
      visited.add(root.commentId);
      const parentId = root.parentCommentId ?? root.resolvedCommentId ?? root.retractsCommentId;
      const parent = parentId ? byId.get(parentId) : undefined;
      if (!parent) break;
      root = parent;
    }
    return moves.length === 0 ? root.path : resolveCommentPath(moves, root.path, root.createdAt, missing);
  };
  const records = projectCommentRecords(all.map((record): WorkspaceCommentRecord => ({
    commentId: record.commentId, targetObjectId: placeOf(record), parentCommentId: record.parentCommentId,
    authorMemberId: record.authorId ?? record.authorDeviceId, authorDeviceId: record.authorDeviceId,
    body: record.body, anchor: record.anchor,
    suggestion: record.suggestion ? { replacement: record.suggestion.replacement,
      appliedAt: null, appliedBy: null, declinedAt: null } : null,
    suggestionOutcome: record.suggestionOutcome,
    ...(record.decisionProof ? { decisionProof: record.decisionProof } : {}),
    suggestionBatchId: record.suggestionBatchId ?? null, batchIndex: record.batchIndex ?? null, batchNote: record.batchNote ?? null,
    createdAt: record.createdAt, resolvedCommentId: record.resolvedCommentId, resolvedAt: null,
    retractsCommentId: record.retractsCommentId ?? null,
  })), "device");
  for (const record of records) {
    // targetObjectId IS the path on this side, so the grouping key travels with
    // the mapped record and nothing has to be zipped back together.
    const list = byPath.get(record.targetObjectId);
    if (list) list.push(record);
    else byPath.set(record.targetObjectId, [record]);
  }
  return byPath;
}

export function localCommentsForPath(bundle: CommentsBundle | null, path: string, missing?: ReadonlySet<string>): WorkspaceCommentRecord[] {
  return localCommentsByPath(bundle, missing).get(path) ?? [];
}

/** deviceId -> what that device calls itself. Never a claim about anyone else. */
export function localCommentAuthorNames(bundle: CommentsBundle | null): Map<string, string> {
  const names = new Map<string, string>();
  for (const [deviceId, author] of Object.entries(bundle?.authors ?? {})) {
    if (author.name.trim()) names.set(deviceId, author.name);
  }
  return names;
}
