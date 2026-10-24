/**
 * How a link to a note looks, in one place.
 *
 * The look is a device setting (linkStyle.ts, maintainer 2026-10-23):
 * underlined (the default, as up to 0.8.5), tinted (the tester's wish of
 * 2026-10-19), colour only, or subtle. The setting only moves tokens; these
 * values read them. A link to a note that doesn't exist yet stays muted and
 * dashed whatever the setting says.
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
  color: "var(--wiki-link-text, var(--wiki-link-color, var(--accent-color)))",
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
