/**
 * What the mail surface says about itself — in ONE line (S30).
 *
 * The screen grew a banner per condition, each added where its condition was
 * noticed, none aware of the others. They stack: an "all inboxes" view with a
 * stale cache and three unreachable accounts showed five notices before the
 * first message. On a 375 px screen that is the whole first screenful spent
 * telling the user things they cannot act on.
 *
 * So the conditions are ranked instead of listed. Only one line shows, the most
 * consequential one, and it carries the count of what it is standing in for —
 * "3 accounts unreachable" says the same thing as three banners in a tenth of
 * the room, and stays true when it is five.
 *
 * The ranking is by what it costs the reader to not know:
 *  1. the list could not be read at all — everything else is moot,
 *  2. some accounts are missing from it — what is on screen is incomplete,
 *  3. what is on screen is a stored copy — it is complete, just possibly old.
 */

export type MailStatusKind = "error" | "warning" | "info";

export interface MailStatus {
  kind: MailStatusKind;
  /** i18n key for the line. */
  key: string;
  /** Interpolation values for the key (count, names). */
  values?: Record<string, string | number>;
  /** Untranslated text, when the message comes from the server. */
  raw?: string;
}

export interface MailStatusInput {
  /** The load failed outright; nothing is on screen. */
  error: string | null;
  /** Accounts that failed while the merged list was built. */
  unifiedErrors: { label: string; message: string }[];
  /** Showing a stored copy rather than a fresh read. */
  stale: boolean;
  /** A refresh is running behind the stored copy. */
  refreshing: boolean;
}

export function mailStatus(input: MailStatusInput): MailStatus | null {
  // An outright failure replaces the list, so nothing under it is worth saying.
  if (input.error) return { kind: "error", key: "", raw: input.error };

  if (input.unifiedErrors.length > 0) {
    const [first] = input.unifiedErrors;
    // One failure names itself and its reason — that is actionable. Several
    // become a count: five names and five reasons is a wall, not a warning.
    return input.unifiedErrors.length === 1
      ? { kind: "warning", key: "mail.accountUnreachable", values: { label: first.label, message: first.message } }
      : { kind: "warning", key: "mail.accountsUnreachable", values: { count: input.unifiedErrors.length } };
  }

  if (input.stale) {
    return { kind: "info", key: input.refreshing ? "mail.cachedRefreshing" : "mail.offlineCopy" };
  }

  return null;
}
