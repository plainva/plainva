/**
 * Content font-size limits (shared contract, M3E package D6): the note
 * content's `--content-font-size` is user-adjustable on BOTH shells within the
 * same 12–24 px window (GitHub issue #5, a11y). The desktop keeps its store
 * persistence and family handling in apps/desktop/src/services/contentFont.ts;
 * mobile persists through mobileSettings.
 */

export const DEFAULT_CONTENT_FONT_SIZE = 16;
export const MIN_CONTENT_FONT_SIZE = 12;
export const MAX_CONTENT_FONT_SIZE = 24;

export function clampContentFontSize(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_CONTENT_FONT_SIZE;
  return Math.min(MAX_CONTENT_FONT_SIZE, Math.max(MIN_CONTENT_FONT_SIZE, Math.round(n)));
}
