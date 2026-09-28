/**
 * The HTML task box: an `<input type="checkbox">` written into a Markdown file
 * (finding 2026-09-22). GFM knows task boxes only in LIST items, so a checklist
 * inside a table cell has no Markdown spelling — Obsidian users write the tag
 * there, and Obsidian draws it. Plainva draws it too (`readHtmlCheckbox`, used
 * by both renderers) and ticks it in place (`setHtmlCheckboxChecked`).
 *
 * ONE hand-written tokenizer answers for reader and writer (plan Befunde
 * 24.09., E6). The regular expressions it replaces took exponential time on a
 * tag like `<input -="" -="" -="" … !>`: every `""` was both a quoted and an
 * unquoted value, and a rejecting end made the engine try every combination.
 * Such a tag can come from outside — an event description, a guest comment —
 * and froze the window.
 *
 * The grammar is the old one, decision for decision, so no file reads
 * differently than before:
 *
 * - The tag is `<input` (any case), a list of attributes, optional whitespace,
 *   an optional `/` and `>`. An attribute is whitespace, a name of ASCII
 *   letters and `-`, and optionally `=` (whitespace around it allowed) with a
 *   double-quoted, single-quoted or bare value — a bare value runs up to
 *   whitespace or `>`, quotes included.
 * - Where the grammar allows two readings, the one the old pattern tried first
 *   wins: a value before none, quoted before bare, one more attribute before
 *   the end of the tag. The first reading that closes the tag is found by
 *   deciding every position ONCE, from the end of the text backwards — linear
 *   time, and no recursion however many attributes a tag has.
 * - The attribute list of a tag is then read left to right the way the old
 *   attribute pattern read it: whitespace, name, optional value; text that is
 *   no attribute is stepped over.
 *
 * ONE element, TWO attributes: a tag carrying anything else — a handler, a
 * name, a value, another type — is not one of ours and stays the text it was.
 */

const SPACE = /\s/;
const isSpace = (ch: string | undefined): boolean => ch !== undefined && SPACE.test(ch);
/** `[a-zA-Z-]` — also under the old case-insensitive flag, which folds no other character into it. */
const isNameCode = (code: number): boolean => (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 45;

/** One attribute as read from a tag; `from`/`to` include the whitespace before it. */
export interface HtmlInputAttribute {
  name: string;
  value: string | null;
  from: number;
  to: number;
}

interface Tables {
  /** First index at or after i that is not whitespace. */
  spaceEnd: Int32Array;
  /** First index at or after i that is no name character. */
  nameEnd: Int32Array;
  /** First index at or after i that is whitespace or `>` — where a bare value stops. */
  bareEnd: Int32Array;
  /** First `"` / `'` at or after i, or -1. */
  nextDouble: Int32Array;
  nextSingle: Int32Array;
}

function tablesOf(text: string): Tables {
  const n = text.length;
  const spaceEnd = new Int32Array(n + 1), nameEnd = new Int32Array(n + 1), bareEnd = new Int32Array(n + 1);
  const nextDouble = new Int32Array(n + 1), nextSingle = new Int32Array(n + 1);
  spaceEnd[n] = n; nameEnd[n] = n; bareEnd[n] = n; nextDouble[n] = -1; nextSingle[n] = -1;
  for (let i = n - 1; i >= 0; i--) {
    const ch = text[i], space = isSpace(ch);
    spaceEnd[i] = space ? spaceEnd[i + 1] : i;
    nameEnd[i] = isNameCode(text.charCodeAt(i)) ? nameEnd[i + 1] : i;
    bareEnd[i] = space || ch === ">" ? i : bareEnd[i + 1];
    nextDouble[i] = ch === "\"" ? i : nextDouble[i + 1];
    nextSingle[i] = ch === "'" ? i : nextSingle[i + 1];
  }
  return { spaceEnd, nameEnd, bareEnd, nextDouble, nextSingle };
}

/** Where the tag closes when its attribute list ends at `at` — `\s*\/?>` — or -1. */
function closeAt(text: string, tables: Tables, at: number): number {
  const s = tables.spaceEnd[at];
  if (text[s] === "/" && text[s + 1] === ">") return s + 2;
  return text[s] === ">" ? s + 1 : -1;
}

/**
 * For every position of `text`: where an attribute list starting there ends on
 * the first reading that closes the tag, or -1. `whole` demands that the tag
 * closes at the end of the text (the reader's question about one tag).
 */
function attributeListEnds(text: string, tables: Tables, whole: boolean): Int32Array {
  const n = text.length;
  const { spaceEnd, nameEnd, bareEnd, nextDouble, nextSingle } = tables;
  const ends = new Int32Array(n + 1);
  for (let p = n; p >= 0; p--) {
    let found = -1;
    // Every continuation lies further right, so it is decided already.
    const tryFrom = (next: number) => { if (found < 0) found = ends[next]; };
    if (isSpace(text[p])) {
      const name = spaceEnd[p];
      if (name < n && isNameCode(text.charCodeAt(name))) {
        const nameStop = nameEnd[name];
        const equals = spaceEnd[nameStop];
        if (text[equals] === "=") {
          const value = spaceEnd[equals + 1];
          if (value < n) {
            const quote = text[value];
            const close = quote === "\"" ? nextDouble[value + 1] : quote === "'" ? nextSingle[value + 1] : -1;
            if (close >= 0) tryFrom(close + 1);
            if (quote !== ">") tryFrom(bareEnd[value]);
          }
        }
        tryFrom(nameStop);
      }
    }
    if (found < 0) {
      const close = closeAt(text, tables, p);
      if (close >= 0 && (!whole || close === n)) found = p;
    }
    ends[p] = found;
  }
  return ends;
}

/** `<input` at `at`, in any case. */
function opensInput(text: string, at: number): boolean {
  if (text[at] !== "<") return false;
  for (let k = 0; k < 5; k++) if ((text.charCodeAt(at + 1 + k) | 0x20) !== "input".charCodeAt(k)) return false;
  return true;
}

const INPUT_OPEN = 6; // "<input".length

/** The attributes of an attribute list, read left to right; offsets are relative to `list`. */
function readAttributes(list: string): HtmlInputAttribute[] {
  const attributes: HtmlInputAttribute[] = [];
  const n = list.length;
  const lastDouble = list.lastIndexOf("\""), lastSingle = list.lastIndexOf("'");
  const skipSpace = (i: number) => { while (i < n && isSpace(list[i])) i++; return i; };
  let at = 0;
  while (at < n) {
    if (!isSpace(list[at])) { at++; continue; }
    const name = skipSpace(at);
    // No name after this whitespace: no attribute starts anywhere inside it.
    if (name >= n || !isNameCode(list.charCodeAt(name))) { at = name; continue; }
    let nameStop = name;
    while (nameStop < n && isNameCode(list.charCodeAt(nameStop))) nameStop++;
    let value: string | null = null, to = nameStop;
    const equals = skipSpace(nameStop);
    if (list[equals] === "=") {
      const start = skipSpace(equals + 1);
      const quote = list[start];
      if (quote === "\"" && start < lastDouble) {
        const close = list.indexOf("\"", start + 1);
        value = list.slice(start + 1, close); to = close + 1;
      } else if (quote === "'" && start < lastSingle) {
        const close = list.indexOf("'", start + 1);
        value = list.slice(start + 1, close); to = close + 1;
      } else if (start < n && quote !== ">") {
        let stop = start;
        while (stop < n && !isSpace(list[stop]) && list[stop] !== ">") stop++;
        value = list.slice(start, stop); to = stop;
      }
    }
    attributes.push({ name: list.slice(name, nameStop), value, from: at, to });
    at = to;
  }
  return attributes;
}

/** One whole `<input …>` tag, read: its attributes with offsets relative to the tag. Null when `tag` is no such tag. */
export function readHtmlInputTag(tag: string): { attributes: HtmlInputAttribute[] } | null {
  if (!opensInput(tag, 0)) return null;
  const tables = tablesOf(tag);
  const listEnd = attributeListEnds(tag, tables, true)[INPUT_OPEN];
  if (listEnd < 0) return null;
  const attributes = readAttributes(tag.slice(INPUT_OPEN, listEnd))
    .map((a) => ({ ...a, from: a.from + INPUT_OPEN, to: a.to + INPUT_OPEN }));
  return { attributes };
}

/** Every `<input …>` tag in one line of text, left to right, as `[from, to)` ranges. */
export function htmlInputTagRanges(line: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  let at = line.indexOf("<");
  if (at < 0) return ranges;
  let tables: Tables | null = null, ends: Int32Array | null = null;
  while (at >= 0) {
    if (opensInput(line, at)) {
      tables ??= tablesOf(line);
      ends ??= attributeListEnds(line, tables, false);
      const listEnd = ends[at + INPUT_OPEN];
      if (listEnd >= 0) {
        const to = closeAt(line, tables, listEnd);
        ranges.push({ from: at, to });
        at = line.indexOf("<", to);
        continue;
      }
    }
    at = line.indexOf("<", at + 1);
  }
  return ranges;
}

function checkboxOf(attributes: HtmlInputAttribute[]): { checked: boolean } | null {
  let type: string | null = null;
  let checked = false;
  for (const attribute of attributes) {
    const name = attribute.name.toLowerCase();
    if (name === "type") type = (attribute.value ?? "").toLowerCase();
    else if (name === "checked") checked = true;
    else return null;
  }
  return type === "checkbox" ? { checked } : null;
}

/**
 * Whether a tag is one of our boxes, and whether it is ticked. Reader and
 * writer ask this same question, or their ordinals drift apart and a tick
 * lands on the wrong row.
 */
export function readHtmlCheckbox(tag: string): { checked: boolean } | null {
  const read = readHtmlInputTag(tag.trim());
  return read ? checkboxOf(read.attributes) : null;
}

/** `checked` at `at`, in any ASCII case — as the old case-insensitive pattern compared it. */
function spellsChecked(text: string, at: number): boolean {
  for (let k = 0; k < 7; k++) if ((text.charCodeAt(at + k) | 0x20) !== "checked".charCodeAt(k)) return false;
  return true;
}

/**
 * The same tag with `checked` set or removed. Everything else stays byte for
 * byte: a vault file is the user's, and a rewrite that tidies attributes is a
 * rewrite they did not ask for.
 *
 * Setting puts ` checked` before the closing `>` / `/>`; whitespace before it
 * folds into that one space. Clearing removes the first `checked` that follows
 * whitespace, with its value if it has one. Both are offsets found by one pass
 * over the tag — the same edits the old patterns made, without their
 * quadratic retries on a long run of spaces.
 */
export function withHtmlCheckboxChecked(tag: string, checked: boolean): string {
  const n = tag.length;
  if (checked) {
    const gt = n - 1;
    const close = tag[gt - 1] === "/" ? gt - 1 : gt;
    let from = close;
    while (from > 0 && isSpace(tag[from - 1])) from--;
    return `${tag.slice(0, from)} checked${tag.slice(close)}`;
  }
  const skipSpace = (i: number) => { while (i < n && isSpace(tag[i])) i++; return i; };
  let at = 0;
  while (at < n) {
    if (!isSpace(tag[at])) { at++; continue; }
    const name = skipSpace(at);
    if (!spellsChecked(tag, name)) { at = name; continue; }
    let to = name + 7;
    const equals = skipSpace(to);
    if (tag[equals] === "=") {
      const value = skipSpace(equals + 1);
      const quote = tag[value];
      const close = quote === "\"" || quote === "'" ? tag.indexOf(quote, value + 1) : -1;
      if (close >= 0) to = close + 1;
      else {
        to = value;
        while (to < n && !isSpace(tag[to]) && tag[to] !== ">") to++;
      }
    }
    return tag.slice(0, at) + tag.slice(to);
  }
  return tag;
}
