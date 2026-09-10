/**
 * The anchor of a link target (issue #92, plan Kalender, Anker-Links,
 * Dependabot 2026-09-10, P5): `Note#Heading`, `Note#^block`, `#Heading`
 * (the same note), `other.md#heading`.
 *
 * ONE split above the core, the same rule the core's scanner applies
 * (`parseLinkTarget` in ast-scanner.ts: the first `#` or `^`, whichever comes
 * first). Six places used to do `split("#")[0]` and throw the rest away —
 * which is why a click on `[[Note#Section]]` opened the note at the top and
 * `[[#Section]]` did nothing at all. The anchor keeps its marker, so a caller
 * can tell a heading (`#…`) from a block (`^…` or `#^…`).
 */
export interface SplitLink {
  /** The note part, trimmed; empty for a same-note anchor. */
  target: string;
  /** `#Heading`, `#^block`, `^block` — or null when there is none. */
  anchor: string | null;
}

export function splitLinkAnchor(raw: string): SplitLink {
  const s = raw.trim();
  const hash = s.indexOf("#");
  const caret = s.indexOf("^");
  let at = -1;
  if (hash !== -1 && caret !== -1) at = Math.min(hash, caret);
  else if (hash !== -1) at = hash;
  else if (caret !== -1) at = caret;
  if (at === -1) return { target: s, anchor: null };
  const anchor = s.slice(at).trim();
  return { target: s.slice(0, at).trim(), anchor: anchor.length > 1 ? anchor : null };
}

/** True for a block reference (`^id` or `#^id`), false for a heading. */
export function isBlockAnchor(anchor: string): boolean {
  return anchor.startsWith("^") || anchor.startsWith("#^");
}
