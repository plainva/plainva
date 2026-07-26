import type { MailTransport } from "../transport";
import { ImapConnection, pageEnvelopes } from "./imap";
import { buildMimeMessage } from "./mimeBuild";
import { smtpSend } from "./smtp";
import { hasMailSocket } from "./socket";

/**
 * `MailTransport` built on the shared IMAP/SMTP clients (mail feinplan G2).
 * Every operation opens a fresh connection and closes it again — the same
 * contract the desktop's Rust side has always had (E-G6, no pooling), so the
 * two platforms behave identically under flaky networks.
 */

async function withConn<T>(creds: Parameters<MailTransport["checkLogin"]>[0], fn: (c: ImapConnection) => Promise<T>): Promise<T> {
  const conn = await ImapConnection.connect(creds);
  try {
    return await fn(conn);
  } finally {
    await conn.close().catch(() => undefined);
  }
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
  };
}

export { hasMailSocket };
