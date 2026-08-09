import type { ImapCreds, MailTransport } from "../transport";
import { ImapConnection, pageEnvelopes } from "./imap";
import { buildMimeMessage } from "./mimeBuild";
import { smtpSend } from "./smtp";
import { hasMailSocket } from "./socket";
import { SessionPool, accountMarker, sessionKey } from "./sessionPool";

/**
 * `MailTransport` built on the shared IMAP/SMTP clients (mail feinplan G2).
 *
 * Findings round P7.3: operations no longer open their own connection. One idle
 * session per account is kept and handed out again — the same policy as the
 * desktop's Rust pool (P7.2), from the same five rules, so both platforms behave
 * identically under a flaky network. Reading three messages in one folder now
 * costs one login instead of four, which on a phone is the difference between
 * "opens" and "loads".
 */

const pool = new SessionPool<ImapConnection>({
  healthy: (conn) => conn.noop(),
  close: (conn) => conn.close().catch(() => undefined),
});

async function withConn<T>(creds: ImapCreds, fn: (c: ImapConnection) => Promise<T>): Promise<T> {
  return pool.with(sessionKey(creds), () => ImapConnection.connect(creds), fn);
}

/**
 * Drops pooled sessions — one account, or all of them. The phone MUST call this
 * without an account when it goes to the background: the OS suspends the
 * sockets, and a resumed connection is dead without saying so.
 */
export async function releaseSocketSessions(user?: string): Promise<void> {
  await pool.release(user === undefined ? undefined : accountMarker(user));
}

export function createSocketMailTransport(): MailTransport {
  return {
    checkLogin: (creds) => withConn(creds, (c) => c.listMailboxes()),

    listEnvelopes: (creds, args) =>
      withConn(creds, (c) => pageEnvelopes(c, args.mailbox, args.offset, args.limit, args.beforeUid)),

    fetchMessage: (creds, args) =>
      withConn(creds, async (c) => {
        await c.examine(args.mailbox);
        return c.fetchMessage(args.uid);
      }),

    fetchRaw: (creds, args) =>
      withConn(creds, async (c) => {
        await c.examine(args.mailbox);
        return c.fetchRaw(args.uid);
      }),

    fetchAttachment: (creds, args) =>
      withConn(creds, async (c) => {
        await c.examine(args.mailbox);
        return c.fetchAttachment(args.uid, args.index);
      }),

    appendDraft: (creds, args) =>
      withConn(creds, async (c) => {
        const mime = buildMimeMessage({
          from: creds.user,
          to: args.to,
          cc: args.cc,
          subject: args.subject,
          text: args.text,
          html: args.html,
          attachments: args.attachments,
        });
        await c.append(args, new TextEncoder().encode(mime));
      }),

    setSeen: (creds, args) =>
      withConn(creds, async (c) => {
        await c.select(args.mailbox);
        await c.store(args.uid, "\\Seen", args.seen);
      }),

    setFlagged: (creds, args) =>
      withConn(creds, async (c) => {
        await c.select(args.mailbox);
        await c.store(args.uid, "\\Flagged", args.flagged);
      }),

    moveMessage: (creds, args) =>
      withConn(creds, async (c) => {
        await c.select(args.mailbox);
        await c.move(args.uid, args.target);
      }),

    // `$Junk`/`$NotJunk` are custom keywords: a server may refuse them, and one
    // that stores them may train nothing from them. Clearing the opposite one is
    // best-effort so a refusal there does not undo the mark that just worked.
    setJunk: (creds, args) =>
      withConn(creds, async (c) => {
        await c.select(args.mailbox);
        const [add, remove] = args.junk ? ["$Junk", "$NotJunk"] : ["$NotJunk", "$Junk"];
        await c.store(args.uid, add, true);
        await c.store(args.uid, remove, false).catch(() => {});
      }),

    createMailbox: (creds, args) => withConn(creds, (c) => c.create(args.name)),

    deleteMessage: (creds, args) =>
      withConn(creds, async (c) => {
        await c.select(args.mailbox);
        await c.store(args.uid, "\\Deleted", true);
        await c.expunge(args.uid);
      }),

    searchEnvelopes: (creds, args) =>
      withConn(creds, async (c) => {
        await c.examine(args.mailbox);
        // CHARSET UTF-8 for non-ASCII, like the desktop: strict servers reject
        // an 8-bit search term without it.
        // eslint-disable-next-line no-control-regex
        const ascii = /^[\x00-\x7f]*$/.test(args.query);
        const term = args.query.replace(/"/g, '\\"');
        const uids = await c.searchUids(`${ascii ? "" : "CHARSET UTF-8 "}TEXT "${term}"`);
        return c.fetchEnvelopes(uids.slice(-args.limit).reverse());
      }),

    listFlaggedEnvelopes: (creds, args) =>
      withConn(creds, async (c) => {
        await c.examine(args.mailbox);
        const uids = await c.searchUids("FLAGGED");
        return c.fetchEnvelopes(uids.slice(-args.limit).reverse());
      }),

    send: async (args) => {
      const mime = buildMimeMessage({
        from: args.from,
        to: args.to,
        cc: args.cc,
        bcc: args.bcc,
        subject: args.subject,
        text: args.text,
        html: args.html,
        attachments: args.attachments,
        calendar: args.calendar ? { ics: args.calendar, method: args.calendarMethod } : undefined,
      });
      await smtpSend(args, mime);
    },

    releaseSessions: releaseSocketSessions,
  };
}

export { hasMailSocket };
