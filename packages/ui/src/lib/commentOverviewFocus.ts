/**
 * What a gathered comment notification means when it is opened (Sammelplan
 * C30, from Stufe F §6): the vault-wide overview, narrowed to the remarks the
 * notification was about.
 *
 * The overview cannot know "new" on its own: it filters by what the RECORDS
 * say ("names me"), while "new" is a state of the notifier's ledger — and that
 * ledger has already recorded the announced comments as seen by the time the
 * notification is clicked. So the notifier parks the ids it announced here,
 * the shell opens the overview, and the overview takes the set and starts on
 * its "new" segment. Same shape as the single-comment jump: a request, not a
 * call, because on a cold start the surface does not exist yet.
 */
let pending: ReadonlySet<string> | null = null;

export const COMMENT_OVERVIEW_FOCUS_EVENT = "plainva-comment-overview-focus";

/** Asks the overview to open on these comments. Empty means "no narrowing". */
export function requestCommentOverviewFocus(commentIds: Iterable<string>): void {
  const set = new Set(commentIds);
  pending = set.size > 0 ? set : null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(COMMENT_OVERVIEW_FOCUS_EVENT, { detail: pending }));
  }
}

/** Takes the parked set (once). */
export function takeCommentOverviewFocus(): ReadonlySet<string> | null {
  const set = pending;
  pending = null;
  return set;
}

/** For tests. */
export function resetCommentOverviewFocusForTest(): void {
  pending = null;
}
