/**
 * What a comment thread IS, decided once for both shells (Stufe D, D9).
 *
 * The desktop column and the phone sheet each built this themselves - same
 * behaviour, two truths, and the vault-wide overview would have made it three.
 * A thread is a structural fact about the records, not a property of the surface
 * that draws it, so it belongs here.
 */
import type { WorkspaceCommentRecord } from "@plainva/core";
import { mentionsMember } from "./commentMentions.js";

export interface CommentThread {
  root: WorkspaceCommentRecord;
  replies: WorkspaceCommentRecord[];
  /** Somebody wrote `@` and your name in here, and the thread is still open. */
  addressed: boolean;
}

/**
 * A reply whose root has not arrived yet (partial sync) becomes its own thread
 * rather than disappearing: every comment must stay reachable.
 */
export function buildCommentThreads(
  comments: readonly WorkspaceCommentRecord[],
  selfMemberId: string | null,
  names: ReadonlyMap<string, string>,
): CommentThread[] {
  const byId = new Map(comments.map((entry) => [entry.commentId, entry]));
  const threads = new Map<string, CommentThread>();
  for (const comment of comments) {
    if (!comment.parentCommentId || !byId.has(comment.parentCommentId)) {
      threads.set(comment.commentId, { root: comment, replies: [], addressed: false });
    }
  }
  for (const comment of comments) {
    if (!comment.parentCommentId) continue;
    threads.get(comment.parentCommentId)?.replies.push(comment);
  }
  const list = [...threads.values()];
  for (const thread of list) {
    // A resolved thread is deliberately never "addressed": it needs no attention
    // any more, and floating it would push the open ones down for nothing.
    thread.addressed =
      !thread.root.resolvedAt &&
      mentionsMember([thread.root.body, ...thread.replies.map((reply) => reply.body)], selfMemberId, names);
  }
  // A thread that names you comes first - that is what a mention is FOR. The
  // badge on the card says why it jumped, so the order never looks arbitrary.
  if (!list.some((thread) => thread.addressed)) return list;
  return [...list.filter((thread) => thread.addressed), ...list.filter((thread) => !thread.addressed)];
}

/**
 * Still waiting for somebody.
 *
 * `resolvedAt` alone is not the whole answer: accepting a suggestion resolves it
 * too, and so does declining one. A proposal that has been decided is done even
 * when the record that decided it has not been folded in yet.
 */
export function isCommentThreadOpen(root: WorkspaceCommentRecord): boolean {
  if (root.resolvedAt) return false;
  return !root.suggestion?.appliedAt && !root.suggestion?.declinedAt;
}

export interface CommentOverviewNote {
  path: string;
  threads: CommentThread[];
  /** How many of them name you. Drives both the badge and the sort. */
  addressedCount: number;
}

export interface CommentOverviewInput {
  path: string;
  comments: readonly WorkspaceCommentRecord[];
}

/**
 * Every OPEN thread of the vault, grouped by note (D9).
 *
 * Notes that name you come first, because that is the question the overview
 * exists to answer; everything else follows by path so the list stays where the
 * eye left it. A note whose threads are all settled drops out entirely - an
 * overview of finished work is a list nobody reads.
 */
export function buildCommentOverview(
  entries: readonly CommentOverviewInput[],
  selfMemberId: string | null,
  names: ReadonlyMap<string, string>,
  options: { onlyAddressed?: boolean } = {},
): CommentOverviewNote[] {
  const notes: CommentOverviewNote[] = [];
  for (const entry of entries) {
    let threads = buildCommentThreads(entry.comments, selfMemberId, names).filter((thread) =>
      isCommentThreadOpen(thread.root),
    );
    const addressedCount = threads.filter((thread) => thread.addressed).length;
    if (options.onlyAddressed) threads = threads.filter((thread) => thread.addressed);
    if (threads.length === 0) continue;
    notes.push({ path: entry.path, threads, addressedCount });
  }
  return notes.sort(
    (a, b) =>
      Number(b.addressedCount > 0) - Number(a.addressedCount > 0) ||
      a.path.localeCompare(b.path, undefined, { sensitivity: "base" }),
  );
}
