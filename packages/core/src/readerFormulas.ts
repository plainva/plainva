import { parseReaderTextTree } from "./markdown-parser.js";
import { prepareReaderSource, type ReaderSource } from "./noteSource.js";

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
 * becomes one paragraph of its lines, in which only what can stand on one
 * line is read (links, emphasis, code) — never a block of its own. Every
 * other formula stays as it is, and no formula is made.
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
    interface Job { children: MdNode[]; index: number; from: number; to: number; indent: number; quotes: number; inline: boolean; held: number; made?: MdNode[] | null }
    const jobs: Job[] = [];
    // `quotes`: how many quotes the node stands in — the `>` a line of its formula may begin with.
    const walk = (node: MdNode, block: MdNode, quotes: number) => {
      const children = node.children;
      if (!children) return;
      const within = quotes + (node.type === "blockquote" ? 1 : 0);
      const leaf = node.type === "paragraph" || node.type === "heading" || node.type === "tableCell" ? node : block;
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        const at = child.position;
        const held = (child.type === "inlineMath" || child.type === "math") && at ? linksIn(at.start.offset, at.end.offset) : 0;
        if (held > 0 && at) {
          const inline = child.type === "inlineMath";
          const indent = ((inline ? leaf : child).position?.start.column ?? 1) - 1;
          jobs.push({ children, index, from: at.start.offset, to: at.end.offset, indent, quotes: within, inline, held });
        } else walk(child, leaf, within);
      }
    };
    walk(tree as MdNode, tree as MdNode, 0);
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
    const blockJobs = jobs.filter((job) => !job.inline);
    if (blockJobs.length > 0) {
      const made = readBlocksAsParagraphs(text, blockJobs, links, linksIn, pointAt);
      blockJobs.forEach((job, k) => { job.made = made[k]; });
    }
    for (const job of jobs) {
      if (job.made !== undefined) continue;
      // Where no reading keeps its links, the formula is read in pieces: what
      // stands between its links, and each link (`readPieces`).
      job.made = readAsText(text, job.from, job.to, job.indent, job.quotes, job.held, pointAt)
        ?? joinLines(blockLines(text, job.from, job.to, job.indent, job.quotes, linksIn), (line) => readPieces(text, line, job.to, links, pointAt), pointAt);
    }
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
 * An inline formula's `text[from, to)` read without formulas, as the phrasing
 * of one paragraph, with every place moved to a place in `text`, or null where
 * it cannot be read as one paragraph. On a line behind the first,
 * the marks of the containers it stands in (`> `, a list's blanks) are not
 * part of what is read, up to `indent` characters.
 */
function readAsText(text: string, from: number, to: number, indent: number, quotes: number, held: number, pointAt: (offset: number) => Point): MdNode[] | null {
  // What is read, and for each of its characters the place in `text` (one more at the end).
  let read = "";
  const places: number[] = [];
  let lineStart = true;
  for (let at = from; at < to; at++) {
    if (lineStart && at > from) {
      at = behindContainers(text, at, to, indent, quotes);
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
    if (blocks.length !== 1 || blocks[0].type !== "paragraph" || linksOf(blocks[0]) < held) return null;
    const phrasing = blocks[0].children ?? [];
    phrasing.forEach(move);
    return phrasing;
  };
  const made = parse(read, places);
  if (made) return made;
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

interface Line { from: number; to: number }

/** A sign that may open a block where it starts a line: Markdown's own, and a list's number. */
const OPENS_BLOCK = /^(?:[-+*#>`~[_<|]|\d+[.)])/;

/**
 * Each block formula's `text[from, to)` as one paragraph of its lines: each
 * line read on its own, so that only what can stand on one line is read in it
 * — links, emphasis, code —, never a block (a list, a heading, a table, a
 * footnote's definition, code): a line that would open one is read with a
 * backslash in front of its first sign, which stands at the place of that
 * sign. A line break stays one. Null for a formula a line of which cannot be
 * read with its links: it then stays one, as it always was.
 *
 * The lines that open no block are read together, a blank line between them,
 * in one go: a note full of such formulas costs one reading, not one a line.
 */
function readBlocksAsParagraphs(text: string, blocks: ReadonlyArray<{ from: number; to: number; indent: number; quotes: number }>, links: ReadonlyArray<readonly [number, number]>, linksIn: (from: number, to: number) => number, pointAt: (offset: number) => Point): MdNode[][] {
  const linesOf = blocks.map((block) => blockLines(text, block.from, block.to, block.indent, block.quotes, linksIn));
  const known = new Map<number, MdNode[] | null>();
  const together: Line[] = [];
  for (const lines of linesOf) for (const line of lines) if (line.from < line.to && !OPENS_BLOCK.test(text.slice(line.from, line.from + 12))) together.push(line);
  const ends = new Set(blocks.map((block) => block.to));
  if (together.length > 1) {
    const bases: number[] = [];
    let joined = "";
    for (const line of together) {
      if (joined) joined += "\n\n";
      bases.push(joined.length);
      joined += text.slice(line.from, line.to);
    }
    const read = (parseReaderTextTree(joined) as unknown as MdNode).children ?? [];
    if (read.length === together.length && read.every((node, k) => node.type === "paragraph" && node.position?.start.offset === bases[k])) {
      together.forEach((line, k) => {
        const paragraph = read[k];
        const base = bases[k];
        if (ends.has(line.to)) unwrapCutAddresses(paragraph, base + line.to - line.from, text[line.to - 1] === "$");
        if (linksOf(paragraph) < linksIn(line.from, line.to)) return;
        const move = (node: MdNode) => {
          if (node.position) node.position = { start: pointAt(node.position.start.offset - base + line.from), end: pointAt(node.position.end.offset - base + line.from) };
          for (const child of node.children ?? []) move(child);
        };
        const phrasing = paragraph.children ?? [];
        phrasing.forEach(move);
        known.set(line.from, phrasing);
      });
    }
  }
  return linesOf.map((lines, k) => {
    const { from, to } = blocks[k];
    const read = (line: Line) => known.get(line.from)
      ?? readLine(text, line, to, false, true, linksIn, pointAt) ?? readLine(text, line, to, false, false, linksIn, pointAt)
      ?? readLine(text, line, to, true, true, linksIn, pointAt) ?? readLine(text, line, to, true, false, linksIn, pointAt)
      ?? readPieces(text, line, to, links, pointAt);
    return [{ type: "paragraph", children: joinLines(lines, read, pointAt), position: { start: pointAt(from), end: pointAt(to) } }];
  });
}

/** The phrasing of `lines`, each read by `read`, a line break between them. */
function joinLines(lines: Line[], read: (line: Line) => MdNode[], pointAt: (offset: number) => Point): MdNode[] {
  const children: MdNode[] = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (n > 0) children.push({ type: "text", value: "\n", position: { start: pointAt(lines[n - 1].to), end: pointAt(line.from) } });
    if (line.from < line.to) children.push(...read(line));
  }
  return children;
}

/**
 * A line read in pieces, where no reading of it keeps its links: each wiki
 * link on its own, and on its own what stands between them — so that nothing
 * around a link (a bare address that would run into it, a code span over it)
 * takes it. A piece no reading makes a paragraph of stands as it is written.
 */
function readPieces(text: string, line: Line, end: number, links: ReadonlyArray<readonly [number, number]>, pointAt: (offset: number) => Point): MdNode[] {
  const made: MdNode[] = [];
  const asWritten = (from: number, to: number): MdNode => ({ type: "text", value: text.slice(from, to), position: { start: pointAt(from), end: pointAt(to) } });
  const between = (from: number, to: number) => {
    let start = from, stop = to;
    while (start < stop && (text[start] === " " || text[start] === "\t")) start++;
    while (stop > start && (text[stop - 1] === " " || text[stop - 1] === "\t")) stop--;
    if (start > from) made.push(asWritten(from, start));
    if (stop > start) {
      const piece = { from: start, to: stop };
      made.push(...(readLine(text, piece, end, false, true, () => 0, pointAt) ?? readLine(text, piece, end, true, true, () => 0, pointAt) ?? [asWritten(start, stop)]));
    }
    if (to > stop) made.push(asWritten(stop, to));
  };
  let at = line.from;
  // The first link that ends behind the line's start.
  let low = 0, high = links.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (links[mid][1] <= line.from) low = mid + 1;
    else high = mid;
  }
  for (let n = low; n < links.length; n++) {
    const [from, to] = links[n];
    if (from >= line.to) break;
    if (from < at) continue;
    between(at, from);
    // The empty comment the reader writes in front of a link behind a `]` (`readerWikiLinkLead`) is no text.
    const start = text.startsWith("<!---->", from) ? from + "<!---->".length : from;
    const link = readLine(text, { from: start, to }, end, false, false, () => 1, pointAt);
    made.push(...(link ?? [asWritten(start, to)]));
    at = to;
  }
  between(at, line.to);
  return made;
}

/** The lines of a block formula, each without the marks of the containers it stands in and the blanks before it; a link over a line break joins its two lines. */
function blockLines(text: string, from: number, to: number, indent: number, quotes: number, linksIn: (from: number, to: number) => number): Line[] {
  const lines: Line[] = [];
  for (let at = from; ; ) {
    let start = at > from ? behindContainers(text, at, to, indent, quotes) : at;
    while (start < to && (text[start] === " " || text[start] === "\t")) start++;
    const brk = text.indexOf("\n", at);
    const end = brk === -1 || brk >= to ? to : brk;
    lines.push({ from: Math.min(start, end), to: end });
    if (end >= to) break;
    at = end + 1;
  }
  for (let k = 0; k + 1 < lines.length; k++) {
    if (linksIn(lines[k].to, lines[k].to + 1) > 0) {
      lines[k] = { from: lines[k].from, to: lines[k + 1].to };
      lines.splice(k + 1, 1);
      k--;
    }
  }
  return lines;
}

/**
 * Where a line of a formula begins behind the marks of the containers it
 * stands in: up to `indent` columns of blanks and of `>` — a `>` only as one
 * of the `quotes` the formula stands in. Every other sign is the line's own.
 */
function behindContainers(text: string, at: number, to: number, indent: number, quotes: number): number {
  let marks = 0;
  for (let skipped = 0; skipped < indent && at < to; skipped++, at++) {
    if (text[at] === ">") {
      if (marks === quotes) break;
      marks++;
    } else if (text[at] !== " " && text[at] !== "\t") break;
  }
  return at;
}

/** One line of a block formula read as the phrasing of one paragraph — behind a backslash at its first sign with `guard` —, or null where it is no paragraph or loses a link. `end` is where the formula ends. */
function readLine(text: string, line: Line, end: number, guard: boolean, codeSpans: boolean, linksIn: (from: number, to: number) => number, pointAt: (offset: number) => Point): MdNode[] | null {
  let sign = -1;
  if (guard) {
    let digits = line.from;
    while (digits < line.to && text.charCodeAt(digits) >= 48 && text.charCodeAt(digits) <= 57) digits++;
    sign = digits > line.from && (text[digits] === "." || text[digits] === ")") ? digits : ASCII_PUNCTUATION.test(text[line.from] ?? "") ? line.from : -1;
    if (sign < 0) return null;
  }
  let value = "";
  const map: number[] = [];
  for (let at = line.from; at < line.to; at++) {
    if (at === sign) {
      value += "\\";
      map.push(at);
    }
    value += text[at];
    map.push(at);
  }
  map.push(line.to);
  const blocks = (parseReaderTextTree(value, codeSpans ? {} : { codeSpans: false }) as unknown as MdNode).children ?? [];
  if (blocks.length !== 1 || blocks[0].type !== "paragraph") return null;
  const paragraph = blocks[0];
  if (line.to === end) unwrapCutAddresses(paragraph, value.length, text[end - 1] === "$");
  if (linksOf(paragraph) < linksIn(line.from, line.to)) return null;
  const move = (node: MdNode) => {
    if (node.position) node.position = { start: pointAt(map[Math.min(node.position.start.offset, map.length - 1)]), end: pointAt(map[Math.min(node.position.end.offset, map.length - 1)]) };
    for (const child of node.children ?? []) move(child);
  };
  const phrasing = paragraph.children ?? [];
  phrasing.forEach(move);
  return phrasing;
}

/**
 * Whether a formula as it is written — with its dollar signs — holds a wiki
 * link: the one answer for the reading view, which shows such a formula as
 * text with its link, and the editor's live preview, which leaves it as it is
 * written (Fehlerliste 0.9.0, B4). The link is the one the reading view reads.
 */
export function formulaHoldsWikiLink(written: string): boolean {
  return written.includes("[[") && prepareReaderSource(written).wikiLinks.length > 0;
}

/** How many wiki links and embeds stand in a tree. */
function linksOf(node: MdNode): number {
  const own = (node.type === "link" || node.type === "image") && typeof node.url === "string" && WIKI_URL.test(node.url) ? 1 : 0;
  return own + (node.children ?? []).reduce((sum, child) => sum + linksOf(child), 0);
}
