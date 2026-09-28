/**
 * Linear stand-ins for the tag patterns that read CalDAV multistatus XML as
 * text (the component names live in attributes the XML parse drops). Every
 * one of them began `<[^>]*\bword\b`: from each "<" it read on to the next ">"
 * in search of the word, so a server answer with a long run of "<" cost
 * quadratic time (plan Befunde 24.09., E6).
 *
 * One pass is enough because `[^>]*` cannot cross a ">": every "<" between two
 * ">" sees a tail of the same stretch, and the first "<" of a stretch sees the
 * most of it. Where the pattern fails from that one, it fails from every later
 * one, so each stretch is decided once, from its first "<".
 *
 * Words are lowercase ASCII and compared the way `/i` without `u` compares:
 * ASCII letters fold, nothing else does, and `\b` knows only `[A-Za-z0-9_]`.
 */

/** `xml.split(/<[^>]*\bWORD\b[^>]*>/i)`. */
export function splitAtWordTags(xml: string, word: string): string[] {
  const pieces: string[] = [];
  let from = 0;
  let lt = -1;
  for (let start = 0; ; ) {
    const gt = xml.indexOf(">", start);
    if (gt < 0) break;
    if (lt < start) lt = indexOrEnd(xml, "<", start);
    if (lt < gt && hasWord(xml, lt + 1, gt, word)) {
      pieces.push(xml.slice(from, lt));
      from = gt + 1;
    }
    start = gt + 1;
  }
  pieces.push(xml.slice(from));
  return pieces;
}

/** `text.match(/<[^>]*\bWORD\b[^>]*>([\s\S]*?)<\/[^>]*\bWORD\b[^>]*>/i)?.[1]`. */
export function wordTagContent(text: string, word: string): string | undefined {
  let open = -1;
  let lt = -1;
  for (let start = 0; open < 0; ) {
    const gt = text.indexOf(">", start);
    if (gt < 0) return undefined;
    if (lt < start) lt = indexOrEnd(text, "<", start);
    if (lt < gt && hasWord(text, lt + 1, gt, word)) open = gt + 1;
    start = gt + 1;
  }
  // The content is lazy: it ends at the first closing tag with the word. A
  // later opening tag could only look further on, so no closing tag here
  // means no match at all.
  let close = -1;
  for (let start = open; ; ) {
    const gt = text.indexOf(">", start);
    if (gt < 0) return undefined;
    if (close < start) close = indexOrEnd(text, "</", start);
    if (close < gt && hasWord(text, close + 2, gt, word)) return text.slice(open, close);
    start = gt + 1;
  }
}

/**
 * The groups of `/<[^>]*\bTAG\b[^>]*\sATTRIBUTE\s*=\s*["']?([A-Za-z]+)/gi`, in
 * order. The pattern needs no closing ">", so the stretch after the last ">"
 * counts as well. Greedy `[^>]*` takes the LAST such attribute of a stretch,
 * provided the tag word stands before it; and a match ends inside its
 * stretch, which leaves nothing for a later "<" of the same stretch.
 */
export function tagAttributeWords(text: string, tag: string, attribute: string): string[] {
  const values: string[] = [];
  let lt = -1;
  for (let start = 0; start < text.length; ) {
    const gt = indexOrEnd(text, ">", start);
    if (lt < start) lt = indexOrEnd(text, "<", start);
    if (lt < gt) {
      const value = lastAttributeWord(text, lt, gt, tag, attribute);
      if (value !== undefined) values.push(value);
    }
    start = gt + 1;
  }
  return values;
}

function lastAttributeWord(text: string, lt: number, gt: number, tag: string, attribute: string): string | undefined {
  for (let at = gt - 1; at > lt; at--) {
    const value = attributeWordAt(text, at, attribute);
    // Only the last attribute counts: an earlier one has even less room for the tag word.
    if (value !== undefined) return hasWord(text, lt + 1, at, tag) ? value : undefined;
  }
  return undefined;
}

const SPACE = /\s/;

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && SPACE.test(ch);
}

/** The value of `\sATTRIBUTE\s*=\s*["']?([A-Za-z]+)` when it starts at `at`. */
function attributeWordAt(text: string, at: number, attribute: string): string | undefined {
  if (!isSpace(text[at]) || !wordAt(text, at + 1, attribute)) return undefined;
  let i = at + 1 + attribute.length;
  while (isSpace(text[i])) i++;
  if (text[i] !== "=") return undefined;
  i++;
  while (isSpace(text[i])) i++;
  if (text[i] === '"' || text[i] === "'") i++;
  const from = i;
  while (isAsciiLetter(text.charCodeAt(i))) i++;
  return i > from ? text.slice(from, i) : undefined;
}

/** Whether `\bWORD\b` lies within [from, to). */
function hasWord(text: string, from: number, to: number, word: string): boolean {
  for (let at = from; at + word.length <= to; at++) {
    if (wordAt(text, at, word) && !isWordChar(text.charCodeAt(at - 1)) && !isWordChar(text.charCodeAt(at + word.length))) return true;
  }
  return false;
}

function wordAt(text: string, at: number, word: string): boolean {
  for (let i = 0; i < word.length; i++) {
    let code = text.charCodeAt(at + i);
    if (code >= 65 && code <= 90) code += 32;
    if (code !== word.charCodeAt(i)) return false;
  }
  return true;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isWordChar(code: number): boolean {
  return isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 95;
}

/** Where `search` next occurs, or the text's length: a cursor that only moves forward. */
function indexOrEnd(text: string, search: string, from: number): number {
  const at = text.indexOf(search, from);
  return at < 0 ? text.length : at;
}
