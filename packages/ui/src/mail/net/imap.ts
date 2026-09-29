import { trimEndChars } from "@plainva/core";
import type { MailboxInfo, RawImapEnvelope, RawImapEnvelopePage, RawImapMessage } from "../types";
import type { AppendDraftArgs, ImapCreds } from "../transport";
import { LineSocket } from "./socket";
import { decodeWords, headerAddresses, headerDate, parseHeaders, parseMessage, previewFromBodyPrefix } from "./mime";
import { classifyFolderRole, decodeImapUtf7 } from "../mailOut";
import { MAIL_OAUTH_REJECTED, xoauth2Payload } from "./xoauth2";
import { validatedUids, type ImapBulkArgs, type ImapBulkResult } from "../bulkActions";
import { bodyStructureAttachments } from "./bodyStructure";

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
 * The socket transport serializes operations through its existing session pool.
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
    out += "&" + trimEndChars(btoa(bin), "=").replace(/\//g, ",") + "-";
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

/** What `.` does not match and `$` without `m` cannot pass. */
const LINE_TERMINATORS = "\n\r\u2028\u2029";
const SPACE = /\s/;

/**
 * The rest of a response line after blanks: `\s*(.*)$` (`least` 0) or
 * `\s+(.+)$` (`least` 1) from `from`. Those patterns tried every split of the
 * blank run again when the line did not end there — quadratic in the run of a
 * line a server writes (plan Befunde 24.09., E6). The greedy blanks give one
 * back only where `.+` would otherwise be empty.
 */
function lineRest(line: string, from: number, least: 0 | 1): string | undefined {
  let end = from;
  while (end < line.length && SPACE.test(line[end])) end++;
  const start = Math.min(end, line.length - least);
  if (start - from < least) return undefined;
  for (let i = start; i < line.length; i++) if (LINE_TERMINATORS.includes(line[i])) return undefined;
  return line.slice(start);
}

/** Up to the delimiter the LIST pattern has one way to match; the name is `lineRest`'s. */
const LIST_HEAD = /^\*\s+LIST\s+\(([^)]*)\)\s+(NIL|"[^"]*")/i;

/**
 * An untagged LIST response as flags, delimiter token and mailbox name — the
 * groups of `/^\*\s+LIST\s+\(([^)]*)\)\s+(NIL|"[^"]*")\s+(.+)$/i`.
 */
export function imapListFields(line: string): [flags: string, delimiter: string, name: string] | undefined {
  const head = LIST_HEAD.exec(line);
  const name = head ? lineRest(line, head[0].length, 1) : undefined;
  return head && name !== undefined ? [head[1], head[2], name] : undefined;
}

const SEARCH_HEAD = /^\*\s+SEARCH/i;

/** The UID list of an untagged SEARCH response — the group of `/^\*\s+SEARCH\s*(.*)$/i`. */
export function imapSearchText(line: string): string | undefined {
  const head = SEARCH_HEAD.exec(line);
  return head ? lineRest(line, head[0].length, 0) : undefined;
}

/** Quotes a string for an IMAP command argument. */
export function quoteImapString(s: string): string {
  if (/[\r\n\0]/.test(s)) throw new Error("Invalid IMAP argument");
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
  private uidValidity?: number;

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
    const login = creds.auth === "xoauth2"
      ? await conn.authenticateOAuth(creds.user, creds.pass).catch(async error => { await sock.close(); throw error; })
      : await conn.command(`LOGIN ${quoteImapString(creds.user)} ${quoteImapString(creds.pass)}`);
    if (!login.ok) {
      await sock.close();
      throw new Error(creds.auth === "xoauth2" ? MAIL_OAUTH_REJECTED : login.text || "login rejected by the mail server");
    }
    return conn;
  }

  private async authenticateOAuth(user: string, accessToken: string): Promise<Response> {
    const payload = xoauth2Payload(user, accessToken);
    const capability = await this.command("CAPABILITY");
    if (!capability.ok || !capability.lines.some(line => /\bAUTH=XOAUTH2\b/i.test(line))) {
      throw new Error("The mail server does not support XOAUTH2");
    }
    // Use the continuation form; SASL-IR is optional. A second challenge is an
    // OAuth error and must receive an empty response before the tagged failure.
    const tag = `a${++this.tag}`;
    await this.sock.writeText(`${tag} AUTHENTICATE XOAUTH2${CRLF}`);
    let challenges = 0;
    const result = await this.readResponse(tag, async () => {
      if (++challenges > 2) throw new Error(MAIL_OAUTH_REJECTED);
      await this.sock.writeText((challenges === 1 ? payload : "") + CRLF);
    });
    return challenges === 1 ? result : { ...result, ok: false };
  }

  async close(): Promise<void> {
    await this.command("LOGOUT").catch(() => undefined);
    await this.sock.close();
  }

  /**
   * The cheapest possible round trip (findings round P7.3). The session pool
   * asks this before reusing a pooled connection: a server that dropped the idle
   * socket has to be discovered HERE, not mid-FETCH. Never throws — an
   * unreachable server is simply not healthy.
   */
  async noop(): Promise<boolean> {
    try {
      const res = await this.command("NOOP");
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Sends a command and reads until its tagged completion. */
  async command(cmd: string, literal?: Uint8Array): Promise<Response> {
    if (/[\r\n\0]/.test(cmd)) throw new Error("Invalid IMAP command");
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

  private async readResponse(tag: string, continuation?: () => Promise<void>): Promise<Response> {
    const lines: string[] = [];
    const literals: string[] = [];
    for (;;) {
      let line = await this.sock.readLine();
      if (line.startsWith("+") && continuation) { await continuation(); continue; }
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
      const m = imapListFields(line.replace(LITERAL_MARK_RE, ""));
      if (!m) continue;
      const flags = m[0].toLowerCase();
      if (flags.includes("\\noselect")) continue;
      const delimiter = m[1] === "NIL" ? undefined : m[1].slice(1, -1);
      let rawName = m[2].trim();
      if (rawName.startsWith('"') && rawName.endsWith('"')) rawName = rawName.slice(1, -1);
      const name = decodeImapUtf7(rawName);
      out.push({ name, delimiter, role: classifyFolderRole(name, delimiter) ?? undefined });
    }
    return out;
  }

  /** EXAMINE (read-only) → message count and unseen count. */
  async examine(mailbox: string): Promise<{ exists: number; uidValidity: number }> {
    const res = await this.command(`EXAMINE ${quoteImapString(encodeImapUtf7(mailbox))}`);
    if (!res.ok) throw new Error(res.text || `could not open ${mailbox}`);
    let exists = 0;
    let uidValidity = 0;
    for (const line of res.lines) {
      const e = /^\*\s+(\d+)\s+EXISTS/i.exec(line);
      if (e) exists = Number(e[1]);
      const v = /UIDVALIDITY\s+(\d+)/i.exec(line);
      if (v) uidValidity = Number(v[1]);
    }
    this.uidValidity = uidValidity || undefined;
    return { exists, uidValidity };
  }

  async select(mailbox: string): Promise<void> {
    const res = await this.command(`SELECT ${quoteImapString(encodeImapUtf7(mailbox))}`);
    if (!res.ok) throw new Error(res.text || `could not open ${mailbox}`);
    this.uidValidity = Number(/UIDVALIDITY\s+(\d+)/i.exec(res.lines.join(" "))?.[1]) || undefined;
  }

  async searchUids(criteria: string): Promise<number[]> {
    const res = await this.command(`UID SEARCH ${criteria}`);
    if (!res.ok) throw new Error("The mail server could not complete the search");
    for (const line of res.lines) {
      const uids = imapSearchText(line);
      if (uids !== undefined) {
        return uids
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
      `UID FETCH ${uids.join(",")} (UID FLAGS BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID IN-REPLY-TO REFERENCES)] BODY.PEEK[TEXT]<0.${PREVIEW_BYTES}>)`,
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
        uidValidity: this.uidValidity,
        hasAttachments: bodyStructureAttachments(line),
        subject: decodeWords(h.get("subject") ?? ""),
        from: headerAddresses(h.get("from")),
        dateTs: headerDate(h.get("date")),
        seen: flags.includes("\\seen"),
        flagged: flags.includes("\\flagged"),
        preview: previewFromBodyPrefix(bodyPrefix),
        // Raw header text; `mailClient` runs the shared normaliser (P9.1).
        messageId: h.get("message-id") ?? undefined,
        inReplyTo: h.get("in-reply-to") ?? undefined,
        references: h.get("references") ?? undefined,
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

  /** Creates a mailbox and subscribes it. Subscribing is best-effort: not every
   * server does it on CREATE, and an unsubscribed folder is invisible in clients
   * that list by subscription — but the folder exists either way. */
  async create(name: string): Promise<void> {
    const res = await this.command(`CREATE ${quoteImapString(encodeImapUtf7(name))}`);
    if (!res.ok) throw new Error(res.text || "could not create the mailbox");
    await this.command(`SUBSCRIBE ${quoteImapString(encodeImapUtf7(name))}`);
  }

  async move(uid: number, target: string): Promise<void> {
    const capabilities = await this.command("CAPABILITY");
    if (!capabilities.ok || !/\bMOVE\b/i.test(capabilities.lines.join(" "))) throw new Error("MAIL_BULK_UNSUPPORTED");
    const moved = await this.command(`UID MOVE ${uid} ${quoteImapString(encodeImapUtf7(target))}`);
    if (!moved.ok) throw new Error("The mail server did not confirm the move");
  }

  async expunge(uid: number): Promise<void> {
    validatedUids([uid]);
    const res = await this.command(`UID EXPUNGE ${uid}`);
    if (!res.ok) throw new Error("The mail server did not confirm the deletion");
  }

  /** Exactly one bounded set; a rejected or disconnected MOVE is never
   * followed by COPY, which could duplicate messages already moved by the server. */
  async bulkAction(args: ImapBulkArgs): Promise<ImapBulkResult[]> {
    const uids = validatedUids(args.uids);
    if (!uids.length) return [];
    const result = new Map<number, ImapBulkResult>();
    let started = false;
    const flagsFor = async (set: number[]) => {
      const response = await this.command(`UID FETCH ${set.join(",")} (UID FLAGS)`);
      if (!response.ok) throw new Error("Could not verify message flags");
      const flags = new Map<number, string>();
      for (const line of response.lines) {
        const uid = /\bUID\s+(\d+)/i.exec(line);
        const found = /\bFLAGS\s+\(([^)]*)\)/i.exec(line);
        if (uid && found) flags.set(Number(uid[1]), found[1].toLowerCase());
      }
      return flags;
    };
    try {
      await this.select(args.mailbox);
      if (args.uidValidity !== undefined && args.uidValidity !== this.uidValidity) return uids.map(uid => ({ uid, status: "failed", reason: "changed" }));
      const capability = await this.command("CAPABILITY");
      const caps = capability.lines.join(" ");
      const action = args.action;
      if (!capability.ok || (action.kind === "move" && !/\bMOVE\b/i.test(caps)) || (action.kind === "delete" && !/\bUIDPLUS\b/i.test(caps))) return uids.map(uid => ({ uid, status: "failed", reason: "unsupported" }));
      const before = await flagsFor(uids);
      const present = uids.filter(uid => before.has(uid));
      for (const uid of uids) if (!before.has(uid)) result.set(uid, { uid, status: "failed", reason: "missing" });
      if (!present.length) return uids.map(uid => result.get(uid)!);
      const set = present.join(",");
      let command: string;
      if (action.kind === "move") {
        if (action.target === args.mailbox) return uids.map(uid => result.get(uid) ?? { uid, status: "done" });
        command = `UID MOVE ${set} ${quoteImapString(encodeImapUtf7(action.target))}`;
      } else command = `UID STORE ${set} ${action.kind === "delete" || action.value ? "+" : "-"}FLAGS (\\${action.kind === "delete" ? "Deleted" : action.kind === "seen" ? "Seen" : "Flagged"})`;
      started = true;
      let response = await this.command(command);
      if (action.kind === "delete" && response.ok) response = await this.command(`UID EXPUNGE ${set}`);
      const after = await flagsFor(present);
      for (const uid of present) {
        const flags = after.get(uid);
        const applied = action.kind === "seen" || action.kind === "flagged"
          ? flags !== undefined && flags.includes(action.kind === "seen" ? "\\seen" : "\\flagged") === action.value
          : response.ok && flags === undefined;
        result.set(uid, applied ? { uid, status: "done" } : { uid, status: action.kind === "move" || action.kind === "delete" ? "uncertain" : "failed", reason: "rejected" });
      }
    } catch {
      for (const uid of uids) if (!result.has(uid)) result.set(uid, { uid, status: started ? "uncertain" : "failed", reason: "connection" });
    }
    return uids.map(uid => result.get(uid)!);
  }

  async append(args: AppendDraftArgs, mime: Uint8Array): Promise<void> {
    const res = await this.command(
      `APPEND ${quoteImapString(encodeImapUtf7(args.mailbox))} (\\Draft \\Seen) {${mime.length}}`,
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
