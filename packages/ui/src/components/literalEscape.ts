/**
 * Whether the character at `index` is escaped: an odd run of backslashes
 * before it. `\![[a.png]]` is text; `\\![[a.png]]` is a backslash and then
 * the embed.
 */
export function isEscapedAt(text: string, index: number): boolean {
  let slashes = 0;
  for (let at = index - 1; at >= 0 && text[at] === "\\"; at--) slashes++;
  return slashes % 2 === 1;
}
