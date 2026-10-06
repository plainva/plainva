/**
 * What the mail list actually shows.
 *
 * "All inboxes" merges the inboxes of every account into `unifiedRows`; a
 * single folder lives in `rows`. The screen rendered the merged list but asked
 * the FOLDER list whether it was empty, so a merged view with mail in it could
 * report "folder is empty" — and "load more" paged the folder list that was not
 * on screen, a control that could only ever do nothing.
 *
 * Both decisions live here so the list, the empty state and the pager can never
 * again disagree about which list is meant.
 *
 * The same goes for the two SERVER answers that take the folder's place — the
 * search hits and the flagged messages (TestFlight 02.10.2026, "the search
 * field does not seem to work"). The hits used to be written INTO `rows`, the
 * folder's own list: the next background reload of the folder (every sync run
 * and every index update bumps the screen) put the folder back while the
 * screen still believed it was showing a search; with the flagged filter on,
 * the hits were never shown at all; in the merged view they sat behind a list
 * that is not a folder; and a search without a hit said "this folder is
 * empty". So each answer has its own list now, and WHICH one is on screen is
 * decided here, once.
 */

export interface MailListInput<T> {
  /** "All inboxes" is on. */
  unified: boolean;
  /** Merged rows across accounts (loaded in one go, no paging). */
  unifiedRows: T[];
  /** Rows of the open folder — only ever the folder. */
  rows: T[];
  /** Hits of a search in the open folder; `null` = no search is showing. */
  searchRows?: T[] | null;
  /** The folder's flagged messages; `null` = the filter is off. */
  flaggedRows?: T[] | null;
  /** How many messages the open folder has in total. */
  total: number;
  loading: boolean;
  /** Set when the load failed; the error takes the place of the list. */
  error: string | null;
  /** Only unread rows (S29). Narrows what is ALREADY loaded, never a query. */
  unreadOnly?: boolean;
  /** Reads the unread state of a row; only needed with `unreadOnly`. */
  isUnread?: (row: T) => boolean;
  attachmentsOnly?: boolean;
  hasAttachment?: (row: T) => boolean;
}

export interface MailListView<T> {
  /** The rows on screen — the only list the surface may reason about. */
  listRows: T[];
  /**
   * The rows the list is made FROM, before the unread and attachment filters:
   * the search hits, else the flagged messages, else the folder (or the merged
   * inboxes). What a selection, a count or a banner may refer to.
   */
  sourceRows: T[];
  /** A server answer (search hits or flagged) stands where the folder would. */
  replaced: boolean;
  /** Show the empty state. */
  isEmpty: boolean;
  /** Show the "load more" button. */
  showsLoadMore: boolean;
  /** The empty list is empty BECAUSE of the unread filter, not by itself. */
  isEmptyByFilter: boolean;
  /** The empty list is a search that found nothing — not an empty folder. */
  isEmptyBySearch: boolean;
}

export function mailListView<T>(input: MailListInput<T>): MailListView<T> {
  // The merged view has no folder to ask, so neither server answer applies to
  // it; the screen offers neither there. A search wins over the flagged
  // filter: it is the more specific question, and the one just asked.
  const answer = input.unified ? null : input.searchRows ?? input.flaggedRows ?? null;
  const all = input.unified ? input.unifiedRows : answer ?? input.rows;
  const replaced = answer !== null;
  // The unread filter narrows what is on screen; it never asks the server, so
  // "no unread" means "none among the messages loaded so far" and the pager
  // must stay reachable. It runs HERE rather than at the render site for the
  // reason the whole helper exists: the empty state has to know the difference
  // between "this folder has no mail" and "none of it is unread".
  const unread = input.unreadOnly && input.isUnread ? all.filter(input.isUnread) : all;
  const listRows = input.attachmentsOnly && input.hasAttachment ? unread.filter(input.hasAttachment) : unread;
  const isEmpty = !input.error && !input.loading && listRows.length === 0;
  return {
    listRows,
    sourceRows: all,
    replaced,
    isEmptyByFilter: isEmpty && all.length > 0,
    isEmptyBySearch: isEmpty && all.length === 0 && !input.unified && !!input.searchRows,
    // An error already replaces the list; saying "empty" underneath it would
    // claim the folder has no mail when we simply could not read it.
    isEmpty,
    // Paging exists for a single folder only: the merged view is fetched whole,
    // and a search or the flagged query returns its complete result set.
    showsLoadMore: !replaced && !input.unified && input.rows.length < input.total,
  };
}
