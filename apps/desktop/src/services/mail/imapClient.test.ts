import { describe, expect, it, beforeEach } from "vitest";
import {
  ImapConnection,
  buildMimeMessage,
  createSocketMailTransport,
  encodeImapUtf7,
  pageEnvelopes,
  parseMessage,
  previewFromBodyPrefix,
  setMailSocket,
  type MailSocket,
} from "@plainva/ui/mail";

/**
 * The mobile IMAP/SMTP client (mail feinplan G2) runs entirely in shared code,
 * so it can be driven against a scripted server here — no device, no network.
 * These tests pin the protocol decisions that are expensive to get wrong:
 * literals, modified UTF-7 mailbox names, MIME decoding, and the refusal to
 * send a password over an unencrypted socket.
 */

const CRLF = "\r\n";

/** A socket whose "server" is a list of canned replies, keyed by command. */
class ScriptedSocket implements MailSocket {
  written: string[] = [];
  private queue: string[] = [];
  private replies: (cmd: string) => string | null;
  tlsUpgrades = 0;
  opened: { host: string; port: number; tls: boolean } | null = null;

  constructor(greeting: string, replies: (cmd: string) => string | null) {
    this.replies = replies;
    this.queue.push(greeting);
  }

  async open(opts: { host: string; port: number; tls: boolean }): Promise<string> {
    this.opened = opts;
    return "s1";
  }
  async startTls(): Promise<void> {
    this.tlsUpgrades++;
  }
  async write(_id: string, dataBase64: string): Promise<void> {
    const text = Buffer.from(dataBase64, "base64").toString("utf8");
    this.written.push(text);
    for (const line of text.split(CRLF)) {
      if (!line) continue;
      const reply = this.replies(line);
      if (reply) this.queue.push(reply);
    }
  }
  async read(): Promise<string> {
    const next = this.queue.shift();
    if (next === undefined) return "";
    return Buffer.from(next, "utf8").toString("base64");
  }
  async close(): Promise<void> {}
}

const creds = { host: "imap.example.com", port: 993, user: "me@example.com", pass: "secret" };

function imapServer(handler: (tag: string, cmd: string, args: string) => string | null) {
  return (line: string): string | null => {
    const m = /^(\S+)\s+(\S+)\s*(.*)$/.exec(line);
    if (!m) return null;
    return handler(m[1], m[2].toUpperCase(), m[3]);
  };
}

describe("IMAP over a raw socket", () => {
  beforeEach(() => setMailSocket(null));

  it("logs in, lists mailboxes and decodes a modified-UTF-7 folder name", async () => {
    const sock = new ScriptedSocket(
      "* OK ready" + CRLF,
      imapServer((tag, cmd) => {
        if (cmd === "LOGIN") return `${tag} OK logged in${CRLF}`;
        if (cmd === "LIST")
          return (
            `* LIST (\\HasNoChildren) "/" "INBOX"${CRLF}` +
            `* LIST (\\HasNoChildren) "/" "Entw&APw-rfe"${CRLF}` +
            `* LIST (\\Noselect \\HasChildren) "/" "Archiv"${CRLF}` +
            `${tag} OK done${CRLF}`
          );
        if (cmd === "LOGOUT") return `${tag} OK bye${CRLF}`;
        return `${tag} OK${CRLF}`;
      }),
    );
    setMailSocket(sock);

    const conn = await ImapConnection.connect(creds);
    const boxes = await conn.listMailboxes();

    expect(sock.opened).toEqual({ host: "imap.example.com", port: 993, tls: true });
    expect(boxes.map((b) => b.name)).toEqual(["INBOX", "Entwürfe"]); // \Noselect dropped
    expect(boxes[0].delimiter).toBe("/");
    // The password must not appear anywhere but the LOGIN command itself.
    expect(sock.written.filter((w) => w.includes("secret"))).toHaveLength(1);
  });

  it("reads a message list through a counted literal", async () => {
    const header = `Subject: Angebot${CRLF}From: Ada <ada@example.com>${CRLF}Date: Wed, 01 Jul 2026 10:00:00 +0000${CRLF}${CRLF}`;
    const sock = new ScriptedSocket(
      "* OK ready" + CRLF,
      imapServer((tag, cmd, args) => {
        if (cmd === "LOGIN") return `${tag} OK ok${CRLF}`;
        if (cmd === "EXAMINE") return `* 2 EXISTS${CRLF}* OK [UIDVALIDITY 42] .${CRLF}${tag} OK done${CRLF}`;
        if (cmd === "UID" && args.toUpperCase().startsWith("SEARCH UNSEEN")) return `* SEARCH 7${CRLF}${tag} OK done${CRLF}`;
        if (cmd === "UID" && args.toUpperCase().startsWith("SEARCH")) return `* SEARCH 5 7${CRLF}${tag} OK done${CRLF}`;
        if (cmd === "UID" && args.toUpperCase().startsWith("FETCH"))
          return (
            `* 2 FETCH (UID 7 FLAGS (\\Seen) BODY[HEADER.FIELDS (SUBJECT FROM DATE)] {${header.length}}${CRLF}` +
            header +
            `)${CRLF}${tag} OK done${CRLF}`
          );
        return `${tag} OK${CRLF}`;
      }),
    );
    setMailSocket(sock);

    const conn = await ImapConnection.connect(creds);
    const page = await pageEnvelopes(conn, "INBOX", 0, 30);

    expect(page.total).toBe(2);
    expect(page.unseen).toBe(1);
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({ uid: 7, subject: "Angebot", seen: true, flagged: false });
    expect(page.messages[0].from).toContain("ada@example.com");
    expect(page.messages[0].dateTs).toBeGreaterThan(0);
  });

  it("takes the list preview from the SECOND literal of the same FETCH (B3)", async () => {
    // Two body sections mean two counted literals per FETCH line. The answer
    // below deliberately puts BODY[TEXT] FIRST: nothing obliges a server to
    // reply in the order we asked, so the parser must classify by section name,
    // not by position.
    const header = `Subject: Angebot${CRLF}From: Ada <ada@example.com>${CRLF}Date: Wed, 01 Jul 2026 10:00:00 +0000${CRLF}${CRLF}`;
    const text = `Content-Type: text/plain; charset=utf-8${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}Hallo Marco, hier ist das Angebot f=C3=BCr n=C3=A4chste Woche.${CRLF}`;
    let fetched = "";
    const sock = new ScriptedSocket(
      "* OK ready" + CRLF,
      imapServer((tag, cmd, args) => {
        if (cmd === "LOGIN") return `${tag} OK ok${CRLF}`;
        if (cmd === "EXAMINE") return `* 1 EXISTS${CRLF}* OK [UIDVALIDITY 42] .${CRLF}${tag} OK done${CRLF}`;
        if (cmd === "UID" && args.toUpperCase().startsWith("SEARCH UNSEEN")) return `* SEARCH${CRLF}${tag} OK done${CRLF}`;
        if (cmd === "UID" && args.toUpperCase().startsWith("SEARCH")) return `* SEARCH 9${CRLF}${tag} OK done${CRLF}`;
        if (cmd === "UID" && args.toUpperCase().startsWith("FETCH")) {
          fetched = args;
          return (
            `* 1 FETCH (UID 9 FLAGS () BODY[TEXT]<0> {${text.length}}${CRLF}` +
            text +
            ` BODY[HEADER.FIELDS (SUBJECT FROM DATE)] {${header.length}}${CRLF}` +
            header +
            `)${CRLF}${tag} OK done${CRLF}`
          );
        }
        return `${tag} OK${CRLF}`;
      }),
    );
    setMailSocket(sock);

    const conn = await ImapConnection.connect(creds);
    const page = await pageEnvelopes(conn, "INBOX", 0, 30);

    // One request, both sections — the preview must never cost a second trip.
    expect(fetched).toMatch(/BODY\.PEEK\[HEADER\.FIELDS/i);
    expect(fetched).toMatch(/BODY\.PEEK\[TEXT\]<0\.\d+>/i);
    expect(page.messages[0].subject).toBe("Angebot");
    expect(page.messages[0].preview).toBe("Hallo Marco, hier ist das Angebot für nächste Woche.");
  });

  it("upgrades a plaintext port with STARTTLS before sending the password", async () => {
    const sock = new ScriptedSocket(
      "* OK ready" + CRLF,
      imapServer((tag, cmd) => {
        if (cmd === "STARTTLS") return `${tag} OK begin TLS${CRLF}`;
        if (cmd === "LOGIN") return `${tag} OK ok${CRLF}`;
        return `${tag} OK${CRLF}`;
      }),
    );
    setMailSocket(sock);

    await ImapConnection.connect({ ...creds, port: 143 });

    expect(sock.opened?.tls).toBe(false);
    expect(sock.tlsUpgrades).toBe(1);
    // Order matters: the upgrade happens BEFORE the credentials go out.
    const starttlsAt = sock.written.findIndex((w) => w.includes("STARTTLS"));
    const loginAt = sock.written.findIndex((w) => w.includes("LOGIN"));
    expect(starttlsAt).toBeGreaterThanOrEqual(0);
    expect(loginAt).toBeGreaterThan(starttlsAt);
  });

  it("refuses to continue when a plaintext server offers no STARTTLS", async () => {
    const sock = new ScriptedSocket(
      "* OK ready" + CRLF,
      imapServer((tag, cmd) => (cmd === "STARTTLS" ? `${tag} NO not supported${CRLF}` : `${tag} OK${CRLF}`)),
    );
    setMailSocket(sock);

    await expect(ImapConnection.connect({ ...creds, port: 143 })).rejects.toThrow(/STARTTLS/i);
    expect(sock.written.some((w) => w.includes("secret"))).toBe(false);
  });

  it("encodes non-ASCII mailbox names the way IMAP expects", () => {
    expect(encodeImapUtf7("INBOX")).toBe("INBOX");
    expect(encodeImapUtf7("Entwürfe")).toBe("Entw&APw-rfe");
    expect(encodeImapUtf7("A&B")).toBe("A&-B");
  });
});

describe("MIME", () => {
  it("decodes a quoted-printable multipart message with an attachment", () => {
    const raw = [
      "Subject: =?utf-8?B?R3LDvMOfZQ==?=",
      "From: Ada <ada@example.com>",
      'Content-Type: multipart/mixed; boundary="bnd"',
      "",
      "--bnd",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Hallo=20Welt=21",
      "--bnd",
      'Content-Type: application/pdf; name="rechnung.pdf"',
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="rechnung.pdf"',
      "",
      "SGVsbG8=",
      "--bnd--",
    ].join("\r\n");

    const parsed = parseMessage(raw);

    expect(parsed.headers.get("from")).toContain("ada@example.com");
    expect(parsed.text).toBe("Hallo Welt!");
    expect(parsed.attachments).toEqual([{ index: 2, name: "rechnung.pdf", mime: "application/pdf", size: 5 }]);
  });

  it("builds a sendable message and keeps Bcc out of the headers", () => {
    const mime = buildMimeMessage({
      from: "me@example.com",
      to: "you@example.com",
      bcc: "secret@example.com",
      subject: "Grüße",
      text: "Hallo",
      html: "<p>Hallo</p>",
      date: new Date(Date.UTC(2026, 6, 26, 9, 0, 0)),
    });

    expect(mime).toContain("To: you@example.com");
    expect(mime).toContain("Subject: =?utf-8?B?"); // non-ASCII subject encoded
    expect(mime).not.toContain("secret@example.com"); // Bcc is envelope-only
    expect(mime).toContain("multipart/alternative");
    expect(mime).toContain("text/html");
  });
});

describe("the socket transport", () => {
  /** Wires a scripted IMAP server and counts opened/closed sockets. */
  function scriptedTransport() {
    const counts = { opens: 0, closes: 0, noops: 0 };
    const scripted = new ScriptedSocket(
      "* OK ready" + CRLF,
      imapServer((tag, cmd) => {
        if (cmd === "NOOP") counts.noops += 1;
        return cmd === "LIST" ? `* LIST () "/" "INBOX"${CRLF}${tag} OK done${CRLF}` : `${tag} OK${CRLF}`;
      }),
    );
    setMailSocket({
      ...scripted,
      open: (o) => {
        counts.opens += 1;
        return scripted.open(o);
      },
      startTls: () => scripted.startTls(),
      write: (id, d) => scripted.write(id, d),
      read: () => scripted.read(),
      close: async () => {
        counts.closes += 1;
      },
    });
    return { transport: createSocketMailTransport(), counts };
  }

  // The contract CHANGED in findings round P7.3 (E4): a connection used to be
  // closed after every operation, which meant a full TCP+TLS+LOGIN per action —
  // four logins to open a folder and read three messages. It is now kept and
  // reused after a NOOP still answers. What must stay true is that it is never
  // reused blindly and never outlives its release.
  it("keeps the connection and reuses it after a NOOP", async () => {
    const { transport, counts } = scriptedTransport();
    await transport.checkLogin(creds);
    expect(counts.opens).toBe(1);
    expect(counts.closes).toBe(0); // held for the next operation

    await transport.checkLogin(creds);
    expect(counts.opens).toBe(1); // no second login
    expect(counts.noops).toBe(1); // …but probed before reuse

    await transport.releaseSessions?.();
    expect(counts.closes).toBe(1);
  });

  it("releases the connection when the account is released by name", async () => {
    // The phone releases by account on a switch and without a name when it goes
    // to the background — the OS suspends the sockets there. That the NEXT call
    // then opens a fresh one is pinned in the pool policy tests (a scripted
    // socket only ever plays one connection).
    const { transport, counts } = scriptedTransport();
    await transport.checkLogin(creds);
    await transport.releaseSessions?.(creds.user);
    expect(counts.closes).toBe(1);
  });
});

/**
 * The list preview is built from a TRUNCATED body prefix, so it meets every
 * shape a mail can start with. The contract is: readable words, or nothing —
 * MIME plumbing must never reach a reader's screen.
 */
describe("list preview from a truncated body prefix (B3)", () => {
  it("reads plain text and collapses its whitespace", () => {
    expect(previewFromBodyPrefix("Hallo Marco,\r\n\r\nwie besprochen …\r\n")).toBe("Hallo Marco, wie besprochen …");
  });

  it("decodes quoted-printable and walks into the first text part of a multipart", () => {
    const raw = [
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Gr=C3=BC=C3=9Fe aus M=C3=BCnchen",
      "--b1",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>ignored</p>",
    ].join("\r\n");
    expect(previewFromBodyPrefix(raw)).toBe("Grüße aus München");
  });

  it("strips tags when the first part is HTML", () => {
    const raw = ["Content-Type: text/html; charset=utf-8", "", "<div><b>Rechnung</b>&nbsp;Nr.&nbsp;7</div>"].join("\r\n");
    expect(previewFromBodyPrefix(raw)).toBe("Rechnung Nr. 7");
  });

  it("gives up rather than show plumbing or half-decoded base64", () => {
    // A truncated base64 part cannot be decoded safely.
    const b64 = ["Content-Type: text/plain", "Content-Transfer-Encoding: base64", "", "SGFsbG8gTWFyY28sIGRhcyBpc3Qg"].join("\r\n");
    expect(previewFromBodyPrefix(b64)).toBe("");
    // Truncated before any text — a boundary and nothing else.
    expect(previewFromBodyPrefix("--_000_boundary_\r\n")).toBe("");
    expect(previewFromBodyPrefix("   \r\n")).toBe("");
  });

  it("caps the length so a row never grows a second line", () => {
    const long = previewFromBodyPrefix("wort ".repeat(200), 40);
    expect(long.length).toBeLessThanOrEqual(41); // 40 + the ellipsis
    expect(long.endsWith("…")).toBe(true);
  });
});
