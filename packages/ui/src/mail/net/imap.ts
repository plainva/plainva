import type { MailboxInfo, RawImapEnvelope, RawImapEnvelopePage, RawImapMessage } from "../types";
import type { AppendDraftArgs, ImapCreds } from "../transport";
import { LineSocket } from "./socket";
import { decodeWords, headerAddresses, headerDate, parseHeaders, parseMessage, previewFromBodyPrefix } from "./mime";
import { classifyFolderRole, decodeImapUtf7 } from "../mailOut";

/**
 * IMAP over a raw socket (mail feinplan G2) — written once in shared code so
 * Android and iOS run the identical protocol. The native side only opens the
 * socket; everything here is plain TypeScript and testable against a scripted
 * fake server.
 *
 * Scope on purpose: exactly the commands the app already uses (the desktop
 * Rust surface), no more. A small client for known commands is easier to audit
 * than a general-purpose library, which is why we build rather than pull one in.
 *
 * A fresh connection per operation, like the desktop — no pooling (E-G6).
 */

const CRLF = "\r\n";

/** Marks where a counted literal was spliced out of a response line. Written
 *  as an escape on purpose: a raw control byte in a source file once made
 *  three files binary to git here. */
const LITERAL_MARK = "\u0001";
const LITERAL_MARK_RE = new RegExp(LITERAL_MARK, "g");

/**
 * Body bytes taken along per message for the list preview (B3). Enough to get
 * past a part header block into the actual words, small enough that a 30-row
 * page stays a mobile-sized request.
 */
const PREVIEW_BYTES = 1024;

/** Mailbox names travel in modified UTF-7 (RFC 3501 §5.1.3). */
export function encodeImapUtf7(name: string): string {
  let out = "";
  let buf = "";
  const flush = () => {
    if (!buf) return;
    const bytes: number[] = [];
    for (const ch of buf) {
      const cp = ch.codePointAt(0)!;
      if (cp > 0xffff) {
        const v = cp - 0x10000;
        bytes.push(0xd8 | ((v >> 18) & 0x03), (v >> 10) & 0xff, 0xdc | ((v >> 8) & 0x03), v & 0xff);
      } else {
        bytes.push(cp >> 8, cp & 0xff);
      }
    }
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    out += "&" + btoa(bin).replace(/=+$/, "").replace(/\//g, ",") + "-";
    buf = "";
  };
  for (const ch of name) {
    const cp = ch.codePointAt(0)!;
    if (ch === "&") {
      flush();
      out += "&-";
    } else if (cp >= 0x20 && cp <= 0x7e) {
      flush();
      out += ch;
    } else {
      buf += ch;
    }
  }
  flush();
  return out;
}

/** Quotes a string for an IMAP command argument. */
function q(s: string): string {
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

interface Response {
  /** Untagged lines, literals already inlined as `{n}` + the payload below. */
  lines: string[];
  /** Literal payloads in the order they appeared. */
  literals: string[];
  ok: boolean;
  text: string;
}

export class ImapConnection {
  private tag = 0;

  private constructor(private readonly sock: LineSocket) {}

  static async connect(creds: ImapCreds, timeoutMs = 30_000): Promise<ImapConnection> {
    // 993 is implicit TLS; anything else starts in the clear and upgrades with
    // STARTTLS (143, and the Proton Bridge on 1143) — same rule as the desktop.
    const implicitTls = creds.port === 993;
    const sock = await LineSocket.connect(creds.host, creds.port, implicitTls, timeoutMs);
    const conn = new ImapConnection(sock);
    const greeting = await sock.readLine();
    if (!/^\*\s+(OK|PREAUTH)/i.test(greeting)) {
      await sock.close();
      throw new Error(`mail server refused the connection: ${greeting}`);
    }
    if (!implicitTls) {
      const res = await conn.command("STARTTLS");
      if (!res.ok) {
        await sock.close();
        throw new Error("the mail server does not offer STARTTLS on this port");
      }
      await sock.startTls();
    }
    const login = await conn.command(`LOGIN ${q(creds.user)} ${q(creds.pass)}`);
    if (!login.ok) {
      await sock.close();
      throw new Error(login.text || "login rejected by the mail server");
    }
    return conn;
  }

  async close(): Promise<void> {
    await this.command("LOGOUT").catch(() => undefined);
    await this.sock.close();
  }

  /** Sends a command and reads until its tagged completion. */
  async command(cmd: string, literal?: Uint8Array): Promise<Response> {
    const tag = `a${++this.tag}`;
    await this.sock.writeText(`${tag} ${cmd}${CRLF}`);
    if (literal) {
      // The server answers "+ go ahead" before the payload.
      const cont = await this.sock.readLine();
      if (!cont.startsWith("+")) throw new Error(`server rejected the upload: ${cont}`);
      await this.sock.writeBytes(literal);
      await this.sock.writeText(CRLF);
    }
    return this.readResponse(tag);
  }

  private async readResponse(tag: string): Promise<Response> {
    const lines: string[] = [];
    const literals: string[] = [];
    for (;;) {
      let line = await this.sock.readLine();
      // Inline any counted literal that terminates the line.
      let m = /\{(\d+)\}$/.exec(line);
      while (m) {
        const bytes = await this.sock.readBytes(Number(m[1]));
        literals.push(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
        const rest = await this.sock.readLine();
        line = line + LITERAL_MARK + rest; // marker: a literal was spliced here
        m = /\{(\d+)\}$/.exec(line);
      }
      if (line.startsWith(tag + " ")) {
        const rest = line.slice(tag.length + 1);
        const ok = /^OK\b/i.test(rest);
        return { lines, literals, ok, text: rest.replace(/^(OK|NO|BAD)\s*/i, "") };
      }
      lines.push(line);
    }
  }

  /** LIST → the mailbox list with delimiter and guessed role. */
  async listMailboxes(): Promise<MailboxInfo[]> {
    const res = await this.command('LIST "" "*"');
    if (!res.ok) throw new Error(res.text || "could not list the mailboxes");
    const out: MailboxInfo[] = [];
    for (const line of res.lines) {
      // * LIST (\HasNoChildren) "/" "INBOX"
      const m = /^\*\s+LIST\s+\(([^)]*)\)\s+(NIL|"[^"]*")\s+(.+)$/i.exec(line.replace(LITERAL_MARK_RE, ""));
      if (!m) continue;
      const flags = m[1].toLowerCase();
      if (flags.includes("\\noselect")) continue;
      const delimiter = m[2] === "NIL" ? undefined : m[2].slice(1, -1);
      let rawName = m[3].trim();
      if (rawName.startsWith('"') && rawName.endsWith('"')) rawName = rawName.slice(1, -1);
      const name = decodeImapUtf7(rawName);
      out.push({ name, delimiter, role: classifyFolderRole(name, delimiter) ?? undefined });
    }
    return out;
  }

  /** EXAMINE (read-only) → message count and unseen count. */
  async examine(mailbox: string): Promise<{ exists: number; uidValidity: number }> {
    const res = await this.command(`EXAMINE ${q(encodeImapUtf7(mailbox))}`);
    if (!res.ok) throw new Error(res.text || `could not open ${mailbox}`);
    let exists = 0;
    let uidValidity = 0;
    for (const line of res.lines) {
      const e = /^\*\s+(\d+)\s+EXISTS/i.exec(line);
      if (e) exists = Number(e[1]);
      const v = /UIDVALIDITY\s+(\d+)/i.exec(line);
      if (v) uidValidity = Number(v[1]);
    }
    return { exists, uidValidity };
  }

  async select(mailbox: string): Promise<void> {
    const res = await this.command(`SELECT ${q(encodeImapUtf7(mailbox))}`);
    if (!res.ok) throw new Error(res.text || `could not open ${mailbox}`);
  }

  async searchUids(criteria: string): Promise<number[]> {
    const res = await this.command(`UID SEARCH ${criteria}`);
    if (!res.ok) return [];
    for (const line of res.lines) {
      const m = /^\*\s+SEARCH\s*(.*)$/i.exec(line);
      if (m) {
        return m[1]
          .split(/\s+/)
          .filter(Boolean)
          .map(Number)
          .filter((n) => Number.isFinite(n));
      }
    }
    return [];
  }

  /**
   * Envelopes for a set of UIDs. Uses HEADER.FIELDS rather than the ENVELOPE
   * response: the payload is a normal header block, so the shared MIME header
   * parser handles encoded words and folding instead of a second, IMAP-shaped
   * parser doing the same job slightly differently.
   *
   * The same FETCH also takes the first {@link PREVIEW_BYTES} of the body, so
   * the mobile list can show an opening line (device report B3) without a
   * second roundtrip. Two body sections mean TWO literals per FETCH line, which
   * is why the parsing below walks the segments a literal was spliced into
   * instead of assuming one per line — and why each segment is classified by
   * the section it names rather than by position: nothing obliges a server to
   * answer in the order we asked.
   */
  async fetchEnvelopes(uids: number[]): Promise<RawImapEnvelope[]> {
    if (uids.length === 0) return [];
    const res = await this.command(
      `UID FETCH ${uids.join(",")} (UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)] BODY.PEEK[TEXT]<0.${PREVIEW_BYTES}>)`,
    );
    if (!res.ok) throw new Error(res.text || "could not read the message list");
    const out: RawImapEnvelope[] = [];
    let li = 0;
    for (const line of res.lines) {
      if (!/^\*\s+\d+\s+FETCH/i.test(line)) continue;
      const segments = line.split(LITERAL_MARK);
      // One literal per splice point; the LAST segment carries no literal.
      const taken = res.literals.slice(li, li + segments.length - 1);
      li += segments.length - 1;
      let header = "";
      let bodyPrefix = "";
      segments.slice(0, -1).forEach((segment, i) => {
        if (/BODY\[TEXT\]/i.test(segment)) bodyPrefix = taken[i] ?? "";
        else if (/HEADER/i.test(segment)) header = taken[i] ?? "";
      });
      const uidM = /UID\s+(\d+)/i.exec(line);
      if (!uidM) continue;
      const flags = (/FLAGS\s+\(([^)]*)\)/i.exec(line)?.[1] ?? "").toLowerCase();
      const h = parseHeaders(header);
      out.push({
        uid: Number(uidM[1]),
        subject: decodeWords(h.get("subject") ?? ""),
        from: headerAddresses(h.get("from")),
        dateTs: headerDate(h.get("date")),
        seen: flags.includes("\\seen"),
        flagged: flags.includes("\\flagged"),
        preview: previewFromBodyPrefix(bodyPrefix),
      });
    }
    return out;
  }

  /** One full message (raw RFC 822), parsed into the shared shape. */
  async fetchMessage(uid: number): Promise<RawImapMessage> {
    const raw = await this.fetchRaw(uid);
    const parsed = parseMessage(raw);
    const h = parsed.headers;
    return {
      uid,
      subject: decodeWords(h.get("subject") ?? ""),
      from: headerAddresses(h.get("from")),
      to: headerAddresses(h.get("to")),
      dateTs: headerDate(h.get("date")),
      text: parsed.text,
      html: parsed.html,
      attachments: parsed.attachments,
      providerMessageId: h.get("message-id") ?? undefined,
    };
  }

  async fetchRaw(uid: number): Promise<string> {
    const res = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`);
    if (!res.ok || res.literals.length === 0) throw new Error(res.text || "could not read the message");
    return res.literals[0];
  }

  async fetchAttachment(uid: number, index: number): Promise<string> {
    const raw = await this.fetchRaw(uid);
    const part = parseMessage(raw).parts.find((p) => p.index === index);
    if (!part?.bytes) throw new Error("attachment not found");
    let bin = "";
    for (let i = 0; i < part.bytes.length; i += 0x8000) bin += String.fromCharCode(...part.bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async store(uid: number, flag: string, on: boolean): Promise<void> {
    const res = await this.command(`UID STORE ${uid} ${on ? "+" : "-"}FLAGS (${flag})`);
    if (!res.ok) throw new Error(res.text || "could not change the message flags");
  }

  async move(uid: number, target: string): Promise<void> {
    const moved = await this.command(`UID MOVE ${uid} ${q(encodeImapUtf7(target))}`);
    if (moved.ok) return;
    // Servers without MOVE (RFC 6851): copy, mark deleted, expunge.
    const copied = await this.command(`UID COPY ${uid} ${q(encodeImapUtf7(target))}`);
    if (!copied.ok) throw new Error(copied.text || "could not move the message");
    await this.store(uid, "\\Deleted", true);
    await this.expunge(uid);
  }

  async expunge(uid?: number): Promise<void> {
    // UID EXPUNGE only removes the message asked for; without UIDPLUS the plain
    // EXPUNGE is the only option and removes every \Deleted message in the box.
    const res = uid !== undefined ? await this.command(`UID EXPUNGE ${uid}`) : { ok: false, text: "" } as Response;
    if (!res.ok) await this.command("EXPUNGE");
  }

  async append(args: AppendDraftArgs, mime: Uint8Array): Promise<void> {
    const res = await this.command(
      `APPEND ${q(encodeImapUtf7(args.mailbox))} (\\Draft \\Seen) {${mime.length}}`,
      mime,
    );
    if (!res.ok) throw new Error(res.text || "could not store the draft");
  }
}

/** Page of envelopes, newest first — the shape the shared client expects. */
export async function pageEnvelopes(
  conn: ImapConnection,
  mailbox: string,
  offset: number,
  limit: number,
  beforeUid?: number,
): Promise<RawImapEnvelopePage> {
  await conn.examine(mailbox);
  const all = await conn.searchUids("ALL");
  const unseen = (await conn.searchUids("UNSEEN")).length;
  const desc = all.slice().sort((a, b) => b - a);
  const from = beforeUid ? desc.filter((u) => u < beforeUid) : desc.slice(offset);
  const slice = from.slice(0, limit);
  const messages = await conn.fetchEnvelopes(slice);
  messages.sort((a, b) => b.uid - a.uid);
  return { total: all.length, unseen, messages };
}
