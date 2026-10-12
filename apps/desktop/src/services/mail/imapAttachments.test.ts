import { beforeEach, describe, expect, it } from "vitest";
import {
  MAIL_MAILBOX_CHANGED,
  createSocketMailTransport,
  forwardSource,
  parseMessage,
  releaseSocketSessions,
  setMailSocket,
  type MailSocket,
} from "@plainva/ui/mail";

/**
 * All of a message's files in ONE fetch, on the phone's IMAP client (plan
 * "Weiterleiten nimmt die Anhänge mit", A3).
 *
 * Asked file by file, every attachment cost the whole message again. Driven
 * against a scripted server, like the client's own tests: what is held here is
 * the number of fetches, the bytes of each file, and that a renumbered mailbox
 * is refused before anything is fetched.
 */

const CRLF = "\r\n";

/** A socket whose "server" is a list of canned replies, keyed by command. A
 *  reply is BYTES: a message on the wire is not text until a part says so. */
class ScriptedSocket implements MailSocket {
  written: string[] = [];
  private queue: Buffer[] = [];
  constructor(greeting: string, private readonly replies: (line: string) => Buffer | null) {
    this.queue.push(Buffer.from(greeting, "latin1"));
  }
  async open(): Promise<string> {
    return "s1";
  }
  async startTls(): Promise<void> {}
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
    return next === undefined ? "" : next.toString("base64");
  }
  async close(): Promise<void> {}
}

const wire = (text: string) => Buffer.from(text, "latin1");

const creds = { host: "imap.example.com", port: 993, user: "me@example.com", pass: "secret" };

/** Three files after the text: a PDF in base64, a text file in
 *  quoted-printable, and a picture — each with bytes of its own. */
const RAW = [
  "Subject: Unterlagen",
  "From: Ada <ada@example.com>",
  'Content-Type: multipart/mixed; boundary="bnd"',
  "",
  "--bnd",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Siehe Anhang.",
  "--bnd",
  'Content-Type: application/pdf; name="a.pdf"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="a.pdf"',
  "",
  "JVBERi0=",
  "--bnd",
  'Content-Type: text/csv; charset=iso-8859-1; name="liste.csv"',
  "Content-Transfer-Encoding: quoted-printable",
  'Content-Disposition: attachment; filename="liste.csv"',
  "",
  "Gr=F6=DFe;M=FCller",
  "--bnd",
  'Content-Type: image/png; name="b.png"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="b.png"',
  "",
  "AAECA//+",
  "--bnd--",
].join(CRLF);

/** The Latin-1 text of the list, as bytes: "Größe;Müller". */
const LATIN1_LIST = [0x47, 0x72, 0xf6, 0xdf, 0x65, 0x3b, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72];

/** A message whose file travels UNPACKED: 8 bit, in Latin-1 — bytes that are
 *  no valid UTF-8. A client that reads a message as text hands them out as
 *  something else (finding 2026-10-09, the phone's socket transport). */
const EIGHT_BIT = Buffer.concat([
  wire(
    [
      "Subject: Liste",
      "From: Ada <ada@example.com>",
      'Content-Type: multipart/mixed; boundary="bnd"',
      "",
      "--bnd",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Siehe Anhang.",
      "--bnd",
      'Content-Type: text/csv; charset=iso-8859-1; name="liste.csv"',
      "Content-Transfer-Encoding: 8bit",
      'Content-Disposition: attachment; filename="liste.csv"',
      "",
      "",
    ].join(CRLF),
  ),
  Buffer.from(LATIN1_LIST),
  wire(`${CRLF}--bnd--`),
]);

/** A server holding one message under UID 7, in a mailbox of the given epoch. */
function server(epoch = 42, raw: Buffer = wire(RAW)) {
  const counts = { fetches: 0, examines: 0 };
  const socket = new ScriptedSocket("* OK ready" + CRLF, (line) => {
    const m = /^(\S+)\s+(\S+)\s*(.*)$/.exec(line);
    if (!m) return null;
    const [, tag, cmd, args] = m;
    if (cmd.toUpperCase() === "EXAMINE") {
      counts.examines += 1;
      return wire(`* 1 EXISTS${CRLF}* OK [UIDVALIDITY ${epoch}] .${CRLF}${tag} OK done${CRLF}`);
    }
    if (cmd.toUpperCase() === "UID" && /^FETCH 7 \(BODY\.PEEK\[\]\)/i.test(args)) {
      counts.fetches += 1;
      // The literal's size is its length in BYTES.
      return Buffer.concat([wire(`* 1 FETCH (UID 7 BODY[] {${raw.length}}${CRLF}`), raw, wire(`)${CRLF}${tag} OK done${CRLF}`)]);
    }
    return wire(`${tag} OK${CRLF}`);
  });
  setMailSocket(socket);
  return { transport: createSocketMailTransport(), counts, socket };
}

const bytesOf = (base64: string) => Array.from(Buffer.from(base64, "base64"));

describe("the files of one message over the phone's IMAP client", () => {
  beforeEach(async () => {
    await releaseSocketSessions();
    setMailSocket(null);
  });

  it("lists the files under the index the batch is asked with", () => {
    // The reader's list and the batch read the same parse: what one calls a
    // file under an index, the other hands out under it.
    expect(parseMessage(RAW).attachments).toEqual([
      { index: 2, name: "a.pdf", mime: "application/pdf", size: 5 },
      { index: 3, name: "liste.csv", mime: "text/csv", size: 12 },
      { index: 4, name: "b.png", mime: "image/png", size: 6 },
    ]);
  });

  it("hands out all of them from one fetch of the message", async () => {
    const { transport, counts } = server();
    const found = await transport.fetchAttachments!(creds, { mailbox: "INBOX", uid: 7, indexes: [2, 3, 4], uidValidity: 42 });
    expect(counts.fetches).toBe(1);
    expect(found.map((f) => f.index)).toEqual([2, 3, 4]);
    expect(Buffer.from(found[0].contentBase64, "base64").toString("latin1")).toBe("%PDF-");
    // The text file keeps the bytes it was written in — Latin-1, not UTF-8.
    expect(bytesOf(found[1].contentBase64)).toEqual(LATIN1_LIST);
    expect(bytesOf(found[2].contentBase64)).toEqual([0, 1, 2, 3, 255, 254]);
  });

  it("hands out a file that travels unpacked byte for byte", async () => {
    // 8 bit on the wire: nothing between the server and the file may read
    // these bytes as text. A forward that changed them would send, in the
    // forwarder's name, a file the original never carried.
    const { transport, counts } = server(42, EIGHT_BIT);
    const found = await transport.fetchAttachments!(creds, { mailbox: "INBOX", uid: 7, indexes: [2], uidValidity: 42 });
    expect(counts.fetches).toBe(1);
    expect(found.map((f) => f.index)).toEqual([2]);
    expect(bytesOf(found[0].contentBase64)).toEqual(LATIN1_LIST);
  });

  it("answers in the order asked, each file once, and leaves out what the message does not have", async () => {
    const { transport, counts } = server();
    // Index 1 is the text of the message — a part, not a file; 9 does not exist.
    const found = await transport.fetchAttachments!(creds, { mailbox: "INBOX", uid: 7, indexes: [4, 9, 2, 4, 1] });
    expect(found.map((f) => f.index)).toEqual([4, 2]);
    expect(counts.fetches).toBe(1);
  });

  it("refuses a renumbered mailbox before the message is fetched", async () => {
    const { transport, counts } = server(43);
    await expect(transport.fetchAttachments!(creds, { mailbox: "INBOX", uid: 7, indexes: [2], uidValidity: 42 })).rejects.toThrow(MAIL_MAILBOX_CHANGED);
    // The UID names another message there: its bytes are never asked for.
    expect(counts.examines).toBe(1);
    expect(counts.fetches).toBe(0);
  });

  it("reads a message with the epoch of its mailbox, so a forward made from it is refused once the mailbox was renumbered", async () => {
    // The whole chain, as the phone walks it: the reader fetches the message,
    // the forward names it, the composer asks for its files. Until 2026-10 the
    // message this client handed out carried no epoch — the reference had none
    // either, and the check below could never say no: after a renumbering the
    // same UID fetched ANOTHER message's files, and they were attached.
    const read = server(42);
    const message = await read.transport.fetchMessage(creds, { mailbox: "INBOX", uid: 7 });
    expect(message.uidValidity).toBe(42);
    const source = forwardSource("a1", "INBOX", { ...message, id: String(message.uid) })!;
    expect(source.uidValidity).toBe(42);
    expect(source.files.map((f) => f.index)).toEqual([2, 3, 4]);

    // The mailbox is renumbered; UID 7 is somebody else's message now.
    await releaseSocketSessions();
    const renumbered = server(43);
    await expect(
      renumbered.transport.fetchAttachments!(creds, {
        mailbox: source.mailbox,
        uid: Number(source.messageId),
        indexes: source.files.map((f) => f.index),
        uidValidity: source.uidValidity,
      }),
    ).rejects.toThrow(MAIL_MAILBOX_CHANGED);
    expect(renumbered.counts.fetches).toBe(0);
  });

  it("asks without an epoch when the caller has none", async () => {
    // A message from an older cache row carries no epoch; the batch then reads
    // what the UID names, as the single fetch always did.
    const { transport } = server(43);
    const found = await transport.fetchAttachments!(creds, { mailbox: "INBOX", uid: 7, indexes: [2] });
    expect(found).toHaveLength(1);
  });

  it("hands a single file out as the same bytes", async () => {
    const { transport, counts } = server();
    const one = await transport.fetchAttachment(creds, { mailbox: "INBOX", uid: 7, index: 3 });
    const [inBatch] = await transport.fetchAttachments!(creds, { mailbox: "INBOX", uid: 7, indexes: [3] });
    expect(one).toBe(inBatch.contentBase64);
    expect(counts.fetches).toBe(2);
    await expect(transport.fetchAttachment(creds, { mailbox: "INBOX", uid: 7, index: 9 })).rejects.toThrow("attachment not found");
  });
});
