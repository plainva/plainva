import { parseReaderTextTree } from "./markdown-parser.js";
import type { ReaderSource } from "./noteSource.js";

interface Point { line: number; column: number; offset: number }
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: Point; end: Point };
  [key: string]: unknown;
}

const ASCII_PUNCTUATION = /[!-/:-@[-\x60{-~]/;
/** The address of a wiki link or an embed in the text the renderer is handed. */
const WIKI_URL = /^wiki(?:-[a-z]+)?:\/\//;

/**
 * A formula gives way to a wiki link (Fehlerliste 0.9.0, B4): in Plainva
 * `[[…]]` is a link between dollar signs too. The note is read once, as it
 * always was — the same `$` pair as they always did —, and afterwards every
 * formula (`inlineMath`, `math`) that holds a wiki link of `source` stands as
 * what is written there: its dollar signs as the signs they are, its content
 * read as ordinary text without formulas, the link in it a link. A block
 * becomes the blocks its lines are. Every other formula stays as it is, and
 * no formula is made.
 *
 * Runs as the first transformer after the parse (before tag pills and the
 * like, which then read the new text too). Every place in the new nodes is a
 * place in `source.text`.
 */
export function remarkFormulasYieldToLinks(source: ReaderSource) {
  const links = source.wikiLinks;
  const text = source.text;
  return () => (tree: unknown) => {
    if (links.length === 0) return;
    let lineStarts: number[] | null = null;
    const pointAt = (offset: number): Point => {
      if (!lineStarts) {
        lineStarts = [0];
        for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
      }
      let low = 0, high = lineStarts.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (lineStarts[mid] <= offset) low = mid;
        else high = mid - 1;
      }
      return { line: low + 1, column: offset - lineStarts[low] + 1, offset };
    };
    /** How many links stand in `[from, to)`. */
    const linksIn = (from: number, to: number) => {
      let low = 0, high = links.length - 1, found = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (links[mid][0] < to) {
          found = mid;
          low = mid + 1;
        } else high = mid - 1;
      }
      let count = 0;
      for (let n = found; n >= 0 && links[n][1] > from; n--) count++;
      return count;
    };
    interface Job { children: MdNode[]; index: number; from: number; to: number; indent: number; inline: boolean; held: number; made?: MdNode[] | null }
    const jobs: Job[] = [];
    const walk = (node: MdNode, block: MdNode) => {
      const children = node.children;
      if (!children) return;
      const leaf = node.type === "paragraph" || node.type === "heading" || node.type === "tableCell" ? node : block;
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const at = child.position;
        const held = (child.type === "inlineMath" || child.type === "math") && at ? linksIn(at.start.offset, at.end.offset) : 0;
        if (held > 0 && at) {
          const inline = child.type === "inlineMath";
          const indent = ((inline ? leaf : child).position?.start.column ?? 1) - 1;
          jobs.push({ children, index, from: at.start.offset, to: at.end.offset, indent, inline, held });
        } else walk(child, leaf);
      }
    };
    walk(tree as MdNode, tree as MdNode);
    if (jobs.length === 0) return;
    // A formula on one line of plain words and links is built as it stands,
    // without a reading of its own.
    for (const job of jobs) if (job.inline) job.made = builtAsWritten(text, job.from, job.to, links, pointAt) ?? undefined;
    // A formula on one line is read with all others of its kind in one go —
    // each one paragraph, a blank line between them: a line that begins with
    // `$` opens no block. A note full of them costs one reading, not one each.
    const single = jobs.filter((job) => job.made === undefined && job.inline && !text.slice(job.from, job.to).includes("\n"));
    if (single.length > 1) {
      const bases: number[] = [];
      let joined = "";
      for (const job of single) {
        if (joined) joined += "\n\n";
        bases.push(joined.length);
        joined += text.slice(job.from, job.to);
      }
      const blocks = (parseReaderTextTree(joined) as unknown as MdNode).children ?? [];
      if (blocks.length === single.length && blocks.every((block, k) => block.type === "paragraph" && block.position?.start.offset === bases[k])) {
        single.forEach((job, k) => {
          const paragraph = blocks[k];
          if (linksOf(paragraph) < job.held) return;
          const base = bases[k], end = base + job.to - job.from;
          unwrapCutAddresses(paragraph, end, text[job.to - 1] === "$");
          const move = (node: MdNode) => {
            if (node.position) node.position = { start: pointAt(node.position.start.offset - base + job.from), end: pointAt(node.position.end.offset - base + job.from) };
            for (const child of node.children ?? []) move(child);
          };
          const phrasing = paragraph.children ?? [];
          phrasing.forEach(move);
          job.made = phrasing;
        });
      }
    }
    for (const job of jobs) if (job.made === undefined) job.made = readAsText(text, job.from, job.to, job.indent, job.inline, job.held, pointAt);
    // Back to front, so that each index still names its formula.
    for (let k = jobs.length - 1; k >= 0; k--) {
      const job = jobs[k];
      if (job.made) job.children.splice(job.index, 1, ...job.made);
    }
  };
}

/** Text in which Markdown reads nothing: no sign of emphasis, code, a link, an escape or an entity, no address. */
const PLAIN_WORDS = /^[^\\`*_~[\]<>&!@\n]*$/;
/** A wiki link or embed as the reader writes it, with a label in which Markdown reads nothing. */
const BUILT_LINK = /^(!?)\[([^\\`*_~[\]<>&!@\n]*)\]\((wiki(?:-[a-z]+)?:\/\/[^()\s\\]*)\)$/;

/**
 * The nodes of `text[from, to)` read without formulas, built without a
 * reading where they are plain: words between wiki links and embeds of plain
 * labels, on one line — or null where Markdown could read more in them.
 */
function builtAsWritten(text: string, from: number, to: number, links: ReadonlyArray<readonly [number, number]>, pointAt: (offset: number) => Point): MdNode[] | null {
  const made: MdNode[] = [];
  const words = (a: number, b: number): boolean => {
    if (a === b) return true;
    const value = text.slice(a, b);
    if (!PLAIN_WORDS.test(value) || /www\.|https?:|ftp:/i.test(value)) return false;
    made.push({ type: "text", value, position: { start: pointAt(a), end: pointAt(b) } });
    return true;
  };
  let low = 0, high = links.length - 1, first = links.length;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (links[mid][1] > from) {
      first = mid;
      high = mid - 1;
    } else low = mid + 1;
  }
  let at = from;
  for (let n = first; n < links.length && links[n][0] < to; n++) {
    const [start, end] = links[n];
    if (start < at || end > to || !words(at, start)) return null;
    const link = BUILT_LINK.exec(text.slice(start, end));
    if (!link) return null;
    const [, bang, label, url] = link;
    const position = { start: pointAt(start), end: pointAt(end) };
    if (bang) made.push({ type: "image", url, title: null, alt: label, position });
    else {
      const labelFrom = start + 1;
      made.push({ type: "link", url, title: null, position, children: label ? [{ type: "text", value: label, position: { start: pointAt(labelFrom), end: pointAt(labelFrom + label.length) } }] : [] });
    }
    at = end;
  }
  return words(at, to) ? made : null;
}

/**
 * A link that takes the closing sign along is an address the formula cut off
 * (`<https://x/?$top=1>`, GFM's bare addresses): it stays text, as it is read
 * in the note. `end` is where what was read ends in the tree's text.
 */
function unwrapCutAddresses(node: MdNode, end: number, closedBySign: boolean): void {
  if (!closedBySign) return;
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === "link" && child.position && child.position.end.offset >= end && !WIKI_URL.test(String(child.url))) {
      children.splice(i, 1, ...(child.children ?? []));
      i--;
      continue;
    }
    unwrapCutAddresses(child, end, closedBySign);
  }
}

/**
 * `text[from, to)` read without formulas — inline as the phrasing of one
 * paragraph, else as blocks — with every place moved to a place in `text`, or
 * null where it cannot be read as one paragraph. On a line behind the first,
 * the marks of the containers it stands in (`> `, a list's blanks) are not
 * part of what is read, up to `indent` characters.
 */
function readAsText(text: string, from: number, to: number, indent: number, inline: boolean, held: number, pointAt: (offset: number) => Point): MdNode[] | null {
  // What is read, and for each of its characters the place in `text` (one more at the end).
  let read = "";
  const places: number[] = [];
  let lineStart = true;
  for (let at = from; at < to; at++) {
    if (lineStart && at > from) {
      let skipped = 0;
      while (skipped < indent && at < to && (text[at] === " " || text[at] === "\t" || text[at] === ">")) {
        at++;
        skipped++;
      }
      if (at >= to) break;
    }
    read += text[at];
    places.push(at);
    lineStart = text[at] === "\n";
  }
  places.push(to);
  const parse = (value: string, map: number[]): MdNode[] | null => {
    let root = parseReaderTextTree(value) as unknown as MdNode;
    // A backtick of the formula, paired anew, must not take its link.
    if (linksOf(root) < held) root = parseReaderTextTree(value, { codeSpans: false }) as unknown as MdNode;
    unwrapCutAddresses(root, value.length, value.endsWith("$"));
    const blocks = root.children ?? [];
    const move = (node: MdNode) => {
      if (node.position) {
        const start = map[Math.min(node.position.start.offset, map.length - 1)];
        const end = map[Math.min(node.position.end.offset, map.length - 1)];
        node.position = { start: pointAt(start), end: pointAt(end) };
      }
      for (const child of node.children ?? []) move(child);
    };
    if (!inline) {
      blocks.forEach(move);
      return blocks;
    }
    if (blocks.length !== 1 || blocks[0].type !== "paragraph") return null;
    const phrasing = blocks[0].children ?? [];
    phrasing.forEach(move);
    return phrasing;
  };
  const made = parse(read, places);
  if (made || !inline) return made;
  // A line behind the first that would open a block of its own (`- `, `# `,
  // `===`, a table's delimiter row) stays text: its first sign is read behind
  // a backslash, which stands at the place of that sign.
  let guarded = "";
  const guardedPlaces: number[] = [];
  for (let i = 0; i < read.length; i++) {
    const first = i > 0 && read[i - 1] === "\n";
    if (first) {
      let j = i;
      while (read[j] === " " || read[j] === "\t") j++;
      let digits = j;
      while (/[0-9]/.test(read[digits] ?? "")) digits++;
      const sign = digits > j && (read[digits] === "." || read[digits] === ")") ? digits : ASCII_PUNCTUATION.test(read[j] ?? "") ? j : -1;
      for (; i < (sign < 0 ? i : sign); i++) {
        guarded += read[i];
        guardedPlaces.push(places[i]);
      }
      if (sign >= 0) {
        guarded += "\\";
        guardedPlaces.push(places[i]);
      }
    }
    guarded += read[i];
    guardedPlaces.push(places[i]);
  }
  guardedPlaces.push(places[read.length]);
  return parse(guarded, guardedPlaces);
}

/** How many wiki links and embeds stand in a tree. */
function linksOf(node: MdNode): number {
  const own = (node.type === "link" || node.type === "image") && typeof node.url === "string" && WIKI_URL.test(node.url) ? 1 : 0;
  return own + (node.children ?? []).reduce((sum, child) => sum + linksOf(child), 0);
}
