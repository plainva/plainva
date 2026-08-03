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
 */

export interface MailListInput<T> {
  /** "All inboxes" is on. */
  unified: boolean;
  /** Merged rows across accounts (loaded in one go, no paging). */
  unifiedRows: T[];
  /** Rows of the open folder — also the search results. */
  rows: T[];
  /** How many messages the open folder has in total. */
  total: number;
  loading: boolean;
  /** A search is showing its hits instead of the folder. */
  searching: boolean;
  /** Set when the load failed; the error takes the place of the list. */
  error: string | null;
  /** Only unread rows (S29). Narrows what is ALREADY loaded, never a query. */
  unreadOnly?: boolean;
  /** Reads the unread state of a row; only needed with `unreadOnly`. */
  isUnread?: (row: T) => boolean;
}

export interface MailListView<T> {
  /** The rows on screen — the only list the surface may reason about. */
  listRows: T[];
  /** Show the "folder is empty" state. */
  isEmpty: boolean;
  /** Show the "load more" button. */
  showsLoadMore: boolean;
  /** The empty list is empty BECAUSE of the unread filter, not by itself. */
  isEmptyByFilter: boolean;
}

export function mailListView<T>(input: MailListInput<T>): MailListView<T> {
  const all = input.unified ? input.unifiedRows : input.rows;
  // The unread filter narrows what is on screen; it never asks the server, so
  // "no unread" means "none among the messages loaded so far" and the pager
  // must stay reachable. It runs HERE rather than at the render site for the
  // reason the whole helper exists: the empty state has to know the difference
  // between "this folder has no mail" and "none of it is unread".
  const listRows = input.unreadOnly && input.isUnread ? all.filter(input.isUnread) : all;
  const isEmpty = !input.error && !input.loading && listRows.length === 0;
  return {
    listRows,
    isEmptyByFilter: isEmpty && all.length > 0,
    // An error already replaces the list; saying "empty" underneath it would
    // claim the folder has no mail when we simply could not read it.
    isEmpty,
    // Paging exists for a single folder only: the merged view is fetched whole,
    // and search returns its complete result set.
    showsLoadMore: !input.searching && !input.unified && input.rows.length < input.total,
  };
}
