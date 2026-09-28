/**
 * The description of a calendar event, read for display (plan Befunde 24.09.,
 * E25) — one model for the desktop preview and the phone's sheet.
 *
 * The text is FOREIGN input: whoever sent the invitation wrote it, and a
 * provider turned their HTML into Markdown (`htmlToMarkdown`). So it is parsed
 * here by a small tokenizer that only ever moves forward — every delimiter is
 * found through a lookup table built once per line (or, for an autolink, by a
 * scan that ends at the next opener), and an opener without its closer becomes
 * text instead of a rescan. No regular expression walks the
 * text; nothing a sender writes can make the preview hang (the reason the
 * description must not go through `markdownToHtml`, whose list grammar and
 * checkbox reader were the ReDoS findings of § 1.10).
 *
 * What it understands is what invitations contain: paragraphs and line breaks,
 * list items, headings, `**strong**`, `*emphasis*`, `code`, Markdown links,
 * `<autolinks>` and bare addresses. Images are shown by their alt text — a
 * preview does not load a stranger's pictures. Everything else is text.
 *
 * Links: only http(s) becomes a link. What a link SHOWS is the host it leads
 * to, because a Teams invitation's addresses are pages of percent-encoding.
 * A Microsoft Safe Link shows the host of its TARGET and says it goes through
 * Safe Links — but what opens is the original Safe Link, always: the check
 * the organisation put in front of the target is not ours to skip.
 */

export type EventDescInline =
  | { kind: "text"; text: string }
  | { kind: "strong" | "em"; children: EventDescInline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; link: EventLinkView; label: string | null };

export type EventDescBlock =
  | { kind: "p"; lines: EventDescInline[][] }
  | { kind: "h"; inline: EventDescInline[] }
  | { kind: "ul"; items: EventDescInline[][] };

export interface EventLinkView {
  /** What opens — ALWAYS the address as written, a Safe Link included. */
  href: string;
  /** What the chip shows: the host the link leads to. */
  host: string;
  /** The full destination for the tooltip (a Safe Link's target), shortened. */
  tip: string;
  /** The address is a Microsoft Safe Link; `host` and `tip` name its target. */
  viaSafeLinks: boolean;
}

const MAX_TIP = 96;
const MAX_DEPTH = 3;
/** Far beyond any invitation; what is longer is cut rather than laid out. */
const MAX_TEXT = 200_000;

/** Hosts of Microsoft's Safe Links rewriter (commercial and US government clouds). */
const SAFE_LINK_SUFFIXES = [".safelinks.protection.outlook.com", ".safelinks.protection.office365.us"];

function httpUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

/** Cuts a long address to a readable tooltip, keeping its start. */
export function shortenUrl(url: string, max = MAX_TIP): string {
  return url.length > max ? `${url.slice(0, max - 1)}…` : url;
}

/**
 * How a link is shown — or `null` when it is not an http(s) address and must
 * stay text (`javascript:`, `data:`, `file:`, `mailto:` …).
 */
export function describeEventLink(href: string): EventLinkView | null {
  const url = httpUrl(href.trim());
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  if (SAFE_LINK_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    const target = httpUrl(url.searchParams.get("url") ?? "");
    if (target) {
      return { href: href.trim(), host: target.hostname, tip: shortenUrl(target.href), viaSafeLinks: true };
    }
  }
  return { href: href.trim(), host: url.hostname, tip: shortenUrl(url.href), viaSafeLinks: false };
}

/** Which online-meeting service a join link belongs to, by the host it leads to. */
const JOIN_SERVICES: ReadonlyArray<{ suffix: string; name: string }> = [
  { suffix: "teams.microsoft.com", name: "Teams" },
  { suffix: "teams.live.com", name: "Teams" },
  { suffix: "meet.google.com", name: "Meet" },
  { suffix: "zoom.us", name: "Zoom" },
  { suffix: "zoomgov.com", name: "Zoom" },
  { suffix: "webex.com", name: "Webex" },
  { suffix: "gotomeeting.com", name: "GoTo" },
  { suffix: "whereby.com", name: "Whereby" },
  { suffix: "jitsi.org", name: "Jitsi" },
];

export interface MeetingJoin {
  /** The link as synced — opened unchanged, like every other link. */
  href: string;
  /** The service by name when it is known ("Teams"), else null. */
  service: string | null;
}

/** The "Join" button of an event: only for an http(s) `meetingUrl`. */
export function meetingJoinOf(meetingUrl: string | undefined | null): MeetingJoin | null {
  if (!meetingUrl) return null;
  const view = describeEventLink(meetingUrl);
  if (!view) return null;
  const host = view.host.toLowerCase();
  const known = JOIN_SERVICES.find((s) => host === s.suffix || host.endsWith(`.${s.suffix}`));
  return { href: view.href, service: known ? known.name : null };
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/** ASCII punctuation — what a backslash may escape (CommonMark). */
function isPunct(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || ch === " " || ch === "\t";
}

/**
 * For each position, the next UNESCAPED occurrence of `ch` at or after it
 * (`-1` = none). Built once per line, right to left — every lookup after that
 * is O(1), which is what keeps a line of a thousand unmatched `[` linear.
 */
function nextTable(text: string, ch: string, escaped: boolean[]): Int32Array {
  const next = new Int32Array(text.length + 1).fill(-1);
  for (let i = text.length - 1; i >= 0; i--) next[i] = text[i] === ch && !escaped[i] ? i : next[i + 1];
  return next;
}

interface Scan {
  text: string;
  escaped: boolean[];
  close: { bracket: Int32Array; paren: Int32Array; tick: Int32Array; star: Int32Array };
}

function scanOf(text: string): Scan {
  const escaped = new Array<boolean>(text.length).fill(false);
  for (let i = 1; i < text.length; i++) escaped[i] = text[i - 1] === "\\" && !escaped[i - 1] && isPunct(text[i]);
  return {
    text,
    escaped,
    close: {
      bracket: nextTable(text, "]", escaped),
      paren: nextTable(text, ")", escaped),
      tick: nextTable(text, "`", escaped),
      star: nextTable(text, "*", escaped),
    },
  };
}

/** Removes the escaping backslashes of a label or text run. */
function unescape(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length && isPunct(text[i + 1])) {
      out += text[i + 1];
      i++;
    } else {
      out += text[i];
    }
  }
  return out;
}

function pushText(out: EventDescInline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === "text") last.text += text;
  else out.push({ kind: "text", text });
}

/** A label that merely repeats an address adds nothing to the host chip. */
function meaningfulLabel(label: string, href: string): string | null {
  const clean = label.trim();
  if (!clean || clean === href || /^https?:\/\//i.test(clean)) return null;
  return clean;
}

const TRAILING_PUNCT = ").,;:!?'\"";

/** End of a bare address starting at `from`: up to whitespace or `<>"`, minus trailing punctuation. */
function bareUrlEnd(text: string, from: number, to: number): number {
  let end = from;
  while (end < to && !" \t<>\"".includes(text[end])) end++;
  while (end > from && TRAILING_PUNCT.includes(text[end - 1])) end--;
  return end;
}

function startsWithHttp(text: string, at: number): boolean {
  const head = text.slice(at, at + 8).toLowerCase();
  return head.startsWith("http://") || head.startsWith("https://");
}

/**
 * Inline content of `scan.text[from, to)`. Every branch either consumes a
 * construct whose closer the tables already located, or emits one character
 * as text and moves on — nothing is scanned twice at the same depth.
 */
function parseInline(scan: Scan, from: number, to: number, depth: number): EventDescInline[] {
  const { text, escaped, close } = scan;
  const out: EventDescInline[] = [];
  let run = from; // start of the pending plain-text run
  const flush = (at: number) => {
    if (at > run) pushText(out, unescape(text.slice(run, at)));
  };
  let i = from;
  while (i < to) {
    const ch = text[i];
    if (escaped[i]) {
      i++;
      continue;
    }
    // Code span: backslashes inside are literal.
    if (ch === "`") {
      const end = close.tick[i + 1];
      if (end !== -1 && end < to && end > i + 1) {
        flush(i);
        out.push({ kind: "code", text: text.slice(i + 1, end) });
        i = run = end + 1;
        continue;
      }
    }
    // Link or image: [label](dest) / ![alt](dest)
    if (ch === "[" || (ch === "!" && text[i + 1] === "[" && !escaped[i + 1])) {
      const open = ch === "!" ? i + 1 : i;
      const labelEnd = close.bracket[open + 1];
      if (labelEnd !== -1 && labelEnd < to && text[labelEnd + 1] === "(") {
        const destEnd = close.paren[labelEnd + 2];
        if (destEnd !== -1 && destEnd < to) {
          const label = unescape(text.slice(open + 1, labelEnd));
          // A destination may carry Markdown escapes too; the address is without them.
          const dest = unescape(text.slice(labelEnd + 2, destEnd).trim().split(" ")[0] ?? "");
          flush(i);
          if (ch === "!") {
            // An image: its words, never its pixels.
            pushText(out, label.trim());
          } else {
            const link = describeEventLink(dest);
            if (link) out.push({ kind: "link", link, label: meaningfulLabel(label, dest) });
            else pushText(out, label.trim() || dest);
          }
          i = run = destEnd + 1;
          continue;
        }
      }
    }
    // Autolink: <https://…>. It holds no whitespace and no `<` (CommonMark), so
    // the search for its `>` stops at the first of them: every `<` looks only
    // as far as the next one. Looking up the next `>` anywhere in the line
    // instead made each of ten thousand `<https://a ` read the rest of the line
    // again — quadratic, seconds for a long enough invitation.
    if (ch === "<" && startsWithHttp(text, i + 1)) {
      let end = i + 1;
      while (end < to && text[end] !== ">" && text[end] !== "<" && !isSpace(text[end])) end++;
      if (end < to && text[end] === ">" && !escaped[end]) {
        const link = describeEventLink(unescape(text.slice(i + 1, end)));
        if (link) {
          flush(i);
          out.push({ kind: "link", link, label: null });
          i = run = end + 1;
          continue;
        }
      }
    }
    // Bare address, not glued to a preceding word.
    if ((ch === "h" || ch === "H") && startsWithHttp(text, i) && (i === from || !/[A-Za-z0-9]/.test(text[i - 1]))) {
      const end = bareUrlEnd(text, i, to);
      // `htmlToMarkdown` escapes the underscores of an address it found as text
      // (`a\_b`); a browser would read that backslash as a slash.
      const link = describeEventLink(unescape(text.slice(i, end)));
      if (link) {
        flush(i);
        out.push({ kind: "link", link, label: null });
        i = run = end;
        continue;
      }
      // Not an address after all: the whole candidate stays text. Moving on by
      // one character would scan the same run again from its next "http".
      i = Math.max(end, i + 1);
      continue;
    }
    // **strong** and *emphasis*: the NEXT unescaped star run closes; an opener
    // followed by a space, or without a closer, is text.
    if (ch === "*" && depth < MAX_DEPTH) {
      const double = text[i + 1] === "*" && !escaped[i + 1];
      const innerStart = i + (double ? 2 : 1);
      if (!isSpace(text[innerStart])) {
        let end = close.star[innerStart];
        if (double) {
          // The closer of `**` is the next unescaped `**`.
          while (end !== -1 && end < to && !(text[end + 1] === "*" && !escaped[end + 1])) end = close.star[end + 1];
        }
        if (end !== -1 && end < to && end > innerStart && !isSpace(text[end - 1])) {
          flush(i);
          out.push({ kind: double ? "strong" : "em", children: parseInline(scan, innerStart, end, depth + 1) });
          i = run = end + (double ? 2 : 1);
          continue;
        }
      }
      // Skip the whole star run so `***` is not tried three times.
      while (i < to && text[i] === "*") i++;
      continue;
    }
    i++;
  }
  flush(to);
  return out;
}

function inlineOf(line: string): EventDescInline[] {
  return parseInline(scanOf(line), 0, line.length, 0);
}

/** `- item`, `* item`, `+ item`, `1. item` → the item's text; else null. */
function listItem(line: string): string | null {
  const t = line.trimStart();
  if ((t[0] === "-" || t[0] === "*" || t[0] === "+") && t[1] === " ") return t.slice(2);
  let d = 0;
  while (d < t.length && d < 9 && t.charCodeAt(d) >= 48 && t.charCodeAt(d) <= 57) d++;
  if (d > 0 && (t[d] === "." || t[d] === ")") && t[d + 1] === " ") return t.slice(d + 2);
  return null;
}

/** `# Heading` (1–6 hashes and a space) → its text; else null. */
function heading(line: string): string | null {
  let h = 0;
  while (h < line.length && h < 7 && line[h] === "#") h++;
  return h >= 1 && h <= 6 && line[h] === " " ? line.slice(h + 1).trim() : null;
}

/** A line that only draws a rule (`---`, `___`, `***`, escaped or not). */
function isRule(line: string): boolean {
  const t = unescape(line.trim()).replace(/\s/g, "");
  if (t.length < 3) return false;
  const c = t[0];
  if (c !== "-" && c !== "_" && c !== "*") return false;
  for (const ch of t) if (ch !== c) return false;
  return true;
}

/** The description as blocks, ready to render. Empty input gives `[]`. */
export function parseEventDescription(input: string | undefined | null): EventDescBlock[] {
  if (!input) return [];
  const text = input.length > MAX_TEXT ? `${input.slice(0, MAX_TEXT)}…` : input;
  const blocks: EventDescBlock[] = [];
  let para: EventDescInline[][] | null = null;
  let list: EventDescInline[][] | null = null;
  const end = () => {
    para = null;
    list = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim() || isRule(line)) {
      end();
      continue;
    }
    const h = heading(line);
    if (h !== null) {
      end();
      blocks.push({ kind: "h", inline: inlineOf(h) });
      continue;
    }
    const item = listItem(line);
    if (item !== null) {
      para = null;
      if (!list) {
        list = [];
        blocks.push({ kind: "ul", items: list });
      }
      list.push(inlineOf(item));
      continue;
    }
    list = null;
    if (!para) {
      para = [];
      blocks.push({ kind: "p", lines: para });
    }
    para.push(inlineOf(line.trim()));
  }
  return blocks;
}
