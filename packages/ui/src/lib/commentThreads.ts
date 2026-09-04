/**
 * What a comment thread IS, decided once for both shells (Stufe D, D9).
 *
 * The desktop column and the phone sheet each built this themselves - same
 * behaviour, two truths, and the vault-wide overview would have made it three.
 * A thread is a structural fact about the records, not a property of the surface
 * that draws it, so it belongs here.
 */
import { propertyAnchorKey, resolvePropertyAnchor, type WorkspaceCommentRecord } from "@plainva/core";
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
  options: {
    onlyAddressed?: boolean;
    /**
     * Only threads that contain one of these comments (C30): what a gathered
     * notification announced. "New" is a state of the notifier's ledger, not
     * of the records, so the caller hands the ids in.
     */
    onlyIds?: ReadonlySet<string>;
  } = {},
): CommentOverviewNote[] {
  const notes: CommentOverviewNote[] = [];
  for (const entry of entries) {
    let threads = buildCommentThreads(entry.comments, selfMemberId, names).filter((thread) =>
      isCommentThreadOpen(thread.root),
    );
    const addressedCount = threads.filter((thread) => thread.addressed).length;
    if (options.onlyAddressed) threads = threads.filter((thread) => thread.addressed);
    const ids = options.onlyIds;
    if (ids) threads = threads.filter((thread) => ids.has(thread.root.commentId) || thread.replies.some((r) => ids.has(r.commentId)));
    if (threads.length === 0) continue;
    notes.push({ path: entry.path, threads, addressedCount });
  }
  return notes.sort(
    (a, b) =>
      Number(b.addressedCount > 0) - Number(a.addressedCount > 0) ||
      a.path.localeCompare(b.path, undefined, { sensitivity: "base" }),
  );
}

/** One note's comments, as the caller already holds them. */
export interface PropertyCommentCellsInput {
  path: string;
  comments: readonly WorkspaceCommentRecord[];
}

/**
 * Which CELLS of a `.base` carry an open property comment (Stufe E, E2).
 *
 * The panel of a note and a database ask the same question of the same anchor,
 * but not of the same thing: the panel resolves a key against that note's
 * FRONTMATTER, a database against its COLUMNS. Hence an orphan looks different
 * on the two surfaces - the panel has no row for it and still shows the card,
 * a table has no cell to put a dot on and shows none. The note's comment column
 * keeps naming it either way, so nothing is lost, only unmarked.
 *
 * THREADS, not messages: a reply inherits its thread's anchor and carries none
 * of its own, so `propertyAnchorKey` is null for every reply and roots are
 * counted by construction. A settled thread - resolved, or a suggestion that was
 * applied or declined - drops out, because a dot that never disappears is a dot
 * nobody reads.
 */
export function buildPropertyCommentCells(
  entries: readonly PropertyCommentCellsInput[],
  hasColumn: (key: string) => boolean,
  aliasOf?: (former: string) => string | null,
): Map<string, Map<string, number>> {
  const cells = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    for (const comment of entry.comments) {
      if (!comment.anchor) continue;
      const key = propertyAnchorKey(comment.anchor);
      if (!key) continue;
      if (!isCommentThreadOpen(comment)) continue;
      const resolution = resolvePropertyAnchor(key, hasColumn, aliasOf);
      if (resolution.status === "orphan") continue;
      let columns = cells.get(entry.path);
      if (!columns) {
        columns = new Map<string, number>();
        cells.set(entry.path, columns);
      }
      columns.set(resolution.key, (columns.get(resolution.key) ?? 0) + 1);
    }
  }
  return cells;
}

/**
 * The thread a database CELL stands for (finding 2026-09-04).
 *
 * The reverse of `buildPropertyCommentCells`: that one asks "which cells carry
 * a dot", this one "which thread does this cell's dot mean" - so a click on the
 * dot can land on the card instead of only saying that one exists. Same
 * resolution, so a renamed property is followed here exactly as there.
 *
 * An OPEN thread wins over a settled one (the dot counts only open ones, but a
 * click that arrives a moment after somebody resolved the last one should still
 * land somewhere), and among equals the oldest - that is the one the count has
 * been about the longest.
 */
export function findPropertyCommentThread(
  comments: readonly WorkspaceCommentRecord[],
  column: string,
  aliasOf?: (former: string) => string | null,
): string | null {
  let settled: WorkspaceCommentRecord | null = null;
  let open: WorkspaceCommentRecord | null = null;
  for (const comment of comments) {
    if (!comment.anchor) continue;
    const key = propertyAnchorKey(comment.anchor);
    if (!key) continue;
    const resolution = resolvePropertyAnchor(key, (candidate) => candidate === column, aliasOf);
    if (resolution.status === "orphan" || resolution.key !== column) continue;
    const target = isCommentThreadOpen(comment) ? "open" : "settled";
    const current = target === "open" ? open : settled;
    if (current && current.createdAt <= comment.createdAt) continue;
    if (target === "open") open = comment;
    else settled = comment;
  }
  return (open ?? settled)?.commentId ?? null;
}

/**
 * A proposal round (Vorschlagsmodus, V3): the blocks one "send" produced,
 * in the order they sit in the note, with the sentence written for the round.
 * A thread is a block when its root carries a round id; everything else stays
 * a thread of its own.
 */
export interface SuggestionRound {
  batchId: string;
  authorMemberId: string;
  createdAt: string;
  note: string | null;
  blocks: CommentThread[];
  /** Blocks nobody has decided on yet. */
  open: number;
}

/**
 * Comments and proposals are two tools (Vorschlagsmodus, V4): a proposal - in
 * a round or on its own - goes to the proposals tab, everything else stays a
 * comment. Rounds are grouped; a lone proposal (written before the mode
 * existed) is a round of one without an id.
 */
export function groupSuggestionRounds(threads: readonly CommentThread[]): { rounds: SuggestionRound[]; threads: CommentThread[] } {
  const byBatch = new Map<string, SuggestionRound>();
  const rest: CommentThread[] = [];
  for (const thread of threads) {
    const batchId = thread.root.suggestionBatchId ?? (thread.root.suggestion ? `single:${thread.root.commentId}` : null);
    if (!batchId || !thread.root.suggestion) { rest.push(thread); continue; }
    let round = byBatch.get(batchId);
    if (!round) {
      round = { batchId, authorMemberId: thread.root.authorMemberId, createdAt: thread.root.createdAt, note: thread.root.batchNote ?? null, blocks: [], open: 0 };
      byBatch.set(batchId, round);
    }
    round.blocks.push(thread);
    if (thread.root.createdAt < round.createdAt) round.createdAt = thread.root.createdAt;
    if (!round.note && thread.root.batchNote) round.note = thread.root.batchNote;
  }
  const rounds = [...byBatch.values()];
  for (const round of rounds) {
    round.blocks.sort((a, b) => (a.root.batchIndex ?? 0) - (b.root.batchIndex ?? 0) || a.root.createdAt.localeCompare(b.root.createdAt));
    round.open = round.blocks.filter((block) => isCommentThreadOpen(block.root)).length;
  }
  rounds.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { rounds, threads: rest };
}
