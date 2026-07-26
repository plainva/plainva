import type { SmtpSendArgs } from "../transport";
import { LineSocket } from "./socket";

/**
 * SMTP submission over a raw socket (mail feinplan G2). Same reasoning as the
 * IMAP side: one implementation in shared code, the native layer only supplies
 * the socket.
 *
 * Submission ports only: 465 is implicit TLS, everything else (587, and the
 * Proton Bridge on 1025) starts in the clear and upgrades with STARTTLS. A
 * server that offers neither is refused rather than spoken to in plain text —
 * a password must not go over an unencrypted socket.
 */

const CRLF = "\r\n";

function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Reads one SMTP reply (handles multi-line "250-" continuations). */
async function reply(sock: LineSocket): Promise<{ code: number; text: string }> {
  const lines: string[] = [];
  for (;;) {
    const line = await sock.readLine();
    lines.push(line);
    if (/^\d{3} /.test(line)) break;
    if (!/^\d{3}-/.test(line)) break;
  }
  const last = lines[lines.length - 1];
  return { code: Number(last.slice(0, 3)), text: lines.join("\n") };
}

async function expect(sock: LineSocket, ok: number[], what: string): Promise<string> {
  const r = await reply(sock);
  if (!ok.includes(r.code)) throw new Error(`${what}: ${r.text}`);
  return r.text;
}

async function say(sock: LineSocket, line: string, ok: number[], what: string): Promise<string> {
  await sock.writeText(line + CRLF);
  return expect(sock, ok, what);
}

/** Dot-stuffing: a line starting with "." would end the DATA block. */
function stuff(mime: string): string {
  return mime.replace(/\r?\n/g, CRLF).replace(/^\./gm, "..");
}

/**
 * Sends one message. `mime` is the complete RFC 822 document — building it is
 * the shared composer's job (`buildMimeMessage`), so this function only speaks
 * the protocol.
 */
export async function smtpSend(args: SmtpSendArgs, mime: string, timeoutMs = 30_000): Promise<void> {
  const implicitTls = args.port === 465;
  const sock = await LineSocket.connect(args.host, args.port, implicitTls, timeoutMs);
  try {
    await expect(sock, [220], "the mail server refused the connection");
    const ehlo = await say(sock, `EHLO plainva`, [250], "EHLO failed");
    if (!implicitTls) {
      if (!/STARTTLS/i.test(ehlo)) throw new Error("the server offers no STARTTLS — refusing to send the password in the clear");
      await say(sock, "STARTTLS", [220], "STARTTLS failed");
      await sock.startTls();
      // The capability list must be re-read on the encrypted channel.
      await say(sock, `EHLO plainva`, [250], "EHLO after STARTTLS failed");
    }
    // AUTH PLAIN is the common case; LOGIN is the fallback for servers without it.
    try {
      await say(sock, `AUTH PLAIN ${b64(`\0${args.user}\0${args.pass}`)}`, [235], "sign-in rejected");
    } catch {
      await say(sock, "AUTH LOGIN", [334], "sign-in rejected");
      await say(sock, b64(args.user), [334], "sign-in rejected");
      await say(sock, b64(args.pass), [235], "sign-in rejected");
    }
    await say(sock, `MAIL FROM:<${args.from}>`, [250], "the server rejected the sender");
    const recipients = [args.to, args.cc ?? "", args.bcc ?? ""]
      .join(",")
      .split(/[,;]/)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => (/<([^>]+)>/.exec(r)?.[1] ?? r).trim());
    if (recipients.length === 0) throw new Error("no recipient");
    for (const rcpt of recipients) {
      await say(sock, `RCPT TO:<${rcpt}>`, [250, 251], `the server rejected ${rcpt}`);
    }
    await say(sock, "DATA", [354], "the server rejected the message");
    await sock.writeText(stuff(mime) + CRLF + "." + CRLF);
    await expect(sock, [250], "the server did not accept the message");
    await say(sock, "QUIT", [221], "QUIT failed").catch(() => undefined);
  } finally {
    await sock.close();
  }
}
