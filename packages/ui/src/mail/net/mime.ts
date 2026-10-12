import { htmlToPlainText } from "@plainva/core";
import type { MailAttachmentInfo } from "../types";

/**
 * The MIME reading side of the mobile mail client (mail feinplan G2).
 *
 * The desktop gets parsed messages back from Rust; on mobile the raw RFC 822
 * bytes come off the socket, so the parsing happens here — once, in shared
 * code, rather than twice in Java and Swift.
 *
 * A message is BYTES until a part says what they mean (finding 2026-10-09).
 * Its structure — header lines, boundaries, transfer encodings — is ASCII, and
 * is read from a string that holds one character per byte (`wireOf`); what a
 * part's bytes say is decided last, by the charset the part declares. The IMAP
 * client used to turn a whole message into UTF-8 text before any of this ran:
 * an 8-bit body came out with a replacement character for every umlaut, and an
 * 8-bit attachment as different bytes.
 */

export interface ParsedPart {
  mime: string;
  name: string | null;
  disposition: string | null;
  /** Decoded text for text/*; raw bytes otherwise. */
  text: string | null;
  bytes: Uint8Array | null;
  /** 1-based index among the parts a user would call an attachment. */
  index: number;
}

export interface ParsedMessage {
  headers: Map<string, string>;
  text: string | null;
  html: string | null;
  attachments: MailAttachmentInfo[];
  parts: ParsedPart[];
}

const dec = (label: string) => {
  try {
    return new TextDecoder(label, { fatal: false });
  } catch {
    return new TextDecoder("utf-8", { fatal: false });
  }
};

/**
 * A message in the form its structure is read in: one character per byte. A
 * string stands for its UTF-8 bytes — what a message built here is sent as.
 */
function wireOf(raw: Uint8Array | string): string {
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
  let wire = "";
  for (let i = 0; i < bytes.length; i += 0x8000) wire += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return wire;
}

/** The bytes a stretch of `wireOf` stands for. */
function wireBytes(wire: string): Uint8Array {
  const out = new Uint8Array(wire.length);
  for (let i = 0; i < wire.length; i++) out[i] = wire.charCodeAt(i) & 0xff;
  return out;
}

/** Without a UTF-8 sequence that a cut-off prefix left unfinished at its end. */
function withoutCutSequence(bytes: Uint8Array): Uint8Array {
  let lead = bytes.length - 1;
  while (lead >= 0 && bytes.length - lead < 4 && (bytes[lead] & 0xc0) === 0x80) lead--;
  if (lead < 0) return bytes;
  const length = bytes[lead] >= 0xf0 ? 4 : bytes[lead] >= 0xe0 ? 3 : bytes[lead] >= 0xc0 ? 2 : 1;
  return bytes.length - lead < length ? bytes.subarray(0, lead) : bytes;
}

/**
 * A header block off the wire as text, for `parseHeaders`. Headers are ASCII by
 * rule; one written in raw 8 bit is read as UTF-8 (RFC 6532), and a byte that
 * is not UTF-8 becomes a replacement mark. That is how the desktop's parser
 * reads it, too — nothing is guessed here that the other shell does not guess.
 */
export function decodeHeaderBlock(bytes: Uint8Array): string {
  return dec("utf-8").decode(bytes);
}

/** Splits a raw message into its header block and body. */
export function splitHeaders(raw: string): { head: string; body: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  if (!m) return { head: raw, body: "" };
  return { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

/** Header map with unfolded values; later duplicates are kept as the first. */
export function parseHeaders(head: string): Map<string, string> {
  const out = new Map<string, string>();
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

/** RFC 2047 encoded words in a header value ("=?utf-8?B?…?="). */
export function decodeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_all, charset: string, enc: string, data: string) => {
    try {
      const bytes =
        enc.toLowerCase() === "b"
          ? base64Bytes(data)
          : qpBytes(data.replace(/_/g, " "));
      return dec(charset).decode(bytes);
    } catch {
      return data;
    }
  });
}

function base64Bytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function qpBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "=" && i + 2 < s.length) {
      const hex = s.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
      // Soft line break: "=" at end of line.
      if (/^\r?\n/.test(s.slice(i + 1))) {
        i += s[i + 1] === "\r" ? 2 : 1;
        continue;
      }
    }
    out.push(c.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(out);
}

/** `name="x"; charset=utf-8` → map. Handles quoted values. */
export function parseParams(value: string): Map<string, string> {
  const out = new Map<string, string>();
  const chunks: string[] = [];
  let part = "", quoted = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quoted && char === "\\" && index + 1 < value.length) { part += value[++index]; continue; }
    if (char === '"') { quoted = !quoted; part += char; continue; }
    if (!quoted && char === ";") { chunks.push(part); part = ""; } else part += char;
  }
  chunks.push(part);
  for (const chunk of chunks.slice(1)) {
    const i = chunk.indexOf("=");
    if (i < 0) continue;
    const k = chunk.slice(0, i).trim().toLowerCase();
    let v = chunk.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out.set(k, decodeWords(v));
  }
  const continued = new Map<string, Array<{ index: number; encoded: boolean; value: string }>>();
  for (const [key, val] of out) {
    const match = /^([^*]+)\*(?:(\d+)(\*)?)?$/.exec(key);
    if (!match) continue;
    const parts = continued.get(match[1]) ?? [];
    parts.push({ index: Number(match[2] ?? 0), encoded: match[2] === undefined || !!match[3], value: val });
    continued.set(match[1], parts);
  }
  for (const [key, parts] of continued) {
    parts.sort((a, b) => a.index - b.index);
    if (parts.some((part, index) => part.index !== index)) continue;
    const joined = parts.map(part => part.value).join("");
    if (!parts[0].encoded) { out.set(key, joined); continue; }
    const first = joined.indexOf("'"), second = joined.indexOf("'", first + 1);
    if (first < 0 || second < 0) continue;
    const bytes: number[] = [];
    const raw = joined.slice(second + 1);
    let valid = true;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "%") {
        const hex = raw.slice(i + 1, i + 3);
        if (!/^[a-f0-9]{2}$/i.test(hex)) { valid = false; break; }
        bytes.push(parseInt(hex, 16)); i += 2;
      } else bytes.push(raw.charCodeAt(i));
    }
    if (valid) out.set(key, dec(joined.slice(0, first) || "utf-8").decode(new Uint8Array(bytes)));
  }
  return out;
}

/** A parsed header block, as `parseHeaders` returns it. */
type HeaderMap = ReadonlyMap<string, string>;

/** One multipart/alternative around a part, and the direct child of it that leads to the part. */
interface AlternativeBranch {
  alternative: number;
  child: number;
}

function contentType(headers: HeaderMap): string {
  return (headers.get("content-type") ?? "text/plain").split(";")[0].trim().toLowerCase();
}

/** A part's bytes, its transfer encoding undone. `body` is in `wireOf` form. */
function decodeBody(headers: HeaderMap, body: string): Uint8Array {
  const encoding = (headers.get("content-transfer-encoding") ?? "7bit").trim().toLowerCase();
  if (encoding === "base64") return base64Bytes(body);
  if (encoding === "quoted-printable") return qpBytes(body);
  return wireBytes(body);
}

/**
 * Bytes as text in the charset a part declares. Without one they are read as
 * UTF-8 — as they always were here, and as the desktop's parser reads them.
 * `cut` is for a prefix that may end inside a character.
 */
function decodeCharset(headers: HeaderMap, bytes: Uint8Array, cut = false): string {
  const charset = parseParams(headers.get("content-type") ?? "").get("charset") ?? "utf-8";
  return dec(charset).decode(cut && /^utf-?8$/i.test(charset) ? withoutCutSequence(bytes) : bytes);
}

function decodeText(headers: HeaderMap, body: string): string {
  return decodeCharset(headers, decodeBody(headers, body));
}

/**
 * A delimiter line without the blanks a transport may have put behind it. Only
 * a blank, a tab and the carriage return: in a string of one character per
 * byte, `trimEnd` would take the byte 0xA0 for padding, too.
 */
function withoutPadding(line: string): string {
  let end = line.length;
  while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t" || line[end - 1] === "\r")) end--;
  return line.slice(0, end);
}

/**
 * Splits a multipart body on its boundary. The parts are cut out of the body
 * as they stand: a part can be a file, and a file's line breaks are its own.
 * Only the line break in front of a delimiter belongs to the delimiter.
 */
function splitMultipart(body: string, boundary: string): string[] {
  // The boundary comes from a header that was read as text; the body is bytes.
  const marker = "--" + wireOf(boundary);
  const parts: string[] = [];
  /** Where the open part's content begins; -1 in front of the first delimiter. */
  let partStart = -1;
  for (let lineStart = 0; lineStart <= body.length; ) {
    const newline = body.indexOf("\n", lineStart);
    const line = withoutPadding(body.slice(lineStart, newline < 0 ? body.length : newline));
    if (line === marker || line === marker + "--") {
      if (partStart >= 0) {
        let partEnd = lineStart;
        if (partEnd > partStart && body[partEnd - 1] === "\n") partEnd--;
        if (partEnd > partStart && body[partEnd - 1] === "\r") partEnd--;
        parts.push(body.slice(partStart, partEnd));
      }
      if (line !== marker) return parts;
      partStart = newline < 0 ? body.length : newline + 1;
    }
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  if (partStart >= 0) parts.push(body.slice(partStart));
  return parts;
}

/**
 * Parses a raw RFC 822 message into the shape the shared mail client already
 * speaks (text, html, attachment list). Deliberately tolerant: a malformed
 * part must never lose the rest of the message.
 *
 * Takes the message as the bytes the server sent. A string is read as its
 * UTF-8 bytes, so a message built in a test parses like the one on the wire.
 *
 * `text` is the plain-text version of the message's BODY: the first text part
 * a reader would show, or — where that one is HTML — its other version: a
 * text/plain part in ANOTHER branch of a multipart/alternative the HTML lies
 * in. A plain-text part anywhere else is something else. Under an HTML mail it
 * is typically the footer a mailing list appended; next to the HTML inside one
 * branch it is a second piece of that version, not a version of its own. A
 * reply that quoted either instead of the mail would quote a different text on
 * the phone than on the desktop, whose parser reads the body this way.
 */
export function parseMessage(raw: Uint8Array | string): ParsedMessage {
  const { head, body } = splitHeaders(wireOf(raw));
  // Header blocks become text before they are parsed: trimming a value while
  // it is still bytes would cut a UTF-8 sequence that ends in 0xA0.
  const headersOf = (block: string): Map<string, string> => parseHeaders(decodeHeaderBlock(wireBytes(block)));
  const headers = headersOf(head);
  const parts: ParsedPart[] = [];
  /**
   * Per part, in the order of `parts`: the branches it lies in — one entry for
   * each multipart/alternative around it, naming that alternative and which of
   * its direct children leads to the part.
   */
  const branchesOf: Array<ReadonlyArray<AlternativeBranch>> = [];
  let alternatives = 0;
  let index = 0;

  const walk = (partHeaders: Map<string, string>, partBody: string, depth: number, branches: ReadonlyArray<AlternativeBranch>): void => {
    if (depth > 12) return; // pathological nesting guard
    const type = contentType(partHeaders);
    if (type.startsWith("multipart/")) {
      const boundary = parseParams(partHeaders.get("content-type") ?? "").get("boundary");
      if (!boundary) return;
      // What lies inside one branch (an HTML part with its images) belongs to that version.
      const alternative = type === "multipart/alternative" ? ++alternatives : 0;
      splitMultipart(partBody, boundary).forEach((chunk, child) => {
        const sub = splitHeaders(chunk);
        walk(headersOf(sub.head), sub.body, depth + 1, alternative ? [...branches, { alternative, child }] : branches);
      });
      return;
    }
    const disposition = (partHeaders.get("content-disposition") ?? "").split(";")[0].trim().toLowerCase() || null;
    const name =
      parseParams(partHeaders.get("content-disposition") ?? "").get("filename") ??
      parseParams(partHeaders.get("content-type") ?? "").get("name") ??
      null;
    const isText = type.startsWith("text/") && disposition !== "attachment";
    parts.push({
      mime: type,
      name,
      disposition,
      text: isText ? decodeText(partHeaders, partBody) : null,
      bytes: isText ? null : decodeBody(partHeaders, partBody),
      index: ++index,
    });
    branchesOf.push(branches);
  };

  walk(headers, body, 0, []);

  const shown = (part: ParsedPart): boolean => part.text !== null && (part.mime === "text/plain" || part.mime === "text/html");
  const first = parts.findIndex(shown);
  let text: string | null = null;
  if (first >= 0 && parts[first].mime === "text/plain") {
    text = parts[first].text;
  } else if (first >= 0) {
    const own = branchesOf[first];
    const otherVersion = (at: number): boolean =>
      branchesOf[at].some((branch) => own.some((mine) => mine.alternative === branch.alternative && mine.child !== branch.child));
    text = parts.find((part, at) => part.mime === "text/plain" && part.text !== null && otherVersion(at))?.text ?? null;
  }
  const html = parts.find((p) => p.mime === "text/html" && p.text !== null)?.text ?? null;
  const attachments: MailAttachmentInfo[] = parts
    .filter((p) => p.bytes !== null && (p.disposition === "attachment" || p.name !== null))
    .map((p) => ({ index: p.index, name: p.name ?? `part-${p.index}`, mime: p.mime, size: p.bytes?.length ?? 0 }));

  return { headers, text, html, attachments, parts };
}

/**
 * A one-line preview from the FIRST BYTES of a message body (device report B3:
 * the mobile list shows three lines, the third being the opening words).
 *
 * The input is `BODY[TEXT]<0.n>` — a truncated prefix, on purpose: the preview
 * rides along in the envelope FETCH instead of costing a second roundtrip.
 * That means it can be anything: plain text, quoted-printable, the boundary and
 * part headers of a multipart message, or HTML. Everything here is therefore
 * best-effort and MUST degrade to "" rather than show MIME plumbing to a
 * reader. `BODY[TEXT]` is used rather than `BODY[1]` because TEXT is accepted
 * by every server, and a BAD reply here would take the whole message list down.
 *
 * The prefix is bytes like the message it is cut from (a string stands for its
 * UTF-8 bytes), and the cut may fall inside a character. What the bytes mean
 * — charset and transfer encoding — stands in a header: `message` is the
 * message's own (a body of one part has no other), and a part inside the
 * prefix that brings its header replaces it. Without either, the list showed
 * `Gr=C3=BC=C3=9Fe` for a quoted-printable mail and marks for a Latin-1 one.
 */
export function previewFromBodyPrefix(raw: Uint8Array | string, max = 160, message: HeaderMap = new Map()): string {
  let body = wireOf(raw);
  if (!body.trim()) return "";
  let headers = message;

  // Multipart: walk to the first text part inside the prefix we were given.
  // Anything past the truncation point simply is not there — then the preview
  // stays empty, which is honest.
  const boundary = /^--[^\r\n]+$/m.exec(body);
  if (boundary && /content-type\s*:/i.test(body)) {
    const chunks = body.split(new RegExp(`^${escapeRe(boundary[0])}(?:--)?\\s*$`, "m")).slice(1);
    const pick =
      chunks.find((c) => /content-type\s*:\s*text\/plain/i.test(c)) ??
      chunks.find((c) => /content-type\s*:\s*text\/html/i.test(c)) ??
      chunks[0] ??
      "";
    const split = splitHeaders(pick.replace(/^\r?\n/, ""));
    headers = parseHeaders(split.head);
    body = split.body;
  } else if (/^(content-type|content-transfer-encoding)\s*:/im.test(body.slice(0, 200))) {
    // Single part whose headers came along with TEXT on some servers.
    const split = splitHeaders(body);
    headers = parseHeaders(split.head);
    body = split.body;
  }

  // A truncated base64 part cannot be decoded safely (the tail is a partial
  // group) — better no preview than mojibake.
  const encoding = (headers.get("content-transfer-encoding") ?? "").trim().toLowerCase();
  if (encoding === "base64") return "";
  // A prefix cut inside an escape ends in "=" or "=X": no text, and the byte
  // in front of it may be half a character, which the decoding below drops.
  const bytes = encoding === "quoted-printable" ? qpBytes(body.replace(/=[0-9A-Fa-f]?$/, "")) : wireBytes(body);
  let text = decodeCharset(headers, bytes, true);

  if ((headers.get("content-type") ?? "").includes("text/html") || /<\/?(p|div|br|span|table)\b/i.test(text)) {
    text = htmlToPlainText(text);
  }

  const flat = text
    .replace(/^--[^\r\n]*$/gm, " ") // stray boundary from a nested part
    .replace(/\s+/g, " ")
    .trim();
  // No letters or digits at all means we hit plumbing, not prose.
  if (!/[\p{L}\p{N}]/u.test(flat)) return "";
  return flat.length > max ? flat.slice(0, max).trimEnd() + "…" : flat;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Address list header → the display form the app shows ("A <a@x>, B <b@y>"). */
export function headerAddresses(value: string | undefined): string {
  if (!value) return "";
  return decodeWords(value).trim();
}

/** Date header → epoch ms (0 when unparsable — the caller falls back). */
export function headerDate(value: string | undefined): number {
  if (!value) return 0;
  const t = Date.parse(decodeWords(value));
  return Number.isFinite(t) ? t : 0;
}
