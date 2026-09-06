/**
 * Content font-size limits (shared contract, M3E package D6): the note
 * content's `--content-font-size` is user-adjustable on BOTH shells within the
 * same 12–24 px window (GitHub issue #5, a11y). Each shell binds its own store
 * (desktop: apps/desktop/src/services/appFonts.ts, mobile: mobileSettings).
 *
 * S39 moved the FAMILY here too; the plan Issue-Durchsicht 2026-09-06 (P2)
 * generalised it into three slots in `appFonts.ts` — interface, content and
 * code share one model now. This file keeps the size contract and the
 * content-slot names other code still imports.
 */

import { applyAppFont, resolveFontChoiceValue, type ContentFontFamily } from "./appFonts";

export {
  FONT_FAMILY_STACKS,
  isContentFontFamily,
  sanitizeFontName,
  type ContentFontFamily,
} from "./appFonts";

export const DEFAULT_CONTENT_FONT_SIZE = 16;
export const MIN_CONTENT_FONT_SIZE = 12;
export const MAX_CONTENT_FONT_SIZE = 24;

export function clampContentFontSize(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_CONTENT_FONT_SIZE;
  return Math.min(MAX_CONTENT_FONT_SIZE, Math.max(MIN_CONTENT_FONT_SIZE, Math.round(n)));
}

/** Resolves the --font-content override for a choice; null = keep the theme's. */
export function resolveFontFamilyValue(family: ContentFontFamily, customName: string): string | null {
  return resolveFontChoiceValue("content", { family, customName });
}

export function applyContentFontFamily(family: ContentFontFamily, customName: string): void {
  applyAppFont("content", { family, customName });
}
