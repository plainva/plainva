import { parseHeadings, slugify } from "./outline";
import { isBlockAnchor } from "./linkAnchor";

/**
 * Where an anchor points inside a note (issue #92, P5). Two spellings resolve,
 * because two worlds write them: Obsidian writes the heading's own text
 * (`[[Note#Cool Header]]`), GitHub writes the slug (`#cool-header`). A block
 * reference (`^id`) is the line that ends in ` ^id`.
 *
 * Order (decision E5): the literal heading text, case-insensitive, wins; then
 * the slug — against the de-duplicated slug the outline assigns (`heading`,
 * `heading-1`) AND the plain slug of the text, so `#heading-1` reaches the
 * second "Heading" and `#cool-header` reaches "Cool Header" either way. The
 * first heading in document order wins a tie. An Obsidian nested anchor
 * (`Note#Outer#Inner`) names the innermost heading.
 */
export interface AnchorHit {
  /** 1-based line, as the outline and the editor count. */
  line: number;
  /** The heading's id in the reading view; null for a block. */
  slug: string | null;
  kind: "heading" | "block";
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function resolveAnchor(content: string, anchor: string): AnchorHit | null {
  let a = anchor.trim();
  if (!a) return null;
  if (isBlockAnchor(a)) {
    const id = a.replace(/^#?\^/, "").trim();
    if (!id) return null;
    const re = new RegExp(`\\s\\^${escapeRe(id)}\\s*$`, "i");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) return { line: i + 1, slug: null, kind: "block" };
    }
    return null;
  }
  if (a.startsWith("#")) a = a.slice(1);
  let text = a;
  try {
    text = decodeURIComponent(a);
  } catch {
    /* a literal %, not an encoding */
  }
  const want = (text.split("#").filter(Boolean).pop() ?? "").trim();
  if (!want) return null;
  const headings = parseHeadings(content);
  const wantLower = want.toLowerCase();
  const byText = headings.find((h) => h.text.toLowerCase() === wantLower);
  if (byText) return { line: byText.line, slug: byText.slug, kind: "heading" };
  const wantSlug = slugify(want);
  if (!wantSlug) return null;
  const bySlug = headings.find((h) => h.slug === wantSlug || slugify(h.text) === wantSlug);
  if (bySlug) return { line: bySlug.line, slug: bySlug.slug, kind: "heading" };
  return null;
}
