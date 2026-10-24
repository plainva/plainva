import { quoteImapString } from "./imap";
import { MAIL_MAILBOX_CHANGED, type ImapCreds, type MailTransport } from "../transport";
import { ImapConnection, pageEnvelopes } from "./imap";
import { buildMimeMessage } from "./mimeBuild";
import { smtpSend } from "./smtp";
import { activeScriptName, sieveConnect } from "./sieve";
import { hasMailSocket } from "./socket";
import { SessionPool, accountMarker, sessionKey } from "./sessionPool";
import { bytesToBase64 } from "../mailOut";

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
    bulkAction: (creds, args) => withConn(creds, c => c.bulkAction(args)),
    checkLogin: (creds) => withConn(creds, (c) => c.listMailboxes()),

    listEnvelopes: (creds, args) =>
      withConn(creds, (c) => pageEnvelopes(c, args.mailbox, args.offset, args.limit, args.beforeUid)),

    fetchMessage: (creds, args) =>
      withConn(creds, async (c) => {
        await c.examine(args.mailbox);
        return c.fetchMessage(args.uid);
      }),

    // Base64 of the bytes, as the interface says and as the desktop command and
    // Graph answer (`rawFetchContract.test.ts` holds the three together).
    fetchRaw: (creds, args) =>
      withConn(creds, async (c) => {
        await c.examine(args.mailbox);
        return bytesToBase64(await c.fetchRaw(args.uid));
      }),

    fetchAttachment: (creds, args) =>
      withConn(creds, async (c) => {
        await c.examine(args.mailbox);
        return c.fetchAttachment(args.uid, args.index);
      }),

    // One fetch for all of a message's files. The epoch is compared before the
    // message is asked for: a UID read under another UIDVALIDITY names another
    // message, and its files must not land on a draft that forwards this one.
    fetchAttachments: (creds, args) =>
      withConn(creds, async (c) => {
        const { uidValidity } = await c.examine(args.mailbox);
        if (args.uidValidity && uidValidity && args.uidValidity !== uidValidity) throw new Error(MAIL_MAILBOX_CHANGED);
        return c.fetchAttachments(args.uid, args.indexes);
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

    // ManageSieve is its own connection on its own port — it is not IMAP, and
    // the pooled IMAP session cannot carry it.
    sieveGet: async (creds, args) => {
      if (creds.auth === "xoauth2") throw new Error("OAuth mail does not support ManageSieve");
      const session = await sieveConnect({ host: args.host, port: args.port, user: creds.user, pass: creds.pass });
      try {
        const name = activeScriptName(await session.listScripts());
        // A script that does not exist yet is an empty one, not an error.
        const body = await session.getScript(name).catch(() => "");
        return { name, body, capabilities: session.extensions };
      } finally {
        await session.close().catch(() => {});
      }
    },

    sievePut: async (creds, args) => {
      if (creds.auth === "xoauth2") throw new Error("OAuth mail does not support ManageSieve");
      const session = await sieveConnect({ host: args.host, port: args.port, user: creds.user, pass: creds.pass });
      try {
        await session.putScript(args.name, args.body);
        await session.setActive(args.name);
      } finally {
        await session.close().catch(() => {});
      }
    },

    deleteMessage: (creds, args) =>
      withConn(creds, async (c) => {
        const [result] = await c.bulkAction({ mailbox: args.mailbox, uids: [args.uid], action: { kind: "delete" } });
        if (result.status !== "done") throw new Error(result.reason === "unsupported" ? "MAIL_BULK_UNSUPPORTED" : "The mail server did not confirm the deletion");
      }),

    searchEnvelopes: (creds, args) =>
      withConn(creds, async (c) => {
        await c.examine(args.mailbox);
        // CHARSET UTF-8 for non-ASCII, like the desktop: strict servers reject
        // an 8-bit search term without it.
        // eslint-disable-next-line no-control-regex
        const ascii = /^[\x00-\x7f]*$/.test(args.query);
        const term = quoteImapString(args.query);
        const uids = await c.searchUids(`${ascii ? "" : "CHARSET UTF-8 "}TEXT ${term}`);
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
