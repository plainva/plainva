import { parseDocument, stringify } from "yaml";
import { sha256Hex, utf8Encode } from "./encoding.js";
import { protocolAssert } from "./errors.js";
import { nextWhere } from "../linkScan.js";
import type { WorkspaceCapability } from "./documents.js";
import type { WorkspaceListPage, WorkspaceObjectInfo, WorkspaceObjectStore, WorkspaceRequestOptions } from "./objectStore.js";

export type PublishedSliceAccess = "read" | "comment" | "suggest";
export type PublishedSliceMode = "exact" | "sanitized";
export type PublishedSliceProvider = "google-drive" | "onedrive" | "nextcloud" | "dropbox" | "webdav" | "s3";

export interface PublishedSliceConfig {
  publicationId: string;
  sliceId: string;
  name: string;
  mode: PublishedSliceMode;
  access: PublishedSliceAccess;
  provider: PublishedSliceProvider;
  propertyAllowlist: string[] | null;
  privateProperties: string[];
  createdAt: string;
}

export interface PublishedSliceProjectionReport {
  removedProperties: string[];
  neutralizedLinks: string[];
  removedEmbeds: string[];
}

export interface PublishedSliceProjection {
  markdown: string;
  report: PublishedSliceProjectionReport;
}

/**
 * Capabilities granted inside an independent published-slice workspace.
 * Suggestions are append-only proposal objects and never grant write/delete
 * access to the projected source content.
 */
export function publishedSliceAccessCapabilities(access: PublishedSliceAccess): WorkspaceCapability[] {
  const capabilities: WorkspaceCapability[] = ["comment.read", "content.read", "history.read"];
  if (access === "comment" || access === "suggest") capabilities.push("comment.create");
  if (access === "suggest") capabilities.push("comment.suggest");
  return capabilities.sort();
}

/**
 * What a published note may carry in its frontmatter (decision E5).
 *
 * Until S3 both shells passed `propertyAllowlist: null` plus the same copied
 * denylist - `["apiKey", "password", "private", "secret", "token"]` - and a
 * denylist is the wrong shape for this job: it has to guess every name a leak
 * could hide behind, and two things PLAINVA ITSELF writes defeat it without
 * containing any of those words.
 *
 * - The `plainva` namespace carries a `ProviderTaskAnchor` whose `identity` is
 *   documented as the verified account identity ("issuer:subject") of the
 *   provider account the task was mirrored from - the publisher's Google or
 *   Microsoft account, in a note that is about to be handed to strangers.
 * - OKF v0.2 `sources` carries the RFC Message-ID of the private mail a note
 *   was captured from.
 *
 * Neither is a secret by name, and neither would ever have been added to a
 * denylist by someone who had not gone looking. An allowlist inverts the
 * failure: a property nobody thought about stays home, and the cost is that a
 * deliberate custom property has to be named - which is why S3 also puts a
 * PREVIEW in front of publishing, so the removals are visible before anything
 * leaves the vault.
 *
 * `verified` is on the list although it can read `human:<name>`: a review note
 * is provenance the author wrote on purpose, and the preview shows it.
 * `sources` is deliberately NOT on the list.
 */
export const DEFAULT_PUBLISHED_PROPERTY_ALLOWLIST: readonly string[] = [
  "aliases",
  "author",
  "category",
  "cover",
  "created",
  "date",
  "description",
  "due",
  "end",
  "generated",
  "lang",
  "language",
  "modified",
  "stale_after",
  "start",
  "status",
  "summary",
  "tags",
  "title",
  "type",
  "updated",
  "verified",
];

/**
 * The second line, kept because the first one can be widened.
 *
 * These five are what both shells shipped as their whole policy, and on their
 * own they never carried the weight: see the allowlist above for the two things
 * Plainva writes that walk straight past them. They stay because the allowlist
 * is the part a user can widen - naming a deliberate custom property in the
 * publication form - and a name that means "secret" should not become
 * publishable just because somebody widened the list around it.
 */
export const DEFAULT_PUBLISHED_PRIVATE_PROPERTIES: readonly string[] = [
  "apiKey",
  "password",
  "private",
  "secret",
  "token",
];

/**
 * The publication property policy, in one place instead of two copies.
 *
 * Both shells used to write the same two literals into every publication they
 * created, which is how a policy drifts: the copies are equal until somebody
 * edits one of them.
 *
 * `propertyAllowlist` is stored as `null` ON PURPOSE rather than materialised.
 * A stored list would freeze a publication on the policy of the day it was
 * created - so a property added to the default list later, because it turned
 * out to leak, would keep leaking from every publication that already exists.
 * `null` means "follow the policy", and the policy is code.
 */
export function defaultPublishedPropertyPolicy(): { propertyAllowlist: null; privateProperties: string[] } {
  return { propertyAllowlist: null, privateProperties: [...DEFAULT_PUBLISHED_PRIVATE_PROPERTIES] };
}

/**
 * Compares property names the way a human means them.
 *
 * `stale_after`, `staleAfter` and `Stale-After` are the same field to everyone
 * except a string comparison, and a policy that only matches one spelling is a
 * policy with a hole in it.
 */
export function normalizePropertyKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, "");
}

function linkTarget(value: string): string {
  const target = value.split("#", 1)[0].trim().replace(/\\/g, "/");
  return target.toLowerCase().endsWith(".md") ? target.slice(0, -3) : target;
}

/**
 * The slice as a lookup instead of a list.
 *
 * The previous fallback re-materialised and re-normalised the whole slice for
 * every single link (`[...included].some(...)`), which is quadratic in a note
 * with many links. Normalising once on the way in is exactly equivalent:
 * `linkTarget` is idempotent, so the old three branches - raw hit, raw+".md"
 * hit, and the normalised scan - all collapse into one membership test.
 */
function includedIndex(paths: Iterable<string>): Set<string> {
  const index = new Set<string>();
  for (const path of paths) index.add(linkTarget(path.replace(/\\/g, "/")));
  return index;
}

function isIncluded(target: string, index: Set<string>): boolean {
  return index.has(linkTarget(target));
}

const SPACE = /\s/;
const LINE_TERMINATORS = "\n\r\u2028\u2029";

/**
 * A fence line: `^ {0,3}(`{3,}|~{3,})(.*)$`, read by hand (plan Befunde
 * 24.09., E6) — the pattern gave a long run of backticks back one at a time
 * before it failed. Up to three spaces, a run of three or more of one fence
 * character, and the rest of the line as the info string. `.` matches no line
 * terminator, so a line that still carries one — the `\r` of a CRLF note —
 * is no fence, as it never was.
 */
function fenceOf(line: string): { char: string; length: number; info: string } | null {
  let at = 0;
  while (at < 3 && line[at] === " ") at++;
  const char = line[at];
  if (char !== "`" && char !== "~") return null;
  let end = at;
  while (line[end] === char) end++;
  if (end - at < 3) return null;
  const info = line.slice(end);
  for (let i = 0; i < info.length; i++) if (LINE_TERMINATORS.includes(info[i])) return null;
  return { char, length: end - at, info };
}

/**
 * Where fenced code blocks sit, so the projection can leave them alone.
 *
 * A link inside a fence is almost always a documented EXAMPLE, and rewriting it
 * corrupts the thing the block exists to show. The tradeoff is deliberate and
 * runs the other way for `[[Private|alias]]`: outside a fence the neutralised
 * form shows only "alias", inside one the full target stays visible. A fence is
 * a quotation, and quoting a path is not the same as linking to it.
 *
 * INDENTED code blocks are deliberately not detected: four spaces inside a list
 * item is ordinary content, and a false positive there would silently skip a
 * link that has to be neutralised. A missed example is cosmetic; a missed leak
 * is not.
 */
function fencedRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let open: { char: string; length: number; start: number } | null = null;
  for (const line of markdown.split("\n")) {
    const lineEnd = offset + line.length + 1;
    const fence = fenceOf(line);
    if (!open) {
      // A backtick fence may not carry a backtick in its info string
      // (CommonMark), which keeps a prose line like "``` and `code`" from
      // opening a block that never closes.
      if (fence && !(fence.char === "`" && fence.info.includes("`"))) {
        open = { char: fence.char, length: fence.length, start: offset };
      }
    } else if (fence && fence.char === open.char && fence.length >= open.length && fence.info.trim() === "") {
      ranges.push([open.start, Math.min(lineEnd, markdown.length)]);
      open = null;
    }
    offset = lineEnd;
  }
  // An unterminated fence runs to the end of the file, exactly as a renderer
  // reads it.
  if (open) ranges.push([open.start, markdown.length]);
  return ranges;
}

/**
 * Whether offsets, asked in rising order, stand inside a fence. The ranges
 * come sorted and apart, so one pointer walks them once — asking every range
 * for every link was quadratic in a note of many fences and links (E6).
 */
function insideFences(ranges: Array<[number, number]>): (offset: number) => boolean {
  let at = 0;
  return (offset) => {
    while (at < ranges.length && ranges[at][1] <= offset) at++;
    return at < ranges.length && ranges[at][0] <= offset;
  };
}

/** One match of a link shape: where it stands and what its groups captured (undefined: did not take part). */
interface LinkMatch {
  index: number;
  end: number;
  groups: Array<string | undefined>;
}

/** Every match of a link shape in a text, left to right, as a global pattern finds them. */
type LinkScanner = (text: string) => Iterable<LinkMatch>;

/**
 * One replace pass that skips fenced code.
 *
 * The ranges are measured inside, per call, and never hoisted: every match
 * carries an offset into the text this pass was called on, so a pass that ran
 * after an earlier one edited the text needs its own measurement.
 */
function replaceOutsideFences(
  markdown: string,
  scan: LinkScanner,
  replacer: (whole: string, groups: Array<string | undefined>) => string,
): string {
  const fenced = insideFences(fencedRanges(markdown));
  const pieces: string[] = [];
  let cursor = 0;
  for (const match of scan(markdown)) {
    const whole = markdown.slice(match.index, match.end);
    pieces.push(markdown.slice(cursor, match.index), fenced(match.index) ? whole : replacer(whole, match.groups));
    cursor = match.end;
  }
  pieces.push(markdown.slice(cursor));
  return pieces.join("");
}

/** A pattern that stays a pattern (no quadratic reading), as a scanner. */
function patternScanner(pattern: RegExp): LinkScanner {
  return function* (text) {
    for (const match of text.matchAll(pattern)) {
      yield { index: match.index, end: match.index + match[0].length, groups: match.slice(1) };
    }
  };
}

/** Every match of `matchAt` left to right; after a match the scan goes on behind it. */
function* scanFrom(text: string, matchAt: (at: number) => LinkMatch | null): Generator<LinkMatch> {
  for (let at = 0; at < text.length; ) {
    const match = matchAt(at);
    if (match) {
      yield match;
      at = match.end;
    } else at++;
  }
}

/** The first of several optional capture groups that actually matched. */
function firstDefined(...values: Array<string | undefined>): string {
  for (const value of values) if (value !== undefined) return value;
  return "";
}

/**
 * Anything that points outside the vault and is therefore none of our business.
 *
 * The scheme needs at least two characters on purpose: a single letter would
 * make a stray absolute Windows path (`C:/notes/private.md`) look like a URI
 * scheme, and "external" means "left untouched" - the leaky direction.
 */
const EXTERNAL_TARGET = /^(?:[a-z][a-z0-9+.-]+:|\/\/|#)/i;

/*
 * The link shapes below were global patterns, and each looked for its closing
 * bracket again from every `[` (the HTML ones for `>` from every candidate
 * attribute): a note with a long run of `[` took quadratic time to publish
 * (plan Befunde 24.09., E6). Each scanner reads its old pattern by hand,
 * decision for decision; a part that cannot hold its own closer ends at the
 * first one, so no position needs a second reading, and the cursors of
 * `nextWhere` read every character once however many starts ask.
 */

/** `(!?)` — the `!` in front belongs to the match, and a `!` alone is no `[`. */
const openAfterBang = (text: string, at: number) => (text[at] === "!" ? at + 1 : at);

/** `(!?)\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]` */
const wikiLinks: LinkScanner = (text) => {
  const n = text.length;
  const targetEnd = nextWhere(n, (i) => text[i] === "]" || text[i] === "|" || text[i] === "#");
  const anchorEnd = nextWhere(n, (i) => text[i] === "]" || text[i] === "|");
  const aliasEnd = nextWhere(n, (i) => text[i] === "]");
  return scanFrom(text, (at) => {
    const open = openAfterBang(text, at);
    if (text[open] !== "[" || text[open + 1] !== "[") return null;
    const from = open + 2;
    const target = targetEnd(from);
    if (target === from) return null;
    let end = target;
    let anchor: string | undefined;
    let alias: string | undefined;
    if (text[end] === "#") {
      const stop = anchorEnd(end + 1);
      if (stop === end + 1) return null;
      anchor = text.slice(end, stop);
      end = stop;
    }
    if (text[end] === "|") {
      const stop = aliasEnd(end + 1);
      if (stop === end + 1) return null;
      alias = text.slice(end + 1, stop);
      end = stop;
    }
    if (text[end] !== "]" || text[end + 1] !== "]") return null;
    return { index: at, end: end + 2, groups: [open > at ? "!" : "", text.slice(from, target), anchor, alias] };
  });
};

/** `(!?)\[([^\]]*)\]\(\s*(?:<([^>\n]*)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)` */
const inlineLinks: LinkScanner = (text) => {
  const n = text.length;
  const isSpace = (i: number) => i < n && SPACE.test(text[i]);
  const skipSpace = (i: number) => {
    while (isSpace(i)) i++;
    return i;
  };
  const labelEnd = nextWhere(n, (i) => text[i] === "]");
  const destinationStart = nextWhere(n, (i) => !isSpace(i));
  const angledEnd = nextWhere(n, (i) => text[i] === ">" || text[i] === "\n");
  const bareEnd = nextWhere(n, (i) => text[i] === ")" || isSpace(i));
  // After a destination: an optional title, blanks, `)` — the match end, or -1.
  // A destination ends before a blank run's first character or after a `>`,
  // so each run and each title is read once; the map keeps it that way.
  const closes = new Map<number, number>();
  const closeAfter = (at: number): number => {
    const known = closes.get(at);
    if (known !== undefined) return known;
    let end = -1;
    const title = skipSpace(at);
    if (title > at) {
      const quote = text[title];
      let close = -1;
      if (quote === "\"" || quote === "'") close = text.indexOf(quote, title + 1);
      else if (quote === "(") {
        let i = title + 1;
        while (i < n && text[i] !== "(" && text[i] !== ")") i++;
        if (text[i] === ")") close = i;
      }
      if (close >= 0) {
        const paren = skipSpace(close + 1);
        if (text[paren] === ")") end = paren + 1;
      }
    }
    if (end < 0 && text[title] === ")") end = title + 1;
    closes.set(at, end);
    return end;
  };
  // Everything after `](` depends on where it starts alone, and every `[`
  // before the same `]` asks the same question: the last answer is kept.
  let tailAt = -1;
  let tail: { end: number; angled?: string; bare?: string } | null = null;
  const tailFrom = (at: number): typeof tail => {
    const start = destinationStart(at);
    if (text[start] === "<") {
      const close = angledEnd(start + 1);
      if (text[close] === ">") {
        const end = closeAfter(close + 1);
        if (end >= 0) return { end, angled: text.slice(start + 1, close) };
      }
    }
    const stop = bareEnd(start);
    if (stop > start) {
      const end = closeAfter(stop);
      if (end >= 0) return { end, bare: text.slice(start, stop) };
    }
    return null;
  };
  return scanFrom(text, (at) => {
    const open = openAfterBang(text, at);
    if (text[open] !== "[") return null;
    const close = labelEnd(open + 1);
    if (text[close] !== "]" || text[close + 1] !== "(") return null;
    if (close + 2 !== tailAt) {
      tailAt = close + 2;
      tail = tailFrom(tailAt);
    }
    if (!tail) return null;
    return { index: at, end: tail.end, groups: [open > at ? "!" : "", text.slice(open + 1, close), tail.angled, tail.bare] };
  });
};

/** `(!?)\[([^\]\n]*)\]\[([^\]\n]*)\]` */
const referenceLinks: LinkScanner = (text) => {
  const stop = (i: number) => text[i] === "]" || text[i] === "\n";
  const labelEnd = nextWhere(text.length, stop);
  const refEnd = nextWhere(text.length, stop);
  return scanFrom(text, (at) => {
    const open = openAfterBang(text, at);
    if (text[open] !== "[") return null;
    const close = labelEnd(open + 1);
    if (text[close] !== "]" || text[close + 1] !== "[") return null;
    const end = refEnd(close + 2);
    if (text[end] !== "]") return null;
    return { index: at, end: end + 1, groups: [open > at ? "!" : "", text.slice(open + 1, close), text.slice(close + 2, end)] };
  });
};

/** `(!?)\[([^\]\n]+)\](?![[(:])` */
const shortcutLinks: LinkScanner = (text) => {
  const labelEnd = nextWhere(text.length, (i) => text[i] === "]" || text[i] === "\n");
  return scanFrom(text, (at) => {
    const open = openAfterBang(text, at);
    if (text[open] !== "[") return null;
    const close = labelEnd(open + 1);
    const after = text[close + 1];
    if (close === open + 1 || text[close] !== "]" || after === "[" || after === "(" || after === ":") return null;
    return { index: at, end: close + 1, groups: [open > at ? "!" : "", text.slice(open + 1, close)] };
  });
};

const LINK_DEFINITION =
  /^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]*)>|(\S+))(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*(?:\r?\n|$)/gm;

const WORD = /[A-Za-z0-9_]/;
const isWord = (ch: string | undefined) => ch !== undefined && WORD.test(ch);
/** `word` (lowercase ASCII letters) at `at` in any case — what the `i` flag folded, and nothing else. */
function spells(text: string, at: number, word: string): boolean {
  for (let k = 0; k < word.length; k++) if ((text.charCodeAt(at + k) | 0x20) !== word.charCodeAt(k)) return false;
  return true;
}

/**
 * `<tag\b[^>]*?\battr\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>` (flags
 * `gi`); with `element`, followed by `([\s\S]*?)<\/tag>`.
 *
 * The lazy `[^>]*?` tries every position up to the tag's first `>` for the
 * attribute, and each attempt used to read on to a `>` again — quadratic in a
 * long tag without one. Whether an attribute value at a position leads to a
 * match does not depend on where the tag began, so a cursor walks those
 * positions once; and whether a `>` (and, for an element, a closing tag after
 * it) follows a point is one comparison against the last one in the text.
 */
function htmlAttributeLinks(tag: string, attribute: string, element: boolean): LinkScanner {
  return (text) => {
    const n = text.length;
    const lastClose = element ? lastClosingTag(text, tag) : -1;
    // The last `>` a value may be followed by: for an element it must leave a closing tag after it.
    const lastGt = element ? (lastClose > 0 ? text.lastIndexOf(">", lastClose - 1) : -1) : text.lastIndexOf(">");
    const bareEnd = nextWhere(n, (i) => text[i] === ">" || SPACE.test(text[i]));
    const skipSpace = (i: number) => {
      while (i < n && SPACE.test(text[i])) i++;
      return i;
    };
    /** The value of the attribute starting at `at`, if the rest of the pattern can follow it. */
    const valueAt = (at: number): { after: number; groups: Array<string | undefined> } | null => {
      if (isWord(text[at - 1]) || !spells(text, at, attribute)) return null;
      const equals = skipSpace(at + attribute.length);
      if (text[equals] !== "=") return null;
      const start = skipSpace(equals + 1);
      const quote = text[start];
      if (quote === "\"" || quote === "'") {
        const close = text.indexOf(quote, start + 1);
        if (close >= 0 && close + 1 <= lastGt) {
          const value = text.slice(start + 1, close);
          return { after: close + 1, groups: quote === "\"" ? [value, undefined, undefined] : [undefined, value, undefined] };
        }
      }
      const stop = bareEnd(start);
      if (stop > start && stop <= lastGt) return { after: stop, groups: [undefined, undefined, text.slice(start, stop)] };
      return null;
    };
    const nextValue = nextWhere(n, (i) => valueAt(i) !== null);
    const tagEnd = nextWhere(n, (i) => text[i] === ">");
    return scanFrom(text, (at) => {
      const from = at + 1 + tag.length;
      if (text[at] !== "<" || !spells(text, at + 1, tag) || isWord(text[from])) return null;
      const attributeAt = nextValue(from);
      if (attributeAt >= tagEnd(from)) return null;
      const value = valueAt(attributeAt)!;
      const gt = text.indexOf(">", value.after);
      if (!element) return { index: at, end: gt + 1, groups: value.groups };
      const close = closingTagFrom(text, tag, gt + 1);
      return { index: at, end: close + tag.length + 3, groups: [...value.groups, text.slice(gt + 1, close)] };
    });
  };
}

/** Whether `</tag>` (any case) stands at `at`. */
const closingTagAt = (text: string, tag: string, at: number) =>
  text[at] === "<" && text[at + 1] === "/" && spells(text, at + 2, tag) && text[at + 2 + tag.length] === ">";

function closingTagFrom(text: string, tag: string, from: number): number {
  for (let at = text.indexOf("<", from); at >= 0; at = text.indexOf("<", at + 1)) if (closingTagAt(text, tag, at)) return at;
  return -1;
}

function lastClosingTag(text: string, tag: string): number {
  for (let at = text.lastIndexOf("<"); at >= 0; at = at > 0 ? text.lastIndexOf("<", at - 1) : -1) if (closingTagAt(text, tag, at)) return at;
  return -1;
}

const htmlImages = htmlAttributeLinks("img", "src", false);
const htmlAnchors = htmlAttributeLinks("a", "href", true);

/**
 * Creates a non-round-trippable Markdown projection for an external slice.
 *
 * The source is never modified. Links to excluded objects become plain labels;
 * excluded embeds are removed completely so names cannot leak through markup.
 *
 * Six link shapes are covered, because a projection that only understands two
 * of them withholds a path in one place and publishes it in another:
 *
 * - `[[wiki]]` and `![[wiki]]`
 * - `[label](target)`, including the `<...>` destination form
 * - `[label][ref]` and the collapsed `[label][]`
 * - `[ref]` on its own, when `ref` is a known definition
 * - the definition LINES themselves - neutralising `[label][ref]` while leaving
 *   `[ref]: private/path.md` at the bottom publishes exactly what was withheld
 * - `<img src>` and `<a href>`, which pass straight through a Markdown renderer
 *
 * Frontmatter runs through the allowlist above unless the caller names its own
 * (see `DEFAULT_PUBLISHED_PROPERTY_ALLOWLIST` for why an allowlist and not a
 * denylist). `privateProperties` still applies on top: an explicitly named key
 * is removed even when the allowlist would let it through.
 */
export function projectPublishedMarkdown(input: {
  markdown: string;
  includedPaths: Iterable<string>;
  propertyAllowlist?: string[] | null;
  privateProperties?: string[];
}): PublishedSliceProjection {
  const included = includedIndex(input.includedPaths);
  const allow = new Set(
    (input.propertyAllowlist ?? DEFAULT_PUBLISHED_PROPERTY_ALLOWLIST).map((key) => normalizePropertyKey(key)),
  );
  const privateKeys = new Set((input.privateProperties ?? []).map((key) => normalizePropertyKey(key)));
  const removedProperties = new Set<string>();
  const neutralizedLinks = new Set<string>();
  const removedEmbeds = new Set<string>();
  let markdown = input.markdown;

  if (markdown.startsWith("---\n") || markdown.startsWith("---\r\n")) {
    const newline = markdown.startsWith("---\r\n") ? "\r\n" : "\n";
    const end = markdown.indexOf(`${newline}---${newline}`, 4);
    if (end >= 0) {
      const bodyStart = end + (`${newline}---${newline}`).length;
      const doc = parseDocument(markdown.slice(4, end), { uniqueKeys: true });
      protocolAssert(doc.errors.length === 0, "format", "published slice frontmatter is invalid");
      const source = doc.toJS() as Record<string, unknown> | null;
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(source ?? {})) {
        const normalized = normalizePropertyKey(key);
        if (privateKeys.has(normalized) || !allow.has(normalized)) removedProperties.add(key);
        else clean[key] = value;
      }
      const yaml = Object.keys(clean).length ? stringify(clean).trimEnd() : "";
      markdown = yaml ? `---${newline}${yaml.replace(/\n/g, newline)}${newline}---${newline}${markdown.slice(bodyStart)}` : markdown.slice(bodyStart);
    }
  }

  markdown = replaceOutsideFences(markdown, wikiLinks, (whole, [embed, rawTarget, , alias]) => {
    const target = rawTarget ?? "";
    if (isIncluded(target, included)) return whole;
    if (embed) { removedEmbeds.add(target.trim()); return ""; }
    neutralizedLinks.add(target.trim());
    return alias?.trim() || target.trim().split("/").pop() || "";
  });

  markdown = replaceOutsideFences(markdown, inlineLinks, (whole, [embed, label, angled, bare]) => {
    const target = firstDefined(angled, bare);
    if (EXTERNAL_TARGET.test(target) || isIncluded(target, included)) return whole;
    if (embed) { removedEmbeds.add(target); return ""; }
    neutralizedLinks.add(target);
    return label ?? "";
  });

  // Definitions are parsed before any reference link is rewritten: a shortcut
  // `[ref]` is only a link when a definition of that name exists, and the same
  // map decides which definition lines have to go at the end.
  const definitions = new Map<string, { target: string; excluded: boolean }>();
  const definitionFenced = insideFences(fencedRanges(markdown));
  for (const match of markdown.matchAll(LINK_DEFINITION)) {
    const offset = match.index ?? 0;
    if (definitionFenced(offset)) continue;
    const target = firstDefined(match[2], match[3]);
    definitions.set(normalizePropertyKey(match[1] ?? ""), {
      target,
      excluded: !EXTERNAL_TARGET.test(target) && !isIncluded(target, included),
    });
  }

  if (definitions.size > 0) {
    markdown = replaceOutsideFences(markdown, referenceLinks, (whole, [embed, label, ref]) => {
      // "[label][]" is the collapsed form: the label is its own reference.
      const key = normalizePropertyKey((ref ?? "").trim() || (label ?? "").trim());
      const definition = definitions.get(key);
      if (!definition || !definition.excluded) return whole;
      if (embed) { removedEmbeds.add(definition.target); return ""; }
      neutralizedLinks.add(definition.target);
      return label ?? "";
    });
    markdown = replaceOutsideFences(markdown, shortcutLinks, (whole, [embed, label]) => {
      const definition = definitions.get(normalizePropertyKey((label ?? "").trim()));
      if (!definition || !definition.excluded) return whole;
      if (embed) { removedEmbeds.add(definition.target); return ""; }
      neutralizedLinks.add(definition.target);
      return label ?? "";
    });
    markdown = replaceOutsideFences(markdown, patternScanner(LINK_DEFINITION), (whole, [label]) => {
      const definition = definitions.get(normalizePropertyKey((label ?? "").trim()));
      if (!definition || !definition.excluded) return whole;
      neutralizedLinks.add(definition.target);
      return "";
    });
  }

  markdown = replaceOutsideFences(markdown, htmlImages, (whole, [quoted, single, bare]) => {
    const target = firstDefined(quoted, single, bare);
    if (EXTERNAL_TARGET.test(target) || isIncluded(target, included)) return whole;
    removedEmbeds.add(target);
    return "";
  });

  markdown = replaceOutsideFences(markdown, htmlAnchors, (whole, [quoted, single, bare, inner]) => {
    const target = firstDefined(quoted, single, bare);
    if (EXTERNAL_TARGET.test(target) || isIncluded(target, included)) return whole;
    neutralizedLinks.add(target);
    return inner ?? "";
  });

  return {
    markdown,
    report: {
      // Sets, not arrays: the same withheld path reaching the reader twice in
      // the preview reads as a bug in the preview.
      removedProperties: [...removedProperties].sort(),
      neutralizedLinks: [...neutralizedLinks].sort(),
      removedEmbeds: [...removedEmbeds].sort(),
    },
  };
}

export interface PublishedProjectionSample {
  path: string;
  /** The note as it is stored, so the two can be shown side by side. */
  before: string;
  after: string;
  report: PublishedSliceProjectionReport;
}

export interface PublishedProjectionPreview {
  objectCount: number;
  /** Union over every object in the slice, each name and path listed once. */
  removedProperties: string[];
  neutralizedLinks: string[];
  removedEmbeds: string[];
  /** One real object of the slice, projected. `null` only for an empty slice. */
  sample: PublishedProjectionSample | null;
  /** Nothing at all is taken out - by definition in `exact`, by luck otherwise. */
  unchanged: boolean;
}

/**
 * What the slice looks like AFTER projection, before anything leaves the vault.
 *
 * The allowlist from decision E5 buys safety by withholding things nobody
 * listed, and that trade is only honest if the person publishing can see what
 * was withheld. Hence a preview against REAL objects rather than a description
 * of the rules: a sentence saying "private properties are removed" is exactly
 * what the shipped denylist also said while publishing an account identity.
 *
 * Three properties of this function are load-bearing:
 *
 * - `includedPaths` is derived from `objects` instead of being passed in. The
 *   preview then cannot compute against a different set of included paths than
 *   the one it is showing - the failure where the preview is clean and the
 *   publication is not.
 * - `mode: "exact"` runs no projection at all and reports `unchanged`. An exact
 *   publication is the whole note; showing a sanitized preview for it would be
 *   a comforting lie.
 * - The sample is the object with the MOST removals, not the first one. The
 *   preview exists to answer "what gets taken out", and a first object that
 *   happens to be clean answers it with silence. Ties keep the earlier object,
 *   so the same slice always previews the same way.
 */
export function previewPublishedProjection(input: {
  mode: PublishedSliceMode;
  objects: readonly { path: string; markdown: string }[];
  propertyAllowlist?: string[] | null;
  privateProperties?: string[];
}): PublishedProjectionPreview {
  const includedPaths = input.objects.map((object) => object.path);
  const removedProperties = new Set<string>();
  const neutralizedLinks = new Set<string>();
  const removedEmbeds = new Set<string>();
  let sample: PublishedProjectionSample | null = null;
  let sampleWeight = -1;

  for (const object of input.objects) {
    const projection =
      input.mode === "exact"
        ? { markdown: object.markdown, report: { removedProperties: [], neutralizedLinks: [], removedEmbeds: [] } }
        : projectPublishedMarkdown({
            markdown: object.markdown,
            includedPaths,
            propertyAllowlist: input.propertyAllowlist,
            privateProperties: input.privateProperties,
          });
    for (const key of projection.report.removedProperties) removedProperties.add(key);
    for (const link of projection.report.neutralizedLinks) neutralizedLinks.add(link);
    for (const embed of projection.report.removedEmbeds) removedEmbeds.add(embed);
    const weight =
      projection.report.removedProperties.length +
      projection.report.neutralizedLinks.length +
      projection.report.removedEmbeds.length;
    if (weight > sampleWeight) {
      sampleWeight = weight;
      sample = { path: object.path, before: object.markdown, after: projection.markdown, report: projection.report };
    }
  }

  return {
    objectCount: input.objects.length,
    removedProperties: [...removedProperties].sort(),
    neutralizedLinks: [...neutralizedLinks].sort(),
    removedEmbeds: [...removedEmbeds].sort(),
    sample,
    unchanged: sampleWeight <= 0,
  };
}

/**
 * The folder a publication lives in, derived rather than stored.
 *
 * The obvious design would be a `publicationId` field on the config - and the
 * config already declares one. It cannot be written: `assertExactKeys` pins the
 * publication document to exactly the five keys it has today, and the protocol
 * has no schema evolution (every document is checked against an exact key set,
 * and `protocolVersion` is compared for equality). Adding a field is a protocol
 * change, and a protocol change is blocked behind the pending crypto review.
 *
 * Deriving it costs nothing and buys something the stored id would not: the
 * folder name under `.pvws/publications/` is visible to the provider and to
 * every recipient. Using the slice id there would tell them which internal row
 * of the main vault this share belongs to, and two shares of the same slice
 * would be recognisably the same slice. A hash over `workspaceId + "/" +
 * sliceId` reveals neither, while staying stable for the same pair - which is
 * what makes a refresh find its own publication again.
 *
 * Thirty-two hex characters - sixteen bytes - because a publication IS a
 * workspace, and this id is its `workspaceId` (S2). The invite code carries a
 * workspace id and nothing else, so making the two the same lets a recipient
 * derive the folder from the code alone; `assertWorkspaceId` demands sixteen
 * bytes, and a shorter namespace would force a second id and a second field to
 * hand over. It also makes a publication folder look like every other workspace
 * id rather than like a distinctly shorter special case.
 *
 * The id is a namespace, not a secret: it is derived from two values the
 * recipient knows nothing about, and the encryption - not the folder name - is
 * what keeps the content closed.
 */
export function derivePublicationId(workspaceId: string, sliceId: string): string {
  protocolAssert(workspaceId.length > 0 && sliceId.length > 0, "format", "publication id needs a workspace and a slice");
  return sha256Hex(utf8Encode(`${workspaceId}/${sliceId}`)).slice(0, 32);
}

/** Namespaces an independently bootstrapped encrypted workspace on one provider. */
export class PublishedSliceObjectStore implements WorkspaceObjectStore {
  private readonly prefix: string;
  constructor(private readonly store: WorkspaceObjectStore, publicationId: string) {
    protocolAssert(/^[a-z0-9][a-z0-9-]{7,127}$/.test(publicationId), "format", "invalid publication id");
    this.prefix = `.pvws/publications/${publicationId}/`;
  }
  private remote(key: string): string { return `${this.prefix}${key.replace(/^\.pvws\//, "")}`; }
  private local(info: WorkspaceObjectInfo): WorkspaceObjectInfo { return { ...info, key: `.pvws/${info.key.slice(this.prefix.length)}` }; }
  async list(prefix: string, cursor?: string, options?: WorkspaceRequestOptions): Promise<WorkspaceListPage> {
    const page = await this.store.list(this.remote(prefix), cursor, options);
    return { items: page.items.map((entry) => this.local(entry)), ...(page.cursor ? { cursor: page.cursor } : {}) };
  }
  get(key: string, options?: WorkspaceRequestOptions) { return this.store.get(this.remote(key), options); }
  getRange(key: string, start: number, endExclusive: number, options?: WorkspaceRequestOptions) { return this.store.getRange(this.remote(key), start, endExclusive, options); }
  async head(key: string, options?: WorkspaceRequestOptions) { const info = await this.store.head(this.remote(key), options); return info ? this.local(info) : null; }
  putImmutable(key: string, bytes: Uint8Array, expectedSha256: string, options?: WorkspaceRequestOptions) { return this.store.putImmutable(this.remote(key), bytes, expectedSha256, options); }
  compareAndSwapPointer(key: string, bytes: Uint8Array, previousEtag: string | null, options?: WorkspaceRequestOptions) { return this.store.compareAndSwapPointer(this.remote(key), bytes, previousEtag, options); }
}

/**
 * The one place that constructs a publication store.
 *
 * Everything else - creating, refreshing, joining, retracting - goes through
 * here, so the derivation above exists exactly once. A second caller building
 * the store by hand would be free to pass a different id, and a publication
 * written under one name and refreshed under another is a silent orphan: the
 * old folder keeps serving stale objects to whoever already joined it.
 * `publicationStore.test.ts` pins that with a source-text check.
 */
export function publicationStoreFor(store: WorkspaceObjectStore, workspaceId: string, sliceId: string): PublishedSliceObjectStore {
  return new PublishedSliceObjectStore(store, derivePublicationId(workspaceId, sliceId));
}

/**
 * The same folder, seen from the other side.
 *
 * A publisher writes into `.pvws/publications/<id>/` inside their own vault
 * remote, and shares exactly that subfolder with a recipient. The recipient
 * therefore connects it as their ROOT: the objects sit directly under it, with
 * no `.pvws/` segment left, because the publisher's wrapper stripped it on the
 * way out.
 *
 * Nothing else in Plainva knows that. Every workspace read - genesis, policy,
 * objects - asks for `.pvws/...`, so without this wrapper a shared publication
 * folder looks empty to the person it was shared with, and the joining path
 * reports no workspace rather than an error anyone could act on.
 *
 * It is the exact inverse of PublishedSliceObjectStore, and it lives beside it
 * on purpose: the two mappings have to stay symmetrical, and a pair that can
 * drift apart in two files eventually does.
 */
export class PublicationRecipientObjectStore implements WorkspaceObjectStore {
  constructor(private readonly store: WorkspaceObjectStore) {}
  private remote(key: string): string { return key.replace(/^\.pvws\//, ""); }
  private local(info: WorkspaceObjectInfo): WorkspaceObjectInfo { return { ...info, key: `.pvws/${info.key}` }; }
  async list(prefix: string, cursor?: string, options?: WorkspaceRequestOptions): Promise<WorkspaceListPage> {
    const page = await this.store.list(this.remote(prefix), cursor, options);
    return { items: page.items.map((entry) => this.local(entry)), ...(page.cursor ? { cursor: page.cursor } : {}) };
  }
  get(key: string, options?: WorkspaceRequestOptions) { return this.store.get(this.remote(key), options); }
  getRange(key: string, start: number, endExclusive: number, options?: WorkspaceRequestOptions) { return this.store.getRange(this.remote(key), start, endExclusive, options); }
  async head(key: string, options?: WorkspaceRequestOptions) { const info = await this.store.head(this.remote(key), options); return info ? this.local(info) : null; }
  putImmutable(key: string, bytes: Uint8Array, expectedSha256: string, options?: WorkspaceRequestOptions) { return this.store.putImmutable(this.remote(key), bytes, expectedSha256, options); }
  compareAndSwapPointer(key: string, bytes: Uint8Array, previousEtag: string | null, options?: WorkspaceRequestOptions) { return this.store.compareAndSwapPointer(this.remote(key), bytes, previousEtag, options); }
}

/**
 * The one place that wraps a shared publication folder for its recipient.
 *
 * Same reason as publicationStoreFor: a second construction site is free to
 * map the keys slightly differently, and two mappings for one folder is how a
 * recipient ends up reading half a workspace.
 */
export function publicationRecipientStoreFor(store: WorkspaceObjectStore): PublicationRecipientObjectStore {
  return new PublicationRecipientObjectStore(store);
}

/**
 * The provider-facing permission an ACL should grant.
 *
 * A hint, not a role: the publication's own policy is what actually decides
 * what a recipient may do. This only says which word to pick in the provider's
 * sharing dialog, and encryption stays authoritative either way.
 */
export type PublishedSlicePermissionHint = "viewer" | "commenter";

/** One piece of advice for setting up the provider share. */
export type PublishedSliceInstructionId =
  | "dedicated-folder-permission"
  | "no-link-wide-access"
  | "specific-people-link"
  | "download-block-optional"
  | "dedicated-folder-invite"
  | "no-public-link"
  | "share-password-expiry"
  | "credentials-outside"
  | "dedicated-collection"
  | "tls-separate-account"
  | "dedicated-prefix-deny-default"
  | "no-public-access-tls";

export interface PublishedSliceInstruction {
  id: PublishedSliceInstructionId;
  /** Set only where the sentence names a permission, so the shell can fill it in. */
  permission?: PublishedSlicePermissionHint;
}

/**
 * How to set up the provider share alongside a publication.
 *
 * Provider ACLs are defense in depth and may never replace encrypted access -
 * a recipient without the key reads nothing regardless of what the folder
 * allows, and a folder opened too widely still leaks only ciphertext.
 *
 * Returns identifiers rather than sentences. The choice of WHICH advice a
 * provider needs is a rule and belongs here; the words are shown to a person
 * and belong in the locales. Returning English here would put a tenth of the
 * interface outside the ten translated files, in the one place a publisher is
 * most likely to be following along in their own language.
 */
export function publishedSliceProviderInstructions(
  config: Pick<PublishedSliceConfig, "provider" | "access">,
): PublishedSliceInstruction[] {
  const permission: PublishedSlicePermissionHint = config.access === "read" ? "viewer" : "commenter";
  switch (config.provider) {
    case "google-drive":
      return [{ id: "dedicated-folder-permission", permission }, { id: "no-link-wide-access" }];
    case "onedrive":
      return [{ id: "specific-people-link", permission }, { id: "download-block-optional" }];
    case "dropbox":
      return [{ id: "dedicated-folder-invite", permission }, { id: "no-public-link" }];
    case "nextcloud":
      return [{ id: "share-password-expiry" }, { id: "credentials-outside" }];
    case "webdav":
      return [{ id: "dedicated-collection" }, { id: "tls-separate-account" }];
    case "s3":
      return [{ id: "dedicated-prefix-deny-default" }, { id: "no-public-access-tls" }];
  }
}
