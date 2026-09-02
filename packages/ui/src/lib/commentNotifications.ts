/**
 * Which new remarks are worth telling somebody about (Stufe F, F1).
 *
 * Plainva has no server that could push a notification. There are only devices
 * syncing the same files, so a notification can only come into being where a
 * device looks anyway - at the end of a sync cycle. That is not a limitation one
 * could engineer away: a push service would mean a foreign server learns when
 * who commented on which note, which is exactly what the encryption prevents.
 *
 * This module is the ONE place that decides what counts as new and relevant,
 * for the reason the plan gives: if the rule sat in the desktop layer it would
 * be rebuilt on the phone and the two would drift - the failure class the parity
 * rule exists for. It sits beside `commentThreads` rather than in `core`,
 * because that is where the pieces it is made of already live (`mentionsMember`,
 * `isCommentThreadOpen`) and because a thread and a notification are the same
 * kind of statement: a structural fact about the records, not a property of the
 * surface that draws it.
 *
 * The danger it guards against is a second inbox. A tool that pings for every
 * comment is muted within a week, and then it also stops delivering the one
 * thing somebody was waiting for. Four rules keep it small: your own writing
 * never notifies you, one message per cycle rather than per comment, nothing is
 * caught up retroactively, and silence is a state (per note, per vault) rather
 * than a switch you have to hunt for.
 */
import type { WorkspaceCommentRecord } from "@plainva/core";
import { mentionsMember } from "./commentMentions.js";
import { isCommentThreadOpen } from "./commentThreads.js";

/** What the user chose for this vault. `relevant` is the default (FB1). */
export type CommentNotificationLevel = "mentions" | "relevant" | "all";

/** Where a record came from. A guest remark is reported on every level (§4). */
export type CommentNotificationSource = "vault" | "publication";

/** One note's comments, as the caller already holds them. */
export interface CommentNotificationNote {
  path: string;
  comments: readonly WorkspaceCommentRecord[];
  source?: CommentNotificationSource;
  /** Which publication a guest remark came back from, for the message text. */
  publicationName?: string;
}

export interface CommentNotificationInput {
  notes: readonly CommentNotificationNote[];
  /**
   * Comment ids this device has already accounted for.
   *
   * It holds every id ever SEEN, not every id ever reported - a muted note still
   * marks its comments seen, so lifting the mute does not release a backlog
   * (rule 3, "no catching up").
   */
  seen: ReadonlySet<string>;
  /**
   * This device's member id, or null in a vault without a workspace and
   * therefore without members. Mentions cannot resolve without it.
   */
  selfMemberId: string | null;
  /** This device's id. In a plain vault a device IS the author. */
  selfDeviceId: string | null;
  /** Display names by member id, for resolving `@Name` (D8). */
  names: ReadonlyMap<string, string>;
  level: CommentNotificationLevel;
  /** Notes silenced individually, vault-relative paths. */
  mutedPaths?: ReadonlySet<string>;
  /**
   * Notes this user wrote. Feeds the "remarks on my notes" half of level 2. A
   * shell that cannot answer this hands in nothing and loses that half rather
   * than guessing - claiming authorship wrongly would notify somebody about a
   * note that was never theirs.
   */
  ownedPaths?: ReadonlySet<string>;
  /**
   * How many remarks make a return "a backlog" rather than "a few new ones".
   * Only the wording differs; nothing is withheld either way.
   */
  catchUpThreshold?: number;
}

export type CommentNotificationReason =
  | "mention"
  | "reply-to-me"
  | "my-note"
  | "my-suggestion-decided"
  | "suggestion-awaiting-me"
  | "guest"
  | "all";

/** One new remark, already judged relevant. */
export interface NewCommentNotice {
  commentId: string;
  path: string;
  authorMemberId: string;
  authorDeviceId: string;
  body: string;
  createdAt: string;
  source: CommentNotificationSource;
  publicationName?: string;
  /** Why it got through. Drives the wording and makes a test read plainly. */
  reason: CommentNotificationReason;
}

/**
 * What the shell should do with this cycle.
 *
 * `seen` is ALWAYS every id this cycle accounted for, including the ones that
 * were filtered out - see the field note on `CommentNotificationInput.seen`.
 */
export type CommentNotificationPlan =
  | { kind: "none"; seen: string[] }
  | { kind: "single"; notice: NewCommentNotice; seen: string[] }
  | { kind: "bundle"; commentCount: number; noteCount: number; catchUp: boolean; seen: string[] };

const DEFAULT_CATCH_UP_THRESHOLD = 10;
/** A corrupted bundle must not hang the cycle, so the parent walk is bounded. */
const MAX_THREAD_DEPTH = 64;

/** Mine, by either identity. A plain vault has no member id, only a device. */
function isMine(
  comment: WorkspaceCommentRecord,
  selfMemberId: string | null,
  selfDeviceId: string | null,
): boolean {
  if (selfMemberId && comment.authorMemberId === selfMemberId) return true;
  if (selfDeviceId && comment.authorDeviceId === selfDeviceId) return true;
  return false;
}

/** The root of the thread this comment belongs to, or the comment itself. */
function rootOf(
  comment: WorkspaceCommentRecord,
  byId: ReadonlyMap<string, WorkspaceCommentRecord>,
): WorkspaceCommentRecord {
  let current = comment;
  for (let hops = 0; hops < MAX_THREAD_DEPTH; hops++) {
    if (!current.parentCommentId) return current;
    const parent = byId.get(current.parentCommentId);
    if (!parent) return current;
    current = parent;
  }
  return current;
}

/** Did I write anywhere in this thread? Joining halfway still joins it. */
function iAmInThread(
  root: WorkspaceCommentRecord,
  exceptCommentId: string,
  byId: ReadonlyMap<string, WorkspaceCommentRecord>,
  selfMemberId: string | null,
  selfDeviceId: string | null,
): boolean {
  if (isMine(root, selfMemberId, selfDeviceId)) return true;
  for (const entry of byId.values()) {
    if (entry.commentId === exceptCommentId) continue;
    if (rootOf(entry, byId).commentId !== root.commentId) continue;
    if (isMine(entry, selfMemberId, selfDeviceId)) return true;
  }
  return false;
}

/**
 * Why this comment should reach me, or null for "it should not".
 *
 * The order matters only for the wording: a mention that is also a reply reads
 * better as a mention, because that is the stronger claim on the reader.
 */
function reasonFor(
  comment: WorkspaceCommentRecord,
  note: CommentNotificationNote,
  input: CommentNotificationInput,
  byId: ReadonlyMap<string, WorkspaceCommentRecord>,
): CommentNotificationReason | null {
  const { selfMemberId, selfDeviceId, names, level } = input;

  // The two cases from section 4 that stand OUTSIDE the levels are asked first,
  // before any level can filter them away. Order is the whole point here: asking
  // the level first would swallow both on setting 1, which is exactly what they
  // are exempt from.

  // A guest remark reaches the owner on every setting, because otherwise a share
  // is a one-way street - they would learn of it only by looking.
  if ((note.source ?? "vault") === "publication") return "guest";

  // A suggestion is a request for a decision, not a remark. It counts as
  // awaiting ME only where the note is mine to decide on.
  const ownsNote = input.ownedPaths?.has(note.path) ?? false;
  if (comment.suggestion && !comment.suggestion.appliedAt && !comment.suggestion.declinedAt && ownsNote) {
    return "suggestion-awaiting-me";
  }

  if (mentionsMember([comment.body], selfMemberId, names)) return "mention";
  if (level === "mentions") return null;
  if (level === "all") return "all";

  // Level 2, "what concerns me".
  const root = rootOf(comment, byId);
  if (comment.parentCommentId && iAmInThread(root, comment.commentId, byId, selfMemberId, selfDeviceId)) {
    return "reply-to-me";
  }

  // A verdict on a proposal of mine. The marker carrying the outcome points back
  // at the comment it closes, which is where the authorship sits.
  if (comment.suggestionOutcome && comment.resolvedCommentId) {
    const closed = byId.get(comment.resolvedCommentId);
    if (closed && isMine(closed, selfMemberId, selfDeviceId)) return "my-suggestion-decided";
  }

  if (ownsNote) return "my-note";
  return null;
}

/**
 * The plan for one cycle.
 *
 * Every id encountered goes into `seen`, whether or not it produced a message -
 * so a mute, a level or an own comment never leaves a record behind that could
 * surface later as a stale notification.
 */
export function planCommentNotifications(input: CommentNotificationInput): CommentNotificationPlan {
  const seen: string[] = [];
  const notices: NewCommentNotice[] = [];
  const mutedPaths = input.mutedPaths ?? new Set<string>();

  for (const note of input.notes) {
    const byId = new Map(note.comments.map((entry) => [entry.commentId, entry]));
    for (const comment of note.comments) {
      if (input.seen.has(comment.commentId)) continue;
      // Accounted for the moment it is looked at, not the moment it is
      // reported. See the field note on `seen`.
      seen.push(comment.commentId);

      if (isMine(comment, input.selfMemberId, input.selfDeviceId)) continue;
      if (mutedPaths.has(note.path)) continue;
      // A settled thread must never notify again - the same answer the column
      // gives, from the same helper, so the two cannot drift apart.
      if (!isCommentThreadOpen(rootOf(comment, byId))) continue;

      const reason = reasonFor(comment, note, input, byId);
      if (!reason) continue;
      notices.push({
        commentId: comment.commentId,
        path: note.path,
        authorMemberId: comment.authorMemberId,
        authorDeviceId: comment.authorDeviceId,
        body: comment.body,
        createdAt: comment.createdAt,
        source: note.source ?? "vault",
        publicationName: note.publicationName,
        reason,
      });
    }
  }

  if (notices.length === 0) return { kind: "none", seen };
  if (notices.length === 1) return { kind: "single", notice: notices[0], seen };

  const noteCount = new Set(notices.map((notice) => notice.path)).size;
  const threshold = input.catchUpThreshold ?? DEFAULT_CATCH_UP_THRESHOLD;
  return {
    kind: "bundle",
    commentCount: notices.length,
    noteCount,
    catchUp: notices.length >= threshold,
    seen,
  };
}

/**
 * Every comment id currently present, for drawing the baseline (FB3).
 *
 * Switching notifications on marks what exists as seen, so the first cycle
 * afterwards reports what happened SINCE - never the backlog. Without this the
 * very first cycle would be the flood this whole plan is built to avoid.
 */
export function commentBaseline(notes: readonly CommentNotificationNote[]): string[] {
  const ids: string[] = [];
  for (const note of notes) {
    for (const comment of note.comments) ids.push(comment.commentId);
  }
  return ids;
}
