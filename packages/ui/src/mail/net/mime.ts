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

/**
 * A header block in `wireOf` form as a map. The block becomes text before it
 * is parsed: trimming a value while it is still bytes would cut a UTF-8
 * sequence that ends in 0xA0.
 */
function headersOf(block: string): Map<string, string> {
  return parseHeaders(decodeHeaderBlock(wireBytes(block)));
}

/**
 * Splits a raw message, or one part of it, into its header block and body.
 *
 * The header lines end at the first empty line, and a block that BEGINS with
 * one has none (finding 2026-10-12). A part may be written that way (RFC 2046,
 * 5.1) and is plain text then. The first empty line used to be looked for
 * anywhere in the block: the paragraph in front of it was taken for the header
 * and was missing from the text, and a text of one line was missing whole. The
 * desktop's parser reads such a part the same way; `mail_imap.rs` holds it
 * with the messages `imapClient.test.ts` holds this with. By the same rule,
 * header lines a generator wrote behind such an empty line are the part's
 * text: the old search took them for its header, the desktop's parser never
 * did. One exception this reader does not know: in a multipart/digest such a
 * part is an enclosed message (5.1.5), and the desktop's parser reads it so
 * (parity catalog, `mail-digest-parts`).
 */
export function splitHeaders(raw: string): { head: string; body: string } {
  const none = /^\r?\n/.exec(raw);
  if (none) return { head: "", body: raw.slice(none[0].length) };
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

/** In `BASE64_VALUE`: the "=" that ends a group. */
const BASE64_END = -2;

/** A character's six bits by its code; -1 for one that is no base64. */
const BASE64_VALUE = (() => {
  const table = new Int8Array(256).fill(-1);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  table["=".charCodeAt(0)] = BASE64_END;
  return table;
})();

/**
 * Base64 as mail carries it. There is no input this cannot read (finding
 * 2026-10-12). It used to be `atob`, which takes a "=" at the very end only
 * and threw on everything else: a generator that pads every line on its own,
 * two encodings joined into one, a padding that is one "=" short. One such
 * part was the whole message's error — it could not be opened at all.
 *
 * A "=" ends a group wherever it stands, and the reading goes on behind it:
 * two characters are one byte, three are two. That is how the desktop's parser
 * reads it (mail-parser; `mail_imap.rs` holds the table `imapClient.test.ts`
 * holds), down to a single character in front of a "=", whose six bits begin a
 * byte there. The end of the data ends a group likewise, as it did with
 * `atob`; a single character left over at the end is no byte. Whatever is not
 * base64 is passed over, as RFC 2045 (6.8) asks and as it always was here.
 *
 * In two things the desktop's parser reads less than this — a last group
 * without its padding, and a part with a character that is no base64 in it:
 * parity catalog, `mail-base64-reading`.
 */
function base64Bytes(s: string): Uint8Array {
  const out = new Uint8Array(Math.ceil((s.length * 3) / 4));
  let length = 0;
  /** The characters of the open group, six bits each, and how many they are. */
  let group = 0;
  let count = 0;
  const endGroup = (): void => {
    if (count === 2) out[length++] = group >> 4;
    else if (count === 3) {
      out[length++] = group >> 10;
      out[length++] = group >> 2;
    }
    group = 0;
    count = 0;
  };
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const value = code < 256 ? BASE64_VALUE[code] : -1;
    if (value >= 0) {
      group = (group << 6) | value;
      if (++count === 4) {
        out[length++] = group >> 16;
        out[length++] = group >> 8;
        out[length++] = group;
        group = 0;
        count = 0;
      }
    } else if (value === BASE64_END) {
      if (count === 1) out[length++] = group << 2;
      endGroup();
    }
  }
  endGroup();
  return length === out.length ? out : out.slice(0, length);
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

function dispositionOf(headers: HeaderMap): string | null {
  return (headers.get("content-disposition") ?? "").split(";")[0].trim().toLowerCase() || null;
}

/** What a reader shows as the words of a message: its plain text or its HTML, unless that is attached as a file. */
function showsAsText(mime: string, disposition: string | null): boolean {
  return (mime === "text/plain" || mime === "text/html") && disposition !== "attachment";
}

/**
 * The delimiter line between the parts of a multipart, in `wireOf` form; null
 * for a part that is none, or that does not name its boundary. The boundary
 * comes from a header that was read as text; the body it divides is bytes.
 */
function delimiterOf(headers: HeaderMap): string | null {
  if (!contentType(headers).startsWith("multipart/")) return null;
  const boundary = parseParams(headers.get("content-type") ?? "").get("boundary");
  return boundary ? "--" + wireOf(boundary) : null;
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
 * Splits a multipart body at its delimiter lines (`delimiterOf`). The parts
 * are cut out of the body as they stand: a part can be a file, and a file's
 * line breaks are its own. Only the line break in front of a delimiter belongs
 * to the delimiter. A body that ends before its closing delimiter — the first
 * bytes of one, for the list — ends its last part where it ends.
 */
function splitMultipart(body: string, marker: string): string[] {
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
      const delimiter = delimiterOf(partHeaders);
      if (!delimiter) return;
      // What lies inside one branch (an HTML part with its images) belongs to that version.
      const alternative = type === "multipart/alternative" ? ++alternatives : 0;
      splitMultipart(partBody, delimiter).forEach((chunk, child) => {
        const sub = splitHeaders(chunk);
        walk(headersOf(sub.head), sub.body, depth + 1, alternative ? [...branches, { alternative, child }] : branches);
      });
      return;
    }
    const disposition = dispositionOf(partHeaders);
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

  const first = parts.findIndex((part) => showsAsText(part.mime, part.disposition));
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

/** A part as it is read: its header, and its body in `wireOf` form. */
interface BodyPart {
  headers: HeaderMap;
  body: string;
}

/** The part that opens a message, where it is one the list cannot read words from. */
const NO_WORDS: BodyPart = { headers: new Map(), body: "" };

/**
 * A cut-off body can end inside the delimiter line behind its last part: "-",
 * "--", "--bn". A last line that is the beginning of that delimiter is taken
 * for it, not for text — in a body that is whole, too, where it cannot be told
 * apart and is no word either.
 */
function withoutCutDelimiter(chunk: string, delimiter: string): string {
  const lineStart = chunk.lastIndexOf("\n") + 1;
  const last = chunk.slice(lineStart);
  return last !== "" && (delimiter + "--").startsWith(last) ? chunk.slice(0, lineStart) : chunk;
}

/**
 * The part whose words open a message, in a body that may be cut off: the
 * first one a reader shows as text, found the way `parseMessage` walks —
 * through every multipart around it, each divided at the delimiter its own
 * header names. `delimiter` is the one of `part` itself, null for a part that
 * is not divided. Null when there is no such part: a message that is a file,
 * an invitation, a picture has no words to open with.
 *
 * The list used to look one level deep (finding 2026-10-12). The text of a
 * mail that also carries a file lies in a multipart of its own — the plain and
 * the HTML version, inside the one that holds the file as well — and the list
 * took that inner multipart for the text: it showed the header lines of its
 * first part, "Content-Type: text/plain; …", where the first words belong. A
 * text file in front of the text was taken for the text, too, and a message
 * that is no text at all showed what it is made of ("BEGIN:VCALENDAR …").
 */
function openingPart(part: BodyPart, delimiter: string | null, depth = 0): BodyPart | null {
  if (depth > 12) return null; // pathological nesting guard
  if (delimiter === null) return showsAsText(contentType(part.headers), dispositionOf(part.headers)) ? part : null;
  const chunks = splitMultipart(part.body, delimiter);
  for (let at = 0; at < chunks.length; at++) {
    const chunk = at === chunks.length - 1 ? withoutCutDelimiter(chunks[at], delimiter) : chunks[at];
    const sub = splitHeaders(chunk);
    if (/^\r?\n/.test(chunk)) {
      // A part that begins with the empty line has no header: an opened
      // message shows it as text, so its words open the message and no later
      // part's do. Header lines a generator wrote behind that empty line are
      // its text in an opened message; the row keeps them off, as it does those
      // at the top of a body, and reads by them what the words are — none, when
      // they name a file. Of a part the bytes end in whose header lines are
      // not finished, it shows nothing: the type may be the next line. That
      // costs a whole last part made of such lines its row, where the closing
      // delimiter is missing. Either way the search ends here, on every level.
      const block = headerBlockAt(sub.body);
      if (block && namesTypeOrEncoding(block.headers)) return openingPart(block, delimiterOf(block.headers), depth + 1) ?? NO_WORDS;
      if (block && !block.finished && at === chunks.length - 1 && part.body.endsWith(chunks[at])) return NO_WORDS;
      return openingPart({ headers: new Map(), body: sub.body }, null, depth + 1);
    }
    const headers = headersOf(sub.head);
    const found = openingPart({ headers, body: sub.body }, delimiterOf(headers), depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * A block of header lines at the very top of a body: up to its first empty
 * line every line is a header line (a field name of printable characters and a
 * colon, or the continuation of one). Null for every other body — a line in the
 * middle of a text that begins like a header field is a line of that text.
 * `finished` says whether an empty line ends the block: one a cut ended has
 * none, and its last line may be half a field name.
 */
function headerBlockAt(body: string): (BodyPart & { finished: boolean }) | null {
  const block = body.replace(/^[\r\n]+/, "");
  const split = splitHeaders(block);
  const lines = split.head.split(/\r?\n/);
  const finished = /\r?\n\r?\n/.test(block);
  const fits = (line: string, at: number): boolean =>
    /^[!-9;-~]+[ \t]*:/.test(line) || (at > 0 && /^[ \t]/.test(line)) || (!finished && at === lines.length - 1 && /^[!-9;-~]*\r?$/.test(line));
  return lines.every(fits) ? { headers: headersOf(split.head), body: split.body, finished } : null;
}

function namesTypeOrEncoding(headers: HeaderMap): boolean {
  return headers.has("content-type") || headers.has("content-transfer-encoding");
}

/** A body that begins with a header block of its own (`headerBlockAt`) that names a type or a transfer encoding. */
function ownHeader(body: string): BodyPart | null {
  const block = headerBlockAt(body);
  return block && namesTypeOrEncoding(block.headers) ? block : null;
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
 *
 * WHICH part's words open the message is read the way an opened message is
 * read (`openingPart`), from the same header: what the body is, whether it is
 * divided into parts and at which line stands in the message's Content-Type.
 * A body that header calls a text is not searched for parts, and neither is
 * the body of a message that has no Content-Type at all — it is a text by
 * rule: the "---" line of a bounce and the header lines it quotes are its
 * words. Two things are still read from the look of the body's own lines:
 *  - a block of header lines at its very top that names a type or a transfer
 *    encoding is taken for its header (`ownHeader`: a header an empty line has
 *    cut in two, or one a server sent along with the text), and so is such a
 *    block at the top of a part, behind the empty line the part begins with (a
 *    generator's mistake). An opened message shows such lines as text; the
 *    list keeps them off the row;
 *  - where no header field of the message came along at all (a caller that
 *    has none), a delimiter line with part headers behind it divides the body.
 */
export function previewFromBodyPrefix(raw: Uint8Array | string, max = 160, message: HeaderMap = new Map()): string {
  const prefix = wireOf(raw);
  if (!prefix.trim()) return "";

  let whole: BodyPart = { headers: message, body: prefix };
  let delimiter = delimiterOf(message);
  if (delimiter === null) {
    const own = ownHeader(prefix);
    if (own) {
      whole = own;
      delimiter = delimiterOf(own.headers);
    } else if (message.size === 0) {
      const line = /^--[^\r\n]+$/m.exec(prefix);
      if (line && /content-type\s*:/i.test(prefix)) delimiter = withoutPadding(line[0]);
    }
  }
  // Anything past the truncation point simply is not there — then the preview
  // stays empty, which is honest.
  const opening = openingPart(whole, delimiter);
  if (!opening) return "";
  const { headers, body } = opening;

  // A truncated base64 part cannot be decoded safely (the tail is a partial
  // group) — better no preview than mojibake.
  const encoding = (headers.get("content-transfer-encoding") ?? "").trim().toLowerCase();
  if (encoding === "base64") return "";
  // A prefix cut inside an escape ends in "=" or "=X": no text, and the byte
  // in front of it may be half a character, which the decoding below drops.
  const bytes = encoding === "quoted-printable" ? qpBytes(body.replace(/=[0-9A-Fa-f]?$/, "")) : wireBytes(body);
  let text = decodeCharset(headers, bytes, true);

  if ((headers.get("content-type") ?? "").includes("text/html") || /<\/?(p|div|br|span|table)\b/i.test(text)) {
    // The cut can fall inside a tag or a character reference. What stands at
    // the very end as the beginning of one — "<", "</p", "&nbs" — is taken for
    // what a cut left, and is no word in a text that is whole either.
    text = htmlToPlainText(text.replace(/<(?:[/!?]?[A-Za-z][^<>]*|[/!?]?)$/, "").replace(/&#?[A-Za-z0-9]*$/, ""));
  }

  const flat = text
    .replace(/^--[^\r\n]*$/gm, " ") // a line that begins like a delimiter: one nothing said is one, or a signature's
    .replace(/\s+/g, " ")
    .trim();
  // No letters or digits at all means we hit plumbing, not prose.
  if (!/[\p{L}\p{N}]/u.test(flat)) return "";
  return flat.length > max ? flat.slice(0, max).trimEnd() + "…" : flat;
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
