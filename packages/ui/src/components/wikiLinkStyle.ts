/**
 * How a wiki link looks, in one place (wish from TestFlight, 2026-10-19).
 *
 * Accent color plus an underline was all a wiki link had; Petrol sits close
 * to the body text in lightness, so mostly the line carried it - and a web
 * link has the same line. A wiki link now wears a light tint of its color and
 * a little more weight, and gets its line only under the pointer; a web link
 * keeps its underline, so the two tell apart at a glance. A link to a note
 * that doesn't exist yet stays muted and dashed, without the tint.
 *
 * The values are tokens (`--wiki-link-*`, base-colors.css), so a theme can
 * change them. Every surface that draws a wiki link uses these: the editor's
 * mark (`.cm-wiki-link`, both shells, also the phone's reading view), links in
 * rendered table cells, and - through the same tokens in ui.css
 * (`.pv-wiki-link`) - the desktop's reading view and card previews. The
 * maintainer asked that the live-preview link look the same as in reading
 * mode; `wishes10b.test.ts` (desktop) holds ui.css to these values.
 */
export const WIKI_LINK_STYLE = {
  color: "var(--wiki-link-color, var(--accent-color))",
  backgroundColor: "var(--wiki-link-bg)",
  borderRadius: "var(--radius-xs)",
  // No padding: a mark the editor splits (a search hit, a comment inside
  // the link) would otherwise show as separate pills with gaps.
  padding: "0",
  fontWeight: "var(--wiki-link-weight)",
  textDecoration: "var(--wiki-link-decoration)",
  textUnderlineOffset: "3px",
  WebkitBoxDecorationBreak: "clone",
  boxDecorationBreak: "clone",
  cursor: "pointer",
} as const;

/** Under the pointer: a stronger tint and the line. */
export const WIKI_LINK_HOVER_STYLE = {
  // The reading view's `a:hover` would otherwise change the colour.
  color: "var(--wiki-link-color, var(--accent-color))",
  backgroundColor: "var(--wiki-link-bg-hover)",
  textDecoration: "underline",
} as const;

/** The target note doesn't exist yet: muted, dashed, no tint, normal weight. */
export const WIKI_LINK_UNRESOLVED_STYLE = {
  color: "var(--wiki-link-unresolved-color, var(--text-muted))",
  backgroundColor: "transparent",
  padding: "0",
  fontWeight: "inherit",
  textDecoration: "underline dashed",
} as const;
