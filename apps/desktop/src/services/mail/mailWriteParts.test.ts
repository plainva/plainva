import { afterEach, describe, expect, it } from "vitest";
import { ImapConnection, setMailSocket, type MailSocket } from "@plainva/ui/mail";
import { smtpSend } from "../../../../../packages/ui/src/mail/net/smtp";
import { MAIL_WRITE_PART_BYTES } from "../../../../../packages/ui/src/mail/net/socket";

/**
 * A message goes to the mail server in parts (release list F54, the class of
 * F51): every socket write is one call over the phone's bridge, parsed on
 * Android's UI thread, and a forward with 18 MB of attachments was one
 * 33 MB string there.
 */
class Server implements MailSocket {
  /** Bytes of every write, before base64. */
  sizes: number[] = [];
  received = "";
  private pending = "";
  private queue: string[];
  private inData = false;
  constructor(greeting: string, private readonly reply: (line: string) => string | null) { this.queue = [greeting]; }
  async open() { return "socket"; }
  async startTls() {}
  async write(_id: string, data: string) {
    const bytes = Buffer.from(data, "base64");
    this.sizes.push(bytes.length);
    const text = bytes.toString("latin1");
    this.received += text;
    this.pending += text;
    // Answer per command line, and the message once its end mark is in - however the writes were cut.
    for (;;) {
      if (this.inData) {
        const end = this.pending.indexOf("\r\n.\r\n");
        if (end < 0) return;
        this.pending = this.pending.slice(end + 5);
        this.inData = false;
        this.queue.push("250 queued\r\n");
        continue;
      }
      const nl = this.pending.indexOf("\r\n");
      if (nl < 0) return;
      const line = this.pending.slice(0, nl + 2);
      this.pending = this.pending.slice(nl + 2);
      if (line === "DATA\r\n") this.inData = true;
      const answer = this.reply(line);
      if (answer !== null) this.queue.push(answer);
    }
  }
  async read() { return Buffer.from(this.queue.shift() ?? "", "latin1").toString("base64"); }
  async close() {}
}
afterEach(() => setMailSocket(null));

const attachmentLines = (bytes: number) => Array.from({ length: Math.ceil(bytes / 76) }, (_, i) => "QUJD".repeat(19).slice(0, 76) + String(i % 10)).join("\r\n");

describe("a message crosses to the mail server in parts", () => {
  it("sends a 5 MB message in writes of at most one part, and the server gets it whole", async () => {
    const server = new Server("220 ready\r\n", (line) => {
      if (line.startsWith("EHLO")) return "250-server\r\n250 AUTH PLAIN LOGIN\r\n";
      if (line.startsWith("AUTH")) return "235 ok\r\n";
      if (line === "DATA\r\n") return "354 send\r\n";
      if (line === "QUIT\r\n") return "221 bye\r\n";
      return "250 ok\r\n";
    });
    setMailSocket(server);
    const body = attachmentLines(5 * 1024 * 1024);
    const mime = `Subject: big\r\n\r\n${body}`;
    await smtpSend({ host: "smtp.example.test", port: 465, user: "u", pass: "p", from: "a@example.test", to: "b@example.test", subject: "big", text: "x" }, mime);
    expect(Math.max(...server.sizes)).toBeLessThanOrEqual(MAIL_WRITE_PART_BYTES);
    expect(server.received).toContain(`${mime}\r\n.\r\n`);
  });

  it("appends a large draft to the mailbox in writes of at most one part", async () => {
    let literal = 0;
    const server = new Server("* OK ready\r\n", (line) => {
      if (/^a\d+ CAPABILITY/.test(line)) return `* CAPABILITY IMAP4rev1\r\n${line.split(" ")[0]} OK\r\n`;
      if (/^a\d+ LOGIN/.test(line)) return `${line.split(" ")[0]} OK\r\n`;
      const counted = /^(a\d+) APPEND .*\{(\d+)\}\r\n$/.exec(line);
      if (counted) { literal = Number(counted[2]); return "+ go\r\n"; }
      if (line === "\r\n" && literal) { literal = 0; return null; }
      const tag = line.split(" ")[0];
      return `${tag} OK\r\n`;
    });
    setMailSocket(server);
    const conn = await ImapConnection.connect({ host: "imap.example.test", port: 993, user: "u", pass: "p" });
    const mime = new TextEncoder().encode(`Subject: draft\r\n\r\n${attachmentLines(2 * 1024 * 1024)}`);
    // The tag of the APPEND answers once the literal's CRLF is in.
    const appending = conn.append({ mailbox: "Drafts" } as Parameters<ImapConnection["append"]>[0], mime).catch(() => {});
    await appending;
    expect(Math.max(...server.sizes)).toBeLessThanOrEqual(MAIL_WRITE_PART_BYTES);
    expect(server.received).toContain(new TextDecoder().decode(mime));
  });
});
