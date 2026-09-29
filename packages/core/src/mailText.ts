/**
 * Linear readers for mail header values and mail notes. A header value is
 * whatever the sending server wrote, so a pattern that turns quadratic on a
 * long run of blanks is one a stranger can stall the mail list with (plan
 * Befunde 24.09., E6).
 */

/**
 * The display name in front of an angle address: the group of
 * `/^\s*"?([^"<]+?)"?\s*</`, or with `whole` the group of
 * `/^\s*"?([^"<]+?)"?\s*<[^>]*>\s*$/`, where the address has to close and
 * only blanks may follow it. `undefined` where the pattern does not match.
 *
 * The patterns shared one run of blanks between three quantifiers and tried
 * every split of it again when the text went on differently. Here every
 * position is looked at once, and the lazy group keeps its quirks: a name of
 * nothing but blanks comes out as the last blank before the "<" (or before a
 * lone quote), which the callers trim and then fall back on.
 */
export function nameBeforeAngle(text: string, whole = false): string | undefined {
  // Neither the blanks, the quotes nor the name can hold a "<": the
  // pattern's "<" is the first one.
  const lt = text.indexOf("<");
  if (lt < 0) return undefined;
  if (whole) {
    // `[^>]*>` closes at the first ">" after it; only blanks may follow.
    const gt = text.indexOf(">", lt + 1);
    if (gt < 0 || text.slice(gt + 1).trimStart() !== "") return undefined;
  }
  const head = text.slice(0, lt);
  // trimStart/trimEnd drop exactly the characters `\s` matches.
  const lead = head.length - head.trimStart().length;
  const tail = head.trimEnd().length;
  const open = head[lead] === '"' ? lead + 1 : lead;
  if (open >= head.length) return lead > 0 ? head[lead - 1] : undefined;
  // The name holds no quote. Lazily it ends at a quote that only blanks
  // follow, else where the trailing blanks begin, and never before its first
  // character.
  const quote = head.indexOf('"', open);
  const stop = quote < 0 ? head.length : quote;
  if (stop === tail - 1 && stop > open) return head.slice(open, stop);
  const end = Math.max(open + 1, tail);
  return stop >= end ? head.slice(open, end) : undefined;
}

/**
 * Whether the text links a raw message copy — `/\[\[[^\]]+\.eml\]\]/i` in one
 * pass. The pattern ran `[^\]]+` from every "[[" on to the next "]" again,
 * which is quadratic on a long run of "[". A link target holds no "]", so at
 * each "]]" only the first "[[" since the previous "]" matters.
 */
export function hasEmlWikiLink(text: string): boolean {
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "]") {
      // "[[", at least one character, ".eml": the "]]" is 7 or more further on.
      if (open >= 0 && i - open >= 7 && text[i + 1] === "]" && endsWithEml(text, i)) return true;
      open = -1;
    } else if (ch === "[" && open < 0 && text[i + 1] === "[") {
      open = i;
    }
  }
  return false;
}

/** ".eml" right before `end`, folding ASCII case only, as `/i` without `u` does. */
function endsWithEml(text: string, end: number): boolean {
  const e = text[end - 3], m = text[end - 2], l = text[end - 1];
  return text[end - 4] === "." && (e === "e" || e === "E") && (m === "m" || m === "M") && (l === "l" || l === "L");
}
