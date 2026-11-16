/**
 * Where a formula stands in a note: the editor's rule, which the reading view
 * reads by too (Sammelplan § 3.133 Nr. 5).
 *
 * Inline, on one line: `$$…$$`, or `$…$` with no blank inside either `$`, no
 * `$` or backslash in front of the opening one and no digit behind the
 * closing one — `$3 and $4` is no formula. A block: a line that begins with
 * `$$` and does not end with it, through the next line that ends with `$$`.
 * Code and HTML hold none; the callers leave them out.
 */
export const INLINE_MATH_SOURCE = String.raw`\$\$([^\n$]+?)\$\$|(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)`;

/** A new expression for the inline formulas of a text, global. */
export function inlineMathPattern(): RegExp {
  return new RegExp(INLINE_MATH_SOURCE, "g");
}

/** Whether a line opens a block formula: it begins with `$$` and does not close it again. */
export function opensMathBlock(line: string): boolean {
  const t = line.trim();
  return t.startsWith("$$") && !(t.length > 2 && t.endsWith("$$"));
}

/** Whether a line closes a block formula. */
export function closesMathBlock(line: string): boolean {
  return line.trim().endsWith("$$");
}
