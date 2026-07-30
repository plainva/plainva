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

export interface OriginGroup<A> {
  account: A;
  mailbox: string;
  /** Transport-level ids, in the order they were given. */
  uids: string[];
}

/**
 * Groups selected row ids by the mailbox they actually live in, so a bulk action
 * runs once per (account, folder) instead of once per id against whatever the
 * screen had selected.
 *
 * `lookup` resolves an account id to the account object; ids whose account is
 * gone are dropped rather than guessed at — the alternative is acting on someone
 * else's mailbox. Plain ids fall back to `fallback`, which keeps every existing
 * single-folder caller behaving exactly as before.
 */
export function groupByOrigin<A>(
  ids: readonly string[],
  lookup: (accountId: string) => A | null | undefined,
  fallback: { account: A | null; mailbox: string },
): Array<OriginGroup<A>> {
  const groups = new Map<string, OriginGroup<A>>();
  const push = (account: A, mailbox: string, uid: string, accountKey: string) => {
    const key = `${accountKey}${SEP}${mailbox}`;
    const existing = groups.get(key);
    if (existing) existing.uids.push(uid);
    else groups.set(key, { account, mailbox, uids: [uid] });
  };
  for (const id of ids) {
    const origin = parseUnifiedId(id);
    if (!origin) {
      if (fallback.account) push(fallback.account, fallback.mailbox, id, "\u0001fallback");
      continue;
    }
    const account = lookup(origin.accountId);
    if (!account) continue;
    push(account, origin.mailbox, origin.uid, origin.accountId);
  }
  return [...groups.values()];
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
