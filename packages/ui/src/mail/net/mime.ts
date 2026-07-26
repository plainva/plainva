import type { MailAttachmentInfo } from "../types";

/**
 * The MIME reading side of the mobile mail client (mail feinplan G2).
 *
 * The desktop gets parsed messages back from Rust; on mobile the raw RFC 822
 * bytes come off the socket, so the parsing happens here — once, in shared
 * code, rather than twice in Java and Swift.
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
  for (const chunk of value.split(";").slice(1)) {
    const i = chunk.indexOf("=");
    if (i < 0) continue;
    const k = chunk.slice(0, i).trim().toLowerCase();
    let v = chunk.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out.set(k, decodeWords(v));
  }
  return out;
}

function contentType(headers: Map<string, string>): string {
  return (headers.get("content-type") ?? "text/plain").split(";")[0].trim().toLowerCase();
}

function decodeBody(headers: Map<string, string>, body: string): Uint8Array {
  const encoding = (headers.get("content-transfer-encoding") ?? "7bit").trim().toLowerCase();
  if (encoding === "base64") return base64Bytes(body);
  if (encoding === "quoted-printable") return qpBytes(body);
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff;
  return out;
}

function decodeText(headers: Map<string, string>, body: string): string {
  const charset = parseParams(headers.get("content-type") ?? "").get("charset") ?? "utf-8";
  return dec(charset).decode(decodeBody(headers, body));
}

/** Splits a multipart body on its boundary. */
function splitMultipart(body: string, boundary: string): string[] {
  const marker = "--" + boundary;
  const parts: string[] = [];
  const lines = body.split(/\r?\n/);
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.trimEnd() === marker) {
      if (current) parts.push(current.join("\r\n"));
      current = [];
      continue;
    }
    if (line.trimEnd() === marker + "--") {
      if (current) parts.push(current.join("\r\n"));
      current = null;
      break;
    }
    if (current) current.push(line);
  }
  if (current) parts.push(current.join("\r\n"));
  return parts;
}

/**
 * Parses a raw RFC 822 message into the shape the shared mail client already
 * speaks (text, html, attachment list). Deliberately tolerant: a malformed
 * part must never lose the rest of the message.
 */
export function parseMessage(raw: string): ParsedMessage {
  const { head, body } = splitHeaders(raw);
  const headers = parseHeaders(head);
  const parts: ParsedPart[] = [];
  let index = 0;

  const walk = (partHeaders: Map<string, string>, partBody: string, depth: number): void => {
    if (depth > 12) return; // pathological nesting guard
    const type = contentType(partHeaders);
    if (type.startsWith("multipart/")) {
      const boundary = parseParams(partHeaders.get("content-type") ?? "").get("boundary");
      if (!boundary) return;
      for (const chunk of splitMultipart(partBody, boundary)) {
        const sub = splitHeaders(chunk);
        walk(parseHeaders(sub.head), sub.body, depth + 1);
      }
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
  };

  walk(headers, body, 0);

  const text = parts.find((p) => p.mime === "text/plain" && p.text !== null)?.text ?? null;
  const html = parts.find((p) => p.mime === "text/html" && p.text !== null)?.text ?? null;
  const attachments: MailAttachmentInfo[] = parts
    .filter((p) => p.bytes !== null && (p.disposition === "attachment" || p.name !== null))
    .map((p) => ({ index: p.index, name: p.name ?? `part-${p.index}`, mime: p.mime, size: p.bytes?.length ?? 0 }));

  return { headers, text, html, attachments, parts };
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
