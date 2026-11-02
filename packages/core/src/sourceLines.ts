/**
 * A note's lines as an editor reads them, each with the line end it has in the
 * file — for the scanners that count lines in the file's own text and the
 * writers that change one line by that count.
 *
 * A line ends where an editor ends it (`readTextShape`): at `\n`, at `\r\n`,
 * at a carriage return of its own — the line end of a file from a classic Mac
 * — and at `\r\r\n`, which is ONE (a Windows file whose line ends were
 * converted twice). The task scan and the writers of a checkbox split at `\n`
 * alone: a note whose lines end in `\r` was one line to them, a promoted task
 * took the next lines into its title, and `- [ ]\r- [ ] b` was read as one task
 * "- [ ] b" (open-items plan 3.96 "remains", 3.142 no. 2 and 3). The editor,
 * the journal and the index's reader of the block saw lines there all along.
 *
 * Nothing is lost: joining every line with its end gives the text back, and a
 * text that ends in a line end has an empty last line, as `split("\n")` has.
 */
export interface SourceLine {
  /** The line without its line end. */
  text: string;
  /** The line end it has in the file; "" for the last line. */
  eol: string;
}

/** A line end as an editor reads it; at most three characters, `\r\r\n` first. */
export const SOURCE_LINE_END = /\r\r\n|\r\n|\r|\n/g;

/** The lines of a text, each with its line end. */
export function sourceLinesOf(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const ends = new RegExp(SOURCE_LINE_END.source, "g");
  let cursor = 0;
  for (let match = ends.exec(text); match; match = ends.exec(text)) {
    lines.push({ text: text.slice(cursor, match.index), eol: match[0] });
    cursor = match.index + match[0].length;
  }
  lines.push({ text: text.slice(cursor), eol: "" });
  return lines;
}

/** The text again, from its lines. */
export function joinSourceLines(lines: readonly SourceLine[]): string {
  let text = "";
  for (const line of lines) text += line.text + line.eol;
  return text;
}
