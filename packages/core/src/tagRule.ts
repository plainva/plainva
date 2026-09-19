/**
 * What an inline tag IS — the one rule (finding 2026-09-19).
 *
 * There were three: the index counted `#` plus any run of name characters, the
 * task scan wanted a letter or digit first (and took `#123` for a tag), and the
 * vault-wide rename accepted a `#` after anything that is not a name character -
 * so it rewrote `[[#old]]` and `[text](#old)`, which are links to a heading, and
 * a line of code that happened to contain the name. A tag the pane does not list
 * must not be renamed, and a pill in the editor must not mark what a click then
 * cannot find. Index, task scan, rename and the pill read this file.
 *
 * The rule is Obsidian's: a `#` at the start of the text or after whitespace,
 * followed by letters, digits, `_`, `-` and `/` - and not digits alone, so an
 * issue number stays a number.
 */

/** The characters a tag name is made of, as a character-class body. */
const NAME_CHARS = "\\p{L}\\p{N}_/-";

/** Stands in for blanked source: neither whitespace, `#` nor a name character (U+FFFC). */
const FILLER = String.fromCharCode(0xfffc);

export interface InlineTag {
  /** The name without the `#`, as the index stores it. */
  name: string;
  /** Offset of the `#`. */
  from: number;
  /** Offset after the last character of the name. */
  to: number;
}

/** True when a string is a tag name under the rule (no `#`, no whitespace, not digits alone). */
export function isInlineTagName(name: string): boolean {
  return new RegExp(`^[${NAME_CHARS}]+$`, "u").test(name) && !/^\d+$/.test(name);
}

/** The first segment of a nested tag: `project/website` -> `project`. A leading `#` is ignored. */
export function tagRoot(tag: string): string {
  const bare = tag.startsWith("#") ? tag.slice(1) : tag;
  const slash = bare.indexOf("/");
  return slash === -1 ? bare : bare.slice(0, slash);
}

function collect(text: string, pattern: RegExp): InlineTag[] {
  const out: InlineTag[] = [];
  for (const match of text.matchAll(pattern)) {
    const name = match[2];
    if (/^\d+$/.test(name)) continue;
    const from = (match.index ?? 0) + match[1].length;
    out.push({ name, from, to: from + 1 + name.length });
  }
  return out;
}

/**
 * Tags in the text of ONE Markdown text node - what the index counts. The parser
 * has already taken code, links and HTML out of such a text, so the rule is all
 * there is.
 */
export function findInlineTags(text: string): InlineTag[] {
  return collect(text, new RegExp(`(^|\\s)#([${NAME_CHARS}]+)`, "gu"));
}

/** Replaces every hit with filler of the same length, so the offsets stay. */
function blank(line: string, pattern: RegExp): string {
  return line.replace(pattern, (hit) => FILLER.repeat(hit.length));
}

/** Blanks inline code: a run of N backticks up to the next run of exactly N. */
function blankCodeSpans(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      out += line[i++];
      continue;
    }
    let run = i;
    while (run < line.length && line[run] === "`") run++;
    const fence = line.slice(i, run);
    let close = line.indexOf(fence, run);
    // A longer run is not the closing one (a single backtick inside a double-backtick span).
    while (close !== -1 && (line[close + fence.length] === "`" || line[close - 1] === "`")) close = line.indexOf(fence, close + 1);
    if (close === -1) {
      out += fence;
      i = run;
      continue;
    }
    out += FILLER.repeat(close + fence.length - i);
    i = close + fence.length;
  }
  return out;
}

/**
 * Tags in ONE LINE of Markdown SOURCE. The source still carries what the parser
 * removes, so this blanks it first: inline code, wiki links and embeds (an alias
 * is no text node), the destination of a Markdown link, HTML tags and comments.
 * A URL needs no blanking - its `#` never follows whitespace.
 *
 * One thing the source has that a text node has not: inline markup right before
 * the `#`. `**#tag**` is a tag to the index, because the parser starts a new text
 * node inside the emphasis; here the run of `*`, `~` or `=` is allowed in between.
 * (`_` is left out: it is a name character, and `_#tag_` would read as `tag_`.)
 */
export function findInlineTagsInLine(line: string): InlineTag[] {
  if (!line.includes("#")) return [];
  let masked = blankCodeSpans(line);
  masked = blank(masked, /!?\[\[[^\]\n]*\]\]/g);
  masked = blank(masked, /\]\([^)\n]*\)/g);
  masked = blank(masked, /<!--.*?-->|<\/?[A-Za-z][^>\n]*>/g);
  return collect(masked, new RegExp(`(^|\\s[*~=]{0,3}|^[*~=]{1,3})#([${NAME_CHARS}]+)`, "gu"));
}

const FENCE = /^\s*(?:>\s*)*(?:```|~~~)/;

/**
 * Tags in a Markdown BODY (the frontmatter already cut off), with offsets into
 * that body: line by line, never inside a fenced code block or an HTML comment
 * that runs over several lines.
 */
export function findInlineTagsInSource(body: string): InlineTag[] {
  const out: InlineTag[] = [];
  let offset = 0;
  let inFence = false;
  let inComment = false;
  for (const raw of body.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    let scan = line;
    if (FENCE.test(line)) {
      inFence = !inFence;
      scan = "";
    } else if (inFence) {
      scan = "";
    } else if (inComment) {
      const end = line.indexOf("-->");
      if (end === -1) scan = "";
      else {
        inComment = false;
        scan = FILLER.repeat(end + 3) + line.slice(end + 3);
      }
    }
    if (scan) {
      // An opening `<!--` without its end on this line starts a block comment.
      const open = scan.lastIndexOf("<!--");
      if (open !== -1 && scan.indexOf("-->", open) === -1) {
        inComment = true;
        scan = scan.slice(0, open);
      }
      for (const tag of findInlineTagsInLine(scan)) out.push({ name: tag.name, from: tag.from + offset, to: tag.to + offset });
    }
    offset += raw.length + 1;
  }
  return out;
}
