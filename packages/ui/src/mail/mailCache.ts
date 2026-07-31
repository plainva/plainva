import type { IDatabaseAdapter } from "@plainva/core";
import type { MailEnvelope, MailMessage } from "./types";
import { formatMessageIds, threadFields } from "./threading";

/**
 * Offline reading for mail (mail feinplan, cache stage; lifted to the shared
 * seam for the desktop in issue #34 wave 3).
 *
 * Deliberately a CACHE, never a source of truth: the server always wins, and
 * nothing here is ever the only copy of anything. A phone loses signal in a
 * lift and a laptop opens its mail before the network is up; the point is that
 * the list you just looked at is still there, not that the app becomes an
 * offline mail store.
 *
 * It lives in the vault's index database, next to the other per-vault caches,
 * so removing a vault removes its mail cache with it. Both shells pass their
 * own `IDatabaseAdapter` — the SQL is identical, which is the whole reason this
 * is one file instead of two.
 */

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mail_envelopes (
     account TEXT NOT NULL,
     mailbox TEXT NOT NULL,
     id TEXT NOT NULL,
     subject TEXT NOT NULL,
     sender TEXT NOT NULL,
     date_ts INTEGER NOT NULL,
     seen INTEGER NOT NULL,
     flagged INTEGER NOT NULL,
     preview TEXT NOT NULL DEFAULT '',
     thread_id TEXT NOT NULL DEFAULT '',
     message_id TEXT NOT NULL DEFAULT '',
     in_reply_to TEXT NOT NULL DEFAULT '',
     refs TEXT NOT NULL DEFAULT '',
     cached_at INTEGER NOT NULL,
     PRIMARY KEY (account, mailbox, id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mail_env_box ON mail_envelopes (account, mailbox, date_ts DESC)`,
  `CREATE TABLE IF NOT EXISTS mail_bodies (
     account TEXT NOT NULL,
     mailbox TEXT NOT NULL,
     id TEXT NOT NULL,
     payload TEXT NOT NULL,
     cached_at INTEGER NOT NULL,
     PRIMARY KEY (account, mailbox, id)
   )`,
];

/**
 * Columns added after the table shipped. CREATE TABLE IF NOT EXISTS leaves an
 * existing table alone, so a new column needs its own ALTER — which fails once
 * it is there, hence the swallowed error. Writing the migration this way keeps
 * the schema above readable as "what the table looks like now".
 */
const ADDED_COLUMNS = [
  // Third list line, added with device report B3 (2026-07-26).
  `ALTER TABLE mail_envelopes ADD COLUMN preview TEXT NOT NULL DEFAULT ''`,
  // Thread identity, added with findings P9.1 (2026-07-30). A cached row from
  // before this keeps empty strings, which read as "unknown" rather than as
  // "belongs to no conversation" — the next refresh fills them in. `refs`, not
  // `references`: that is a reserved word in SQLite's foreign-key syntax.
  `ALTER TABLE mail_envelopes ADD COLUMN thread_id TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE mail_envelopes ADD COLUMN message_id TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE mail_envelopes ADD COLUMN in_reply_to TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE mail_envelopes ADD COLUMN refs TEXT NOT NULL DEFAULT ''`,
];

/** Bodies are the big rows; keep the most recent ones only. */
const MAX_BODIES = 200;

export interface MailCacheSnapshot {
  version: 1;
  account: string;
  envelopes: Array<{
    account: string;
    mailbox: string;
    id: string;
    subject: string;
    sender: string;
    date_ts: number;
    seen: number;
    flagged: number;
    preview: string;
    thread_id: string;
    message_id: string;
    in_reply_to: string;
    refs: string;
    cached_at: number;
  }>;
  bodies: Array<{
    account: string;
    mailbox: string;
    id: string;
    payload: string;
    cached_at: number;
  }>;
}

let ready: WeakSet<object> = new WeakSet();

async function ensure(db: IDatabaseAdapter | null | undefined): Promise<boolean> {
  if (!db) return false;
  if (ready.has(db as object)) return true;
  for (const stmt of SCHEMA) await db.execute(stmt);
  for (const stmt of ADDED_COLUMNS) {
    await db.execute(stmt).catch(() => undefined); // already present
  }
  ready.add(db as object);
  return true;
}

/** Forgets the memo of which databases are prepared (vault switch). */
export function resetMailCache(): void {
  ready = new WeakSet();
}

export async function cacheEnvelopes(
  db: IDatabaseAdapter | null | undefined,
  account: string,
  mailbox: string,
  rows: MailEnvelope[],
  opts?: {
    /**
     * Treat `rows` as the NEWEST page of this mailbox, complete down to its
     * oldest entry — which lets the cache drop what the server no longer lists.
     *
     * Only the caller knows this. The write is an upsert, so without it nothing
     * ever leaves: a deleted message kept its cached row for good and reappeared
     * at the top of the list on every open, until the refresh landed and pushed
     * it away again (finding 2026-07-30). Never pass this for a conversation or
     * a unified list — those pull messages from other folders and accounts, so
     * "missing from the page" would not mean "gone from the folder".
     */
    newestPage?: boolean;
  }
): Promise<void> {
  if (!db || !(await ensure(db)) || rows.length === 0) return;
  const now = Date.now();
  for (const m of rows) {
    await db.execute(
      `INSERT INTO mail_envelopes (account, mailbox, id, subject, sender, date_ts, seen, flagged, preview,
                                   thread_id, message_id, in_reply_to, refs, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account, mailbox, id) DO UPDATE SET
         subject = excluded.subject, sender = excluded.sender, date_ts = excluded.date_ts,
         seen = excluded.seen, flagged = excluded.flagged, preview = excluded.preview,
         thread_id = excluded.thread_id, message_id = excluded.message_id,
         in_reply_to = excluded.in_reply_to, refs = excluded.refs,
         cached_at = excluded.cached_at`,
      [
        account,
        mailbox,
        m.id,
        m.subject,
        m.from,
        m.dateTs,
        m.seen ? 1 : 0,
        m.flagged ? 1 : 0,
        m.preview ?? "",
        m.threadId ?? "",
        m.messageId ?? "",
        m.inReplyTo ?? "",
        // Stored in the header's own form, so one parser reads it back.
        formatMessageIds(m.references),
        now,
      ]
    );
  }
  if (opts?.newestPage) await pruneToPage(db, account, mailbox, rows);
}

/**
 * Drops cached rows the page proves are gone.
 *
 * The window is everything at least as new as the page's oldest entry: within
 * it the page is complete, so anything the cache still holds there was deleted
 * or moved away. Older messages are outside what this page can testify to and
 * stay untouched — a "load more" further down must not be read as a statement
 * about the top of the folder.
 */
async function pruneToPage(db: IDatabaseAdapter, account: string, mailbox: string, rows: MailEnvelope[]): Promise<void> {
  const ids = rows.map((r) => r.id);
  let oldest = rows[0].dateTs;
  for (const r of rows) if (r.dateTs < oldest) oldest = r.dateTs;
  const keep = ids.map(() => "?").join(",");
  const stale = await db.query<{ id: string }>(
    `SELECT id FROM mail_envelopes
      WHERE account = ? AND mailbox = ? AND date_ts >= ? AND id NOT IN (${keep})`,
    [account, mailbox, oldest, ...ids]
  );
  if (stale.length === 0) return;
  await forgetCachedMessages(db, account, mailbox, stale.map((s) => s.id));
}

/**
 * Removes single messages from the cache — the local half of the same job.
 *
 * Deleting or moving a message here is a fact this device already knows, so the
 * cached row goes with it instead of waiting for the next refresh to notice.
 * The window prune above covers what OTHER devices did; this covers what you
 * just did.
 */
export async function forgetCachedMessages(
  db: IDatabaseAdapter | null | undefined,
  account: string,
  mailbox: string,
  ids: readonly string[]
): Promise<void> {
  if (!db || ids.length === 0 || !(await ensure(db))) return;
  const list = ids.map(() => "?").join(",");
  for (const table of ["mail_envelopes", "mail_bodies"]) {
    await db.execute(`DELETE FROM ${table} WHERE account = ? AND mailbox = ? AND id IN (${list})`, [account, mailbox, ...ids]);
  }
}

export async function cachedEnvelopes(
  db: IDatabaseAdapter | null | undefined,
  account: string,
  mailbox: string,
  limit: number
): Promise<MailEnvelope[]> {
  if (!db || !(await ensure(db))) return [];
  const rows = await db.query<{
    id: string;
    subject: string;
    sender: string;
    date_ts: number;
    seen: number;
    flagged: number;
    preview: string | null;
    thread_id: string | null;
    message_id: string | null;
    in_reply_to: string | null;
    refs: string | null;
  }>(
    `SELECT id, subject, sender, date_ts, seen, flagged, preview, thread_id, message_id, in_reply_to, refs
     FROM mail_envelopes
     WHERE account = ? AND mailbox = ? ORDER BY date_ts DESC LIMIT ?`,
    [account, mailbox, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    from: r.sender,
    dateTs: r.date_ts,
    seen: r.seen === 1,
    flagged: r.flagged === 1,
    preview: r.preview ?? "",
    // Same normaliser as the live path, so a cached conversation groups exactly
    // like a fetched one — an offline list that grouped differently would be a
    // worse lie than no grouping at all.
    ...threadFields({ threadId: r.thread_id, messageId: r.message_id, inReplyTo: r.in_reply_to, references: r.refs }),
  }));
}

export async function cacheMessage(
  db: IDatabaseAdapter | null | undefined,
  account: string,
  mailbox: string,
  message: MailMessage
): Promise<void> {
  if (!db || !(await ensure(db))) return;
  await db.execute(
    `INSERT INTO mail_bodies (account, mailbox, id, payload, cached_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account, mailbox, id) DO UPDATE SET payload = excluded.payload, cached_at = excluded.cached_at`,
    [account, mailbox, message.id, JSON.stringify(message), Date.now()]
  );
  // Bounded on write rather than on a timer: a cache that only ever grows is
  // the same bug as no cache at all, just slower to notice.
  await db.execute(
    `DELETE FROM mail_bodies WHERE rowid NOT IN
       (SELECT rowid FROM mail_bodies ORDER BY cached_at DESC LIMIT ?)`,
    [MAX_BODIES]
  );
}

export async function cachedMessage(
  db: IDatabaseAdapter | null | undefined,
  account: string,
  mailbox: string,
  id: string
): Promise<MailMessage | null> {
  if (!db || !(await ensure(db))) return null;
  const rows = await db.query<{ payload: string }>(
    `SELECT payload FROM mail_bodies WHERE account = ? AND mailbox = ? AND id = ?`,
    [account, mailbox, id]
  );
  if (rows.length === 0) return null;
  try {
    return JSON.parse(rows[0].payload) as MailMessage;
  } catch {
    return null; // a corrupt row is a cache miss, never an error
  }
}

/** Drops everything cached for an account (used when it is removed). */
export async function forgetCachedMail(db: IDatabaseAdapter | null | undefined, account: string): Promise<void> {
  if (!db || !(await ensure(db))) return;
  await db.execute(`DELETE FROM mail_envelopes WHERE account = ?`, [account]);
  await db.execute(`DELETE FROM mail_bodies WHERE account = ?`, [account]);
}

/**
 * Device-local rollback material for a confirmed account repair. It can
 * contain cached message text, so callers must keep it out of shared settings,
 * diagnostics and logs.
 */
export async function snapshotCachedMail(
  db: IDatabaseAdapter | null | undefined,
  account: string,
): Promise<MailCacheSnapshot> {
  if (!db || !(await ensure(db))) return { version: 1, account, envelopes: [], bodies: [] };
  const envelopes = await db.query<MailCacheSnapshot["envelopes"][number]>(
    `SELECT account, mailbox, id, subject, sender, date_ts, seen, flagged, preview,
            thread_id, message_id, in_reply_to, refs, cached_at
       FROM mail_envelopes WHERE account = ?`,
    [account],
  );
  const bodies = await db.query<MailCacheSnapshot["bodies"][number]>(
    `SELECT account, mailbox, id, payload, cached_at FROM mail_bodies WHERE account = ?`,
    [account],
  );
  return { version: 1, account, envelopes, bodies };
}

/** Restores a mail-cache snapshot exactly after an interrupted cleanup. */
export async function restoreCachedMail(
  db: IDatabaseAdapter | null | undefined,
  snapshot: MailCacheSnapshot,
): Promise<void> {
  if (!db || !(await ensure(db))) return;
  if (snapshot.version !== 1) throw new Error("unsupported-mail-cache-snapshot");
  await db.transaction(async () => {
    await db.execute(`DELETE FROM mail_envelopes WHERE account = ?`, [snapshot.account]);
    await db.execute(`DELETE FROM mail_bodies WHERE account = ?`, [snapshot.account]);
    for (const row of snapshot.envelopes) {
      await db.execute(
        `INSERT OR REPLACE INTO mail_envelopes
           (account, mailbox, id, subject, sender, date_ts, seen, flagged, preview,
            thread_id, message_id, in_reply_to, refs, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.account, row.mailbox, row.id, row.subject, row.sender, row.date_ts,
          row.seen, row.flagged, row.preview, row.thread_id, row.message_id,
          row.in_reply_to, row.refs, row.cached_at,
        ],
      );
    }
    for (const row of snapshot.bodies) {
      await db.execute(
        `INSERT OR REPLACE INTO mail_bodies (account, mailbox, id, payload, cached_at)
         VALUES (?, ?, ?, ?, ?)`,
        [row.account, row.mailbox, row.id, row.payload, row.cached_at],
      );
    }
  });
}
