import { describe, expect, it, beforeEach } from "vitest";
import {
  ImapConnection,
  buildMimeMessage,
  decodeWords,
  createSocketMailTransport,
  encodeImapUtf7,
  pageEnvelopes,
  parseMessage,
  previewFromBodyPrefix,
  saveEmlFile,
  setMailSocket,
  releaseSocketSessions,
  type MailCaptureAdapter,
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

/** What the scripted server sends back: text, or the bytes themselves. */
type Reply = string | Uint8Array;

/**
 * A socket whose "server" is a list of canned replies, keyed by command. A
 * reply goes out as BYTES, like a server's: text as UTF-8, a `Uint8Array` as it
 * is — so a mail in any charset can be served. `chunk` cuts every reply into
 * reads of that many bytes, the way a network delivers them.
 */
class ScriptedSocket implements MailSocket {
  written: string[] = [];
  private queue: Buffer[] = [];
  private replies: (cmd: string) => Reply | null;
  tlsUpgrades = 0;
  opened: { host: string; port: number; tls: boolean } | null = null;

  constructor(greeting: string, replies: (cmd: string) => Reply | null, private readonly chunk = 0) {
    this.replies = replies;
    this.send(greeting);
  }

  private send(reply: Reply): void {
    const bytes = typeof reply === "string" ? Buffer.from(reply, "utf8") : Buffer.from(reply);
    if (this.chunk <= 0) this.queue.push(bytes);
    else for (let i = 0; i < bytes.length; i += this.chunk) this.queue.push(bytes.subarray(i, i + this.chunk));
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
      if (reply) this.send(reply);
    }
  }
  async read(): Promise<string> {
    const next = this.queue.shift();
    if (next === undefined) return "";
    return next.toString("base64");
  }
  async close(): Promise<void> {}
}

const creds = { host: "imap.example.com", port: 993, user: "me@example.com", pass: "secret" };

function bulkServer(options: { caps?: string; partial?: boolean; disconnect?: boolean; epoch?: number } = {}) {
  const state = new Map([[1, ""], [2, ""], [99, "\\Deleted"]]);
  const sock = new ScriptedSocket("* OK ready\r\n", imapServer((tag, command, args) => {
    const ok = `${tag} OK done\r\n`;
    if (command === "CAPABILITY") return `* CAPABILITY IMAP4rev1 ${options.caps ?? "MOVE UIDPLUS"}\r\n` + ok;
    if (command === "SELECT") return `* 3 EXISTS\r\n* OK [UIDVALIDITY ${options.epoch ?? 5}] epoch\r\n` + ok;
    if (command !== "UID") return ok;
    const [verb, set] = args.split(" ");
    const uids = set.split(",").map(Number);
    if (verb === "FETCH") return uids.filter(uid => state.has(uid)).map(uid => `* ${uid} FETCH (UID ${uid} FLAGS (${state.get(uid)}))\r\n`).join("") + ok;
    if (verb === "STORE") {
      for (const uid of uids) if (!options.partial || uid === 1) state.set(uid, args.includes("\\Deleted") ? "\\Deleted" : args.includes("+FLAGS") ? "\\Seen" : "");
      return options.partial ? `${tag} NO some messages refused\r\n` : ok;
    }
    if (verb === "MOVE" || verb === "EXPUNGE") {
      if (options.disconnect) throw new Error("connection lost after write");
      for (const uid of uids) if (!options.partial || uid === 1) state.delete(uid);
      return options.partial ? `${tag} NO partial move\r\n` : ok;
    }
    throw new Error(`Unexpected command ${command} ${args}`);
  }));
  setMailSocket(sock); return { sock, state };
}

describe("bounded IMAP writes against a scripted server", () => {
  it("sends one STORE and reports only independently confirmed flags", async () => {
    const { sock } = bulkServer({ partial: true });
    const conn = await ImapConnection.connect(creds);
    expect(await conn.bulkAction({ mailbox: "INBOX", uids: [1, 2, 3], uidValidity: 5, action: { kind: "seen", value: true } })).toEqual([
      { uid: 1, status: "done" }, { uid: 2, status: "failed", reason: "rejected" }, { uid: 3, status: "failed", reason: "missing" },
    ]);
    expect(sock.written.filter(line => line.includes("UID STORE"))).toEqual([expect.stringContaining("UID STORE 1,2 +FLAGS (\\Seen)")]);
  });
  it("never expunges an unrelated Deleted message", async () => {
    const { sock, state } = bulkServer(); const conn = await ImapConnection.connect(creds);
    expect(await conn.bulkAction({ mailbox: "Trash", uids: [1, 2], uidValidity: 5, action: { kind: "delete" } })).toEqual([{ uid: 1, status: "done" }, { uid: 2, status: "done" }]);
    expect(state.has(99)).toBe(true);
    expect(sock.written.some(line => /^a\d+ EXPUNGE/.test(line))).toBe(false);
  });
  it.each(["move", "delete"] as const)("refuses unsupported %s before mutating any flags", async kind => {
    const { sock, state } = bulkServer({ caps: "" }); const conn = await ImapConnection.connect(creds);
    const action = kind === "move" ? { kind, target: "Archive" } : { kind };
    expect(await conn.bulkAction({ mailbox: "INBOX", uids: [1], uidValidity: 5, action })).toEqual([{ uid: 1, status: "failed", reason: "unsupported" }]);
    expect(sock.written.some(line => /UID (STORE|MOVE|COPY|EXPUNGE)/.test(line))).toBe(false);
    expect(state.get(99)).toBe("\\Deleted");
  });
  it("keeps a partial MOVE uncertain and never tries COPY as a fallback", async () => {
    const { sock } = bulkServer({ partial: true }); const conn = await ImapConnection.connect(creds);
    const result = await conn.bulkAction({ mailbox: "INBOX", uids: [1, 2], uidValidity: 5, action: { kind: "move", target: "Archive" } });
    expect(result.every(r => r.status === "uncertain")).toBe(true);
    expect(sock.written.filter(line => line.includes("UID MOVE"))).toHaveLength(1);
    expect(sock.written.some(line => line.includes("UID COPY"))).toBe(false);
  });
  it("does not replay a MOVE after a lost connection", async () => {
    const { sock } = bulkServer({ disconnect: true }); const conn = await ImapConnection.connect(creds);
    expect(await conn.bulkAction({ mailbox: "INBOX", uids: [1], uidValidity: 5, action: { kind: "move", target: "Archive" } })).toEqual([{ uid: 1, status: "uncertain", reason: "connection" }]);
    expect(sock.written.filter(line => line.includes("UID MOVE"))).toHaveLength(1);
  });
  it("rejects reused UIDs from a different mailbox epoch", async () => {
    const { sock } = bulkServer({ epoch: 6 }); const conn = await ImapConnection.connect(creds);
    expect(await conn.bulkAction({ mailbox: "INBOX", uids: [1], uidValidity: 5, action: { kind: "delete" } })).toEqual([{ uid: 1, status: "failed", reason: "changed" }]);
    expect(sock.written.some(line => line.includes("UID STORE"))).toBe(false);
  });
  it("reuses one healthy authenticated session and releases it at sign-out", async () => {
    await releaseSocketSessions();
    const { sock } = bulkServer(); const transport = createSocketMailTransport();
    const args = { mailbox: "INBOX", uids: [1], uidValidity: 5, action: { kind: "seen" as const, value: true } };
    await transport.bulkAction!(creds, args); await transport.bulkAction!(creds, args);
    expect(sock.written.filter(line => / LOGIN /.test(line))).toHaveLength(1);
    await releaseSocketSessions(creds.user);
    expect(sock.written.filter(line => / LOGOUT/.test(line))).toHaveLength(1);
  });
});

function imapServer(handler: (tag: string, cmd: string, args: string) => Reply | null) {
  return (line: string): Reply | null => {
    const m = /^(\S+)\s+(\S+)\s*(.*)$/.exec(line);
    if (!m) return null;
    return handler(m[1], m[2].toUpperCase(), m[3]);
  };
}

describe("IMAP over a raw socket", () => {
  beforeEach(() => setMailSocket(null));

  it("quotes search terms once and refuses command terminators before SEARCH", async () => {
    await releaseSocketSessions();
    const searchSocket = () => new ScriptedSocket("* OK ready" + CRLF, imapServer((tag, cmd, args) => {
      if (cmd === "EXAMINE") return `* 0 EXISTS${CRLF}* OK [UIDVALIDITY 1] epoch${CRLF}${tag} OK${CRLF}`;
      if (cmd === "UID" && args.startsWith("SEARCH")) return `* SEARCH${CRLF}${tag} OK${CRLF}`;
      return `${tag} OK${CRLF}`;
    }));
    const sock = searchSocket();
    setMailSocket(sock);
    const transport = createSocketMailTransport();
    await transport.searchEnvelopes(creds, { mailbox: "INBOX", query: 'a\\"b', limit: 10 });
    expect(sock.written.find(line => line.includes("UID SEARCH"))).toContain('UID SEARCH TEXT "a\\\\\\"b"\r\n');
    for (const query of ["x\r\nA9 LOGOUT", "x\nUID STORE 1 +FLAGS (\\Deleted)", "x\0y"]) {
      // A failed operation discards its session. Each synthetic connection
      // therefore needs a fresh server greeting, just like a real socket.
      await releaseSocketSessions();
      const invalidSocket = searchSocket();
      setMailSocket(invalidSocket);
      await expect(transport.searchEnvelopes(creds, { mailbox: "INBOX", query, limit: 10 })).rejects.toThrow("Invalid IMAP argument");
      expect(invalidSocket.written.some(line => line.includes("UID SEARCH"))).toBe(false);
    }
    await releaseSocketSessions();
  });

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

  /**
   * P9.1: the thread headers ride along in the SAME header FETCH — asking for
   * them separately would undo the one-login work of P7.2/P7.3 message by
   * message. The socket path forwards the raw header text; the assertion below
   * is that it comes out as the same normalised ids the Rust path produces
   * (mail-parser hands those over WITHOUT brackets), because a mismatch would
   * silently split a conversation in half between the two platforms.
   */
  it("takes the thread headers along in the same FETCH (P9.1)", async () => {
    const header =
      `Subject: Re: Angebot${CRLF}From: Ada <ada@example.com>${CRLF}Date: Wed, 01 Jul 2026 10:00:00 +0000${CRLF}` +
      `Message-ID: <c@z.org>${CRLF}In-Reply-To: <b@y.org>${CRLF}References: <a@x.org>${CRLF}\t<b@y.org>${CRLF}${CRLF}`;
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
            `* 1 FETCH (UID 9 FLAGS () BODY[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID IN-REPLY-TO REFERENCES)] {${header.length}}${CRLF}` +
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

    // One request, all fields — asked for in the header section, not separately.
    expect(fetched).toMatch(/MESSAGE-ID IN-REPLY-TO REFERENCES/i);
    expect(fetched.match(/BODY\.PEEK\[HEADER/gi)).toHaveLength(1);
    // Raw header text out of the transport; mailClient normalises it. Here we
    // assert the raw shape, and threading.test.ts asserts both forms normalise
    // to the same ids.
    expect(page.messages[0].messageId).toBe("<c@z.org>");
    expect(page.messages[0].inReplyTo).toBe("<b@y.org>");
    // The folded References header must survive as one value, not two rows.
    expect(page.messages[0].references).toContain("<a@x.org>");
    expect(page.messages[0].references).toContain("<b@y.org>");
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
  it("roundtrips Unicode filenames, quoted parameters and exact attachment bytes", () => {
    for (const name of ['quote"; slash\\.pdf', 'Grüße-日本語-'.repeat(20) + '.pdf']) {
      const raw = buildMimeMessage({ from: "me@example.invalid", to: "you@example.invalid", cc: "cc@example.invalid", subject: "Grüße 日本語", text: "", html: "<p>Bild <img src=\"cid:pic\"></p>", attachments: [{ name, mime: "application/pdf", contentBase64: "AAECA//+" }] });
      const parsed = parseMessage(raw);
      expect(decodeWords(parsed.headers.get("subject")!)).toBe("Grüße 日本語");
      expect(parsed.html).toContain('src="cid:pic"');
      expect(parsed.attachments[0].name).toBe(name);
      expect([...parsed.parts.find(part => part.index === parsed.attachments[0].index)!.bytes!]).toEqual([0, 1, 2, 3, 255, 254]);
      expect(raw.split("\r\n").every(line => line.length < 998)).toBe(true);
    }
  });

  it("rejects header and attachment injections before creating a message", () => {
    const base = { from: "me@example.invalid", to: "you@example.invalid", subject: "Hi", text: "body\r\nBody lines are allowed" };
    for (const field of ["from", "to", "cc", "bcc", "subject"] as const) {
      for (const control of ["\r", "\n", "\0"]) expect(() => buildMimeMessage({ ...base, [field]: "safe" + control + "Bcc: hidden@example.invalid" })).toThrow("Invalid mail header");
    }
    expect(() => buildMimeMessage({ ...base, attachments: [{ name: "safe\r\nX-Evil: yes", mime: "text/plain", contentBase64: "" }] })).toThrow("Invalid attachment header");
    expect(() => buildMimeMessage({ ...base, attachments: [{ name: "safe", mime: "text/plain; boundary=x", contentBase64: "" }] })).toThrow("Invalid attachment header");
    for (const method of ["", "REQUEST; boundary=evil", 'REQUEST"']) expect(() => buildMimeMessage({ ...base, calendar: { ics: "", method } })).toThrow("Invalid calendar method");
  });

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

/**
 * A mail is bytes until one of its parts says what they mean (finding
 * 2026-10-09). The socket layer delivers bytes; the IMAP client above it used
 * to turn every literal into UTF-8 text at once, and the MIME parser after it
 * read characters as if they were bytes. That only works for ASCII — which is
 * all the tests above ever sent: quoted-printable and base64. A mail sent in
 * 8 bit, which is an ordinary mail, lost every umlaut; and the raw copy for
 * the `.eml` was a text, not the original.
 */
describe("8-bit mail over the socket (finding 2026-10-09)", () => {
  const utf8 = (text: string): Uint8Array => Buffer.from(text, "utf8");
  /** One byte per character: the way to write a Latin-1 mail, and any byte at all, in a test. */
  const latin1 = (text: string): Uint8Array => Buffer.from(text, "latin1");
  const join = (...parts: Uint8Array[]): Uint8Array => Buffer.concat(parts);
  const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

  const SENTENCE = "Grüße aus München.";
  const HEAD = `From: Anna Beispiel <anna@example.org>${CRLF}To: marco@example.org${CRLF}Date: Wed, 01 Jul 2026 10:00:00 +0000${CRLF}MIME-Version: 1.0${CRLF}`;
  const utf8Mail = utf8(`${HEAD}Subject: Reise${CRLF}Content-Type: text/plain; charset=utf-8${CRLF}Content-Transfer-Encoding: 8bit${CRLF}${CRLF}${SENTENCE}${CRLF}`);
  const latin1Mail = latin1(`${HEAD}Subject: Reise${CRLF}Content-Type: text/plain; charset=iso-8859-1${CRLF}Content-Transfer-Encoding: 8bit${CRLF}${CRLF}${SENTENCE}${CRLF}`);
  /** A file in 8 bit: Latin-1 words, and two bytes that are no character in UTF-8. */
  const FILE = latin1("Stra\xdfe;M\xfcnchen\r\nK\xf6ln;\x80\xff");
  /** A file sent unwrapped: every byte there is, a bare line feed and a bare carriage return among them. */
  const EVERY_BYTE = Uint8Array.from({ length: 256 }, (_unused, value) => value);
  const mixedMail = join(
    latin1(`${HEAD}Subject: Reise${CRLF}Content-Type: multipart/mixed; boundary="bnd"${CRLF}${CRLF}`),
    latin1(`--bnd${CRLF}Content-Type: text/plain; charset=iso-8859-1${CRLF}Content-Transfer-Encoding: 8bit${CRLF}${CRLF}${SENTENCE}${CRLF}`),
    utf8(`--bnd${CRLF}Content-Type: text/html; charset=utf-8${CRLF}Content-Transfer-Encoding: 8bit${CRLF}${CRLF}<p>${SENTENCE}</p>${CRLF}`),
    latin1(`--bnd${CRLF}Content-Type: application/octet-stream; name="orte.csv"${CRLF}Content-Transfer-Encoding: 8bit${CRLF}Content-Disposition: attachment; filename="orte.csv"${CRLF}${CRLF}`),
    FILE,
    latin1(`${CRLF}--bnd${CRLF}Content-Type: application/octet-stream; name="alle.bin"${CRLF}Content-Transfer-Encoding: binary${CRLF}Content-Disposition: attachment; filename="alle.bin"${CRLF}${CRLF}`),
    EVERY_BYTE,
    latin1(`${CRLF}--bnd--${CRLF}`),
  );
  /** Headers a sender wrote in raw 8 bit instead of encoded words — once as UTF-8 (RFC 6532), once as Latin-1. */
  const utf8Headers = utf8(`From: Jürgen Müller <jm@example.org>${CRLF}Subject: Voilà${CRLF}Date: Wed, 01 Jul 2026 10:00:00 +0000${CRLF}Content-Type: text/plain; charset=utf-8${CRLF}Content-Transfer-Encoding: 8bit${CRLF}${CRLF}Schöne Grüße aus Köln.${CRLF}`);
  const latin1Headers = latin1(`From: Jürgen Müller <jm@example.org>${CRLF}Subject: Grüße aus Köln${CRLF}Date: Wed, 01 Jul 2026 10:00:00 +0000${CRLF}Content-Type: text/plain; charset=iso-8859-1${CRLF}Content-Transfer-Encoding: 8bit${CRLF}${CRLF}Schöne Grüße aus Köln.${CRLF}`);

  /**
   * A mailbox of raw messages, answered the way a server answers: a message is
   * a counted literal, and the count is in BYTES. The message list gets the
   * header block and the first bytes of the body, two literals on one line.
   */
  function mailboxServer(messages: Record<number, Uint8Array>, chunk = 0): ScriptedSocket {
    const sock = new ScriptedSocket(
      "* OK ready" + CRLF,
      imapServer((tag, cmd, args) => {
        const ok = `${tag} OK done${CRLF}`;
        if (cmd === "EXAMINE") return `* ${Object.keys(messages).length} EXISTS${CRLF}* OK [UIDVALIDITY 42] .${CRLF}${ok}`;
        if (cmd !== "UID") return ok;
        if (/^SEARCH UNSEEN/i.test(args)) return `* SEARCH${CRLF}${ok}`;
        if (/^SEARCH/i.test(args)) return `* SEARCH ${Object.keys(messages).join(" ")}${CRLF}${ok}`;
        const fetch = /^FETCH ([\d,]+) \((.*)\)$/i.exec(args);
        if (!fetch) return `${tag} BAD unexpected ${args}${CRLF}`;
        const replies = fetch[1].split(",").map(Number).filter((uid) => messages[uid]).map((uid, i) => {
          const raw = messages[uid];
          if (/BODY\.PEEK\[\]/i.test(fetch[2])) return join(latin1(`* ${i + 1} FETCH (UID ${uid} BODY[] {${raw.length}}${CRLF}`), raw, latin1(`)${CRLF}`));
          const bodyAt = Buffer.from(raw).indexOf(CRLF + CRLF) + 4;
          const header = raw.subarray(0, bodyAt);
          const text = raw.subarray(bodyAt, bodyAt + 1024);
          return join(
            latin1(`* ${i + 1} FETCH (UID ${uid} FLAGS () BODY[HEADER.FIELDS (SUBJECT FROM DATE)] {${header.length}}${CRLF}`),
            header,
            latin1(` BODY[TEXT]<0> {${text.length}}${CRLF}`),
            text,
            latin1(`)${CRLF}`),
          );
        });
        return join(...replies, latin1(ok));
      }),
      chunk,
    );
    setMailSocket(sock);
    return sock;
  }

  function vaultFiles() {
    const files = new Map<string, string | Uint8Array>();
    const adapter: MailCaptureAdapter = {
      readTextFile: async (path) => String(files.get(path) ?? ""),
      writeTextFile: async (path, content) => {
        files.set(path, content);
      },
      writeBinaryFile: async (path, data) => {
        files.set(path, data);
      },
      exists: async (path) => files.has(path),
      createDir: async () => {},
    };
    return { adapter, files };
  }

  const inbox = { mailbox: "INBOX", uid: 7 };

  // A pooled session belongs to the scripted server it was opened against.
  beforeEach(() => releaseSocketSessions());

  it("the fixtures are what they claim: one mail is UTF-8, the other is not", () => {
    const strict = new TextDecoder("utf-8", { fatal: true });
    expect(strict.decode(utf8Mail)).toContain(SENTENCE);
    expect(() => strict.decode(latin1Mail)).toThrow();
    expect(() => strict.decode(FILE)).toThrow();
  });

  it("reads a UTF-8 body sent in 8 bit as it was written", async () => {
    mailboxServer({ 7: utf8Mail });
    const message = await createSocketMailTransport().fetchMessage(creds, inbox);
    expect(message.text).toBe(SENTENCE + CRLF);
    expect(message.subject).toBe("Reise");
  });

  it("reads an ISO-8859-1 body sent in 8 bit as it was written", async () => {
    mailboxServer({ 7: latin1Mail });
    const message = await createSocketMailTransport().fetchMessage(creds, inbox);
    expect(message.text).toBe(SENTENCE + CRLF);
  });

  it("reads a message that arrives in small pieces, cut inside a character", async () => {
    // Five bytes a read: "ü" (two bytes in UTF-8) is split across two reads.
    mailboxServer({ 7: utf8Mail }, 5);
    const message = await createSocketMailTransport().fetchMessage(creds, inbox);
    expect(message.text).toBe(SENTENCE + CRLF);
  });

  it("reads each part of a multipart message by its own charset, and an unwrapped file byte for byte", async () => {
    mailboxServer({ 7: mixedMail });
    const transport = createSocketMailTransport();
    const message = await transport.fetchMessage(creds, inbox);
    expect(message.text).toBe(SENTENCE);
    expect(message.html).toBe(`<p>${SENTENCE}</p>`);
    expect(message.attachments).toEqual([
      { index: 3, name: "orte.csv", mime: "application/octet-stream", size: FILE.length },
      { index: 4, name: "alle.bin", mime: "application/octet-stream", size: 256 },
    ]);

    const file = await transport.fetchAttachment(creds, { ...inbox, index: 3 });
    expect(sameBytes(Buffer.from(file, "base64"), FILE)).toBe(true);
    // The line breaks inside a file are the file's: none is added, none is rewritten.
    const every = await transport.fetchAttachment(creds, { ...inbox, index: 4 });
    expect(sameBytes(Buffer.from(every, "base64"), EVERY_BYTE)).toBe(true);
  });

  it("spells a header written in raw 8 bit alike in the list and in the opened message", async () => {
    mailboxServer({ 7: utf8Headers });
    const transport = createSocketMailTransport();
    const [row] = (await transport.listEnvelopes(creds, { mailbox: "INBOX", offset: 0, limit: 30 })).messages;
    const message = await transport.fetchMessage(creds, inbox);
    // Raw UTF-8 (RFC 6532), and a value that ends in the byte 0xA0 — which a
    // trim on the bytes would take for a blank.
    expect(row.subject).toBe("Voilà");
    expect(message.subject).toBe("Voilà");
    expect(row.from).toBe("Jürgen Müller <jm@example.org>");
    expect(message.from).toBe("Jürgen Müller <jm@example.org>");
    expect(message.text).toBe("Schöne Grüße aus Köln." + CRLF);

    // Raw Latin-1 in a header is nobody's rule. It is read as UTF-8 like every
    // header, here and by the desktop's parser: marks instead of the umlauts,
    // the same marks in the list and above the message — and the body, whose
    // charset the message names, is read right in both places.
    await releaseSocketSessions();
    mailboxServer({ 7: latin1Headers });
    const [latinRow] = (await transport.listEnvelopes(creds, { mailbox: "INBOX", offset: 0, limit: 30 })).messages;
    const latinMessage = await transport.fetchMessage(creds, inbox);
    const mark = String.fromCharCode(0xfffd);
    expect(latinRow.subject).toBe(`Gr${mark}${mark}e aus K${mark}ln`);
    expect(latinMessage.subject).toBe(latinRow.subject);
    expect(latinMessage.from).toBe(latinRow.from);
    expect(latinMessage.text).toBe("Schöne Grüße aus Köln." + CRLF);
    expect(latinRow.preview).toBe("Schöne Grüße aus Köln.");
  });

  it("builds the opening line of the list by what the message says its body is", async () => {
    // A body of one part does not say what its bytes are; the message's header
    // does. The list took the first bytes as UTF-8 text whatever they were: a
    // quoted-printable mail showed `Gr=C3=BC=C3=9Fe`, a Latin-1 one marks.
    const quotedPrintable = latin1(`${HEAD}Subject: Reise${CRLF}Content-Type: text/plain; charset=utf-8${CRLF}Content-Transfer-Encoding: quoted-printable${CRLF}${CRLF}Gr=C3=BC=C3=9Fe aus M=C3=BCnchen.${CRLF}`);
    const base64 = latin1(`${HEAD}Subject: Reise${CRLF}Content-Type: text/plain; charset=utf-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${Buffer.from(SENTENCE, "utf8").toString("base64")}${CRLF}`);
    const sock = mailboxServer({ 4: base64, 5: quotedPrintable, 6: latin1Mail, 7: utf8Mail });
    const rows = (await createSocketMailTransport().listEnvelopes(creds, { mailbox: "INBOX", offset: 0, limit: 30 })).messages;
    expect(rows.map((row) => [row.uid, row.preview])).toEqual([
      [7, SENTENCE],
      [6, SENTENCE],
      [5, SENTENCE],
      // A cut-off base64 body is not decoded: no line rather than a wrong one.
      [4, ""],
    ]);
    // One request for the list, as before: the two header fields ride along in it.
    const fetches = sock.written.filter((line) => line.includes("UID FETCH"));
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toContain("REFERENCES CONTENT-TYPE CONTENT-TRANSFER-ENCODING)]");
  });

  it("takes a line for a boundary only when it is one", async () => {
    // "--bnd" followed by the byte 0xA0 is a line of the text, not a delimiter
    // with padding behind it; blanks and tabs behind a delimiter are padding.
    const mail = latin1(
      `${HEAD}Subject: Reise${CRLF}Content-Type: multipart/mixed; boundary="bnd"${CRLF}${CRLF}` +
        `--bnd \t${CRLF}Content-Type: text/plain; charset=iso-8859-1${CRLF}Content-Transfer-Encoding: 8bit${CRLF}${CRLF}eins${CRLF}--bnd\xa0${CRLF}zwei${CRLF}` +
        `--bnd--${CRLF}`,
    );
    mailboxServer({ 7: mail });
    const message = await createSocketMailTransport().fetchMessage(creds, inbox);
    expect(message.text).toBe(["eins", "--bnd" + String.fromCharCode(0xa0), "zwei"].join(CRLF));
  });

  it("hands the raw message on as base64 of its bytes, and the .eml is the original", async () => {
    // A mail no text decoder leaves alone: UTF-8, a lone Latin-1 byte, a NUL and a bare line feed.
    const undecodable = latin1("Subject: Gr\xc3\xbc\xc3\x9fe\r\n\r\nM\xfcnchen \x00 \xff\n");
    for (const original of [utf8Mail, latin1Mail, mixedMail, undecodable]) {
      await releaseSocketSessions();
      mailboxServer({ 7: original });
      const raw = await createSocketMailTransport().fetchRaw(creds, inbox);

      const { adapter, files } = vaultFiles();
      const path = await saveEmlFile(adapter, { subject: "Reise", dateTs: Date.UTC(2026, 6, 1, 12) }, raw, "Mail");
      expect(sameBytes(files.get(path) as Uint8Array, original)).toBe(true);
      expect(raw).toBe(Buffer.from(original).toString("base64"));
    }
  });

  it("builds the list preview from bytes: the part's charset, the message's own, a cut inside a character or an escape", () => {
    const part = latin1(`--b1${CRLF}Content-Type: text/plain; charset=iso-8859-1${CRLF}Content-Transfer-Encoding: 8bit${CRLF}${CRLF}Sch\xf6ne Gr\xfc\xdfe${CRLF}--b1${CRLF}`);
    expect(previewFromBodyPrefix(part)).toBe("Schöne Grüße");
    // A body of one part: what its bytes are stands in the message's own header.
    const latin = new Map([["content-type", "text/plain; charset=iso-8859-1"]]);
    expect(previewFromBodyPrefix(latin1("Sch\xf6ne Gr\xfc\xdfe aus K\xf6ln"), undefined, latin)).toBe("Schöne Grüße aus Köln");
    expect(previewFromBodyPrefix(utf8("Schöne Grüße aus Köln"))).toBe("Schöne Grüße aus Köln");
    // No header names a charset: UTF-8, as in the opened message and as the
    // desktop's parser reads it. A Latin-1 byte is a mark there, and here.
    expect(previewFromBodyPrefix(latin1("K\xf6ln liegt am Rhein"))).toBe(`K${String.fromCharCode(0xfffd)}ln liegt am Rhein`);
    // The prefix is cut after n bytes, and the cut fell inside "ü": no stray mark at the end.
    const cut = utf8("Grüße aus Mü");
    expect(previewFromBodyPrefix(cut.subarray(0, cut.length - 1))).toBe("Grüße aus M");
    // Cut inside a quoted-printable escape, with half a character in front of it.
    const quoted = new Map([
      ["content-type", "text/plain; charset=utf-8"],
      ["content-transfer-encoding", "quoted-printable"],
    ]);
    expect(previewFromBodyPrefix("Gr=C3=BC=C3=9Fe aus M=C3=B", undefined, quoted)).toBe("Grüße aus M");
    expect(previewFromBodyPrefix("Gr=C3=BC=C3=9Fe aus M=C3=", undefined, quoted)).toBe("Grüße aus M");
    expect(previewFromBodyPrefix("Gr=C3=BC=C3=9Fe aus M=", undefined, quoted)).toBe("Grüße aus M");
  });

  it("reads a message handed over as text like the same message on the wire", () => {
    const asText = parseMessage(`Subject: Reise${CRLF}Content-Type: text/plain; charset=utf-8${CRLF}Content-Transfer-Encoding: 8bit${CRLF}${CRLF}${SENTENCE}`);
    expect(asText.text).toBe(SENTENCE);
    expect(parseMessage(utf8Mail).text).toBe(SENTENCE + CRLF);
    // No charset named: the bytes are read as UTF-8, as they were before and as
    // the desktop's parser reads them. Nothing is guessed in one shell only.
    expect(parseMessage(utf8(`Subject: Reise${CRLF}${CRLF}${SENTENCE}`)).text).toBe(SENTENCE);
    expect(parseMessage(latin1(`Subject: Reise${CRLF}${CRLF}K\xf6ln`)).text).toBe(`K${String.fromCharCode(0xfffd)}ln`);
  });
});
