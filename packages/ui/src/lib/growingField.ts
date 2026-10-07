/**
 * A field that is as tall as its text (issue 118).
 *
 * A table cell wraps while it is read and used to collapse into one line the
 * moment it was edited, so a long value could only be read through a keyhole
 * while it was being changed. The three cell editors — the database table on
 * the desktop, its sheet on the phone, the Markdown table in a note — now edit
 * in a field that grows with the text and wraps at its own width. These are
 * the rules they share; the elements themselves stay native.
 */

/** Sets the field's height to its content. Call after every change of its text or width. */
export function fitFieldHeight(field: HTMLTextAreaElement): void {
  // Collapse first: scrollHeight never shrinks below the current height.
  field.style.height = "auto";
  // scrollHeight stops at the padding; a field sized border-box needs its
  // borders on top, or the last two pixels of the text scroll out of view.
  const borders = field.offsetHeight - field.clientHeight;
  field.style.height = `${field.scrollHeight + borders}px`;
}

/**
 * A value that is ONE line of text, however it was typed or pasted.
 *
 * A database cell holds a property value, and a text property with a line
 * break in it cannot be edited as text in Obsidian's property view. So the
 * field wraps softly and a hard break — a pasted paragraph — becomes a space,
 * as it did in the one-line field before it.
 */
export function asSingleLineValue(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length === 1) return text;
  const last = lines.length - 1;
  // The space around a break goes with it, and a run of breaks is one space.
  return lines
    .map((line, index) => (index === 0 ? line.trimEnd() : index === last ? line.trimStart() : line.trim()))
    .filter((line, index) => index === 0 || index === last || line !== "")
    .join(" ");
}

const BREAK = /<br\s*\/?>/gi;

/**
 * A Markdown table cell as it is edited: its `<br>` are real line breaks.
 * A GFM cell cannot hold a newline, so `<br>` is how a break is written there
 * (and how every renderer, Plainva's included, already shows it).
 */
export function tableCellToEditText(cell: string): string {
  return cell.replace(BREAK, "\n");
}

/** The edited text back as a cell: every line break is written as `<br>`. */
export function editTextToTableCell(text: string): string {
  return text.replace(/\r?\n/g, "<br>");
}
