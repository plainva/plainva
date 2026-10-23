/**
 * How links look - a device setting (maintainer, 2026-10-23).
 *
 * 0.8.6 took the tint for note links over from one tester's wish and took the
 * line away for everybody. One person's taste is not a default: the look is a
 * choice under Appearance, the same in both shells, and the default stays what
 * every version up to 0.8.5 showed - a coloured, underlined link.
 *
 * Two choices, because many people want to tell the two apart at a glance:
 * - a link to a NOTE (a wiki link, or a Markdown link into the vault):
 *   underlined, tinted, colour only, or subtle (text colour, dotted line);
 * - a link to the WEB: underlined or colour only.
 *
 * Two things do not change with the choice. A link to a note that does not
 * exist yet stays muted and dashed - that is a signal, not taste. And the high
 * contrast theme underlines every link (ui.css scopes the choices with
 * `:not([data-theme-name="high-contrast"])`).
 *
 * The choice is an attribute on <html>; the `--wiki-link-*` and `--web-link-*`
 * tokens under it do the drawing, so every surface that draws a link (the
 * editor, the reading view, table cells, card previews, the phone) follows
 * without knowing about the setting. The tag colour switch works the same way.
 */

export type NoteLinkStyle = "underline" | "tint" | "color" | "subtle";
export type WebLinkStyle = "underline" | "color";

export const NOTE_LINK_STYLES: readonly NoteLinkStyle[] = ["underline", "tint", "color", "subtle"];
export const WEB_LINK_STYLES: readonly WebLinkStyle[] = ["underline", "color"];
export const DEFAULT_NOTE_LINK_STYLE: NoteLinkStyle = "underline";
export const DEFAULT_WEB_LINK_STYLE: WebLinkStyle = "underline";

/** Settings keys, the same in both shells' device stores. */
export const NOTE_LINK_STYLE_KEY = "noteLinkStyle";
export const WEB_LINK_STYLE_KEY = "webLinkStyle";

export function readNoteLinkStyle(value: unknown): NoteLinkStyle {
  return NOTE_LINK_STYLES.includes(value as NoteLinkStyle) ? (value as NoteLinkStyle) : DEFAULT_NOTE_LINK_STYLE;
}

export function readWebLinkStyle(value: unknown): WebLinkStyle {
  return WEB_LINK_STYLES.includes(value as WebLinkStyle) ? (value as WebLinkStyle) : DEFAULT_WEB_LINK_STYLE;
}

/** Writes the choice onto <html>. The default is the absence of the attribute. No-op without a DOM. */
export function applyLinkStyle(note: NoteLinkStyle, web: WebLinkStyle): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (note === DEFAULT_NOTE_LINK_STYLE) root.removeAttribute("data-link-note");
  else root.setAttribute("data-link-note", note);
  if (web === DEFAULT_WEB_LINK_STYLE) root.removeAttribute("data-link-web");
  else root.setAttribute("data-link-web", web);
}

/**
 * Whether a Markdown link's target leads into the vault (a note, a place in
 * this note) rather than out of it. Anything with a scheme - https:, mailto:,
 * obsidian: - leaves the vault and wears the web link's look.
 */
export function isNoteLinkTarget(target: string): boolean {
  return target.trim() !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(target.trim());
}
