/**
 * "All inboxes": one list across every account — and the reason it needed its
 * own step rather than a corner of P9.3.
 *
 * Every mail action in the app is `(account, mailbox, id)`, with the account and
 * the folder coming from what the screen currently has selected. That holds
 * exactly as long as one list means one folder of one account. A merged list
 * breaks it twice over: an IMAP uid is folder-LOCAL (already learned in P9.3,
 * where a thread mixes INBOX and Sent), and it is account-local on top — two
 * IMAP accounts both have a message with uid "1234". Acting on the wrong one
 * would not fail loudly; it would mark, move or delete a DIFFERENT message.
 *
 * So in a merged list a row does not carry a bare id. It carries its origin, and
 * every action reads the origin back out of it. The id is the whole address of a
 * message, not a number that happens to be unique in one folder.
 */

/**
 * Separator: NUL, because a folder name can contain anything a person can type —
 * "Immobilien Suche", "INBOX/Sub.Folder", CJK. A space or a slash would split
 * the address in the middle of a name and address a folder that does not exist.
 * Written as an ESCAPE on purpose: a raw control byte in a source file makes git
 * treat it as binary (which is exactly what happened while writing this).
 */
const SEP = "\u0000";

export interface MailOrigin {
  accountId: string;
  mailbox: string;
  /** The id the transport uses: an IMAP uid as a string, or a Graph id. */
  uid: string;
}

/** The self-describing row id of a merged list. */
export function unifiedId(origin: MailOrigin): string {
  return `${origin.accountId}${SEP}${origin.mailbox}${SEP}${origin.uid}`;
}

/**
 * Reads an origin back, or null for a plain id (a single-folder list, where the
 * screen's own selection is the origin). Never throws: a stray id must not take
 * a mail screen down.
 */
export function parseUnifiedId(id: string): MailOrigin | null {
  const parts = id.split(SEP);
  if (parts.length !== 3) return null;
  const [accountId, mailbox, uid] = parts;
  if (!accountId || !uid) return null;
  return { accountId, mailbox, uid };
}

/** Whether an id addresses a message in another folder or account. */
export function isUnifiedId(id: string): boolean {
  return id.includes(SEP);
}

export interface RowAddress extends MailOrigin {
  /** The row named this address itself; it is not read off the open mailbox. */
  own: boolean;
}

/**
 * The message a list row opens.
 *
 * A row that carries its own address — every row of a merged list, and every
 * row built from one, a conversation over it included — opens THAT message:
 * its account, its folder, its uid. Any other row is a message of the account
 * that is open, in the folder it was listed in (a conversation reads Sent
 * along, so that is not always the folder on screen), else in the open one.
 * It is handed the id the row carries, or the selection id that addresses the
 * row's message (the row menu of a conversation names a message so).
 *
 * One answer for both shells (finding 2026-10-11). The desktop had it; the
 * phone's conversation rows asked the OPEN account for a row of the merged
 * list and handed the whole address on as if it were the uid, so with "All
 * inboxes" and conversations both on, no row led to its message.
 */
export function rowAddress(
  row: { id: string; mailbox?: string | null },
  open: { accountId: string; mailbox: string },
): RowAddress {
  const own = parseUnifiedId(row.id);
  if (own) return { ...own, own: true };
  return { accountId: open.accountId, mailbox: row.mailbox || open.mailbox, uid: row.id, own: false };
}

export interface OriginGroup<A> {
  account: A;
  mailbox: string;
  /** Transport-level ids, in the order they were given. */
  uids: string[];
}

/**
 * Groups row ids by the mailbox they actually live in, so a bulk action runs
 * once per (account, folder).
 *
 * Every id has to BE an address (finding 2026-10-12, plan P1). A plain id names
 * no folder, and there was a fallback for it: the folder on screen. That is
 * exactly the folder a message of a conversation does not lie in — your reply
 * in Sent carries a number that names another message in the inbox, or none —
 * so a plain id is refused here, like an id whose account is gone, rather than
 * read off whatever the screen shows. The lists of both shells name every row
 * by its address (`addressRows`), so nothing a person picked is lost by this.
 */
export function groupByOrigin<A>(
  ids: readonly string[],
  lookup: (accountId: string) => A | null | undefined,
): Array<OriginGroup<A>> {
  const groups = new Map<string, OriginGroup<A>>();
  for (const id of ids) {
    const origin = parseUnifiedId(id);
    if (!origin) continue;
    const account = lookup(origin.accountId);
    if (!account) continue;
    const key = `${origin.accountId}${SEP}${origin.mailbox}`;
    const existing = groups.get(key);
    if (existing) existing.uids.push(origin.uid);
    else groups.set(key, { account, mailbox: origin.mailbox, uids: [origin.uid] });
  }
  return [...groups.values()];
}

/**
 * The rows of one folder of one account, each named by its ADDRESS.
 *
 * The one rule of both mail lists (plan P1): a row is its address — account,
 * folder, number — in a folder as in "All inboxes", in a conversation as in a
 * search. A list that named its rows by their bare number made every action on
 * them a question to the screen ("which folder is open?"), and a conversation,
 * a merged list or an answer that arrived after a switch answered it wrongly:
 * a reply from Sent was marked, moved or deleted in the inbox under its number
 * there. Addressed here, where a list comes from the transport, an action needs
 * nothing but the row.
 *
 * A row that already carries an address keeps it, so applying this twice is
 * harmless. The transport keeps its bare ids: the cache and the server never
 * see an address.
 */
export function addressRows<T extends { id: string }>(
  rows: readonly T[],
  place: { accountId: string; mailbox: string },
): T[] {
  return rows.map((row) =>
    isUnifiedId(row.id) ? row : { ...row, id: unifiedId({ accountId: place.accountId, mailbox: place.mailbox, uid: row.id }) },
  );
}

/** The number the transport knows a row by — its address's, or the plain id. */
export function uidOf(id: string): string {
  return parseUnifiedId(id)?.uid ?? id;
}

/** Whether an address lies in this folder of this account. */
export function inPlace(id: string, place: { accountId: string; mailbox: string }): boolean {
  const origin = parseUnifiedId(id);
  return !!origin && origin.accountId === place.accountId && origin.mailbox === place.mailbox;
}

/**
 * The merged list: newest first, and capped PER ACCOUNT so one busy mailbox
 * cannot crowd the others out of the page.
 *
 * `perAccount` is applied before the merge for that reason — a global cap on the
 * merged list would let the loudest account fill it.
 */
export function mergeInboxes<T extends { dateTs: number }>(
  pages: ReadonlyArray<readonly T[]>,
  perAccount = 50,
): T[] {
  const out: T[] = [];
  for (const page of pages) out.push(...page.slice(0, Math.max(1, perAccount)));
  return out.sort((a, b) => b.dateTs - a.dateTs);
}
