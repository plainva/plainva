/** Linear scans for text received from vaults, providers and account profiles. */
export function trimEndChars(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) end--;
  return text.slice(0, end);
}

export function trimChars(text: string, chars: string): string {
  let start = 0, end = text.length;
  while (start < end && chars.includes(text[start])) start++;
  while (end > start && chars.includes(text[end - 1])) end--;
  return text.slice(start, end);
}

export function trimStartChars(text: string, chars: string): string {
  let start = 0;
  while (start < text.length && chars.includes(text[start])) start++;
  return text.slice(start);
}

/** What `$` stands before under the `m` flag: every line terminator. */
const LINE_TERMINATORS = "\n\r\u2028\u2029";

/**
 * Drops every run of spaces and tabs that stands right before one of `ends`,
 * and at the very end of the text when `atEnd` — `/[ \t]+$/gm` (the defaults)
 * or `/[ \t]+\n/g` (`ends` "\n", `atEnd` false) in one pass. The patterns
 * retried the run from each of its characters when it did not end a line,
 * which is quadratic on a long run of blanks.
 */
export function trimSpaceBeforeLineEnds(text: string, ends: string = LINE_TERMINATORS, atEnd = true): string {
  let out = "", from = 0, run = -1;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (ch === " " || ch === "\t") {
      if (run < 0) run = i;
      continue;
    }
    if (run >= 0 && (i === text.length ? atEnd : ends.includes(ch))) {
      out += text.slice(from, run);
      from = i;
    }
    run = -1;
  }
  return out + text.slice(from);
}

export interface DelimitedText { index: number; end: number; inner: string; raw: string }
/** Failed closers stop the scan instead of retrying the entire remaining suffix. */
export function* delimitedText(text: string, open: string, close: string): Generator<DelimitedText> {
  if (!open || !close) throw new Error("Empty text delimiter");
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.indexOf(open, cursor);
    if (index < 0) return;
    const content = index + open.length;
    const stop = text.indexOf(close, content);
    if (stop < 0) return;
    const end = stop + close.length;
    yield { index, end, inner: text.slice(content, stop), raw: text.slice(index, end) };
    cursor = end;
  }
}

export function firstAngleValue(text: string): string | undefined {
  for (const part of delimitedText(text, "<", ">")) if (part.inner) return part.inner;
  return undefined;
}

/** Identity hint only: this does not verify ownership or authorize a provider. */
export function isSimpleEmail(text: string): boolean {
  const at = text.indexOf("@");
  return at > 0 && at === text.lastIndexOf("@") && !/\s/.test(text) && text.slice(at + 2, -1).includes(".");
}

export function replaceDelimited(text: string, open: string, close: string, replace: (raw: string, inner: string) => string): string {
  const pieces: string[] = [];
  let cursor = 0;
  for (const part of delimitedText(text, open, close)) {
    pieces.push(text.slice(cursor, part.index), replace(part.raw, part.inner));
    cursor = part.end;
  }
  pieces.push(text.slice(cursor));
  return pieces.join("");
}

export interface MarkdownLinkToken { index: number; end: number; label: string; destination: string }
/** Delimiters advance monotonically, including on malformed input. */
export function* markdownLinks(text: string): Generator<MarkdownLinkToken> {
  let cursor = 0;
  while (cursor < text.length) {
    const index = text.indexOf("[", cursor);
    if (index < 0) return;
    const labelEnd = text.indexOf("]", index + 1);
    if (labelEnd < 0) return;
    cursor = labelEnd + 1;
    if (text[cursor] !== "(") continue;
    const end = text.indexOf(")", cursor + 1);
    if (end < 0) return;
    yield { index, end: end + 1, label: text.slice(index + 1, labelEnd), destination: text.slice(cursor + 1, end) };
    cursor = end + 1;
  }
}

/** CommonMark code spans pair backtick runs of exactly the same length. */
export function codeSpanRanges(text: string): Array<{ from: number; to: number }> {
  const runs: Array<{ from: number; to: number; next: number }> = [];
  const previous = new Map<number, number>();
  for (let i = 0; i < text.length;) {
    if (text[i] !== "`") { i++; continue; }
    const from = i;
    while (text[i] === "`") i++;
    const length = i - from, prior = previous.get(length);
    if (prior !== undefined) runs[prior].next = runs.length;
    previous.set(length, runs.length);
    runs.push({ from, to: i, next: -1 });
  }
  const ranges: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    // An escaped opener is literal; closers inside a span are not escaped.
    let slash = run.from;
    while (slash > 0 && text[slash - 1] === "\\") slash--;
    if ((run.from - slash) % 2 || run.next < 0) continue;
    ranges.push({ from: run.from, to: runs[run.next].to });
    i = run.next;
  }
  return ranges;
}
