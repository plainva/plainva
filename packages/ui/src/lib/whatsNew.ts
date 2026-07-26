/**
 * Release highlights shown after an update — shared by both shells (H5).
 *
 * The highlight TEXTS live in i18n (`whatsNew.highlightN`) so they exist in all
 * ten languages; this catalog only says which version they belong to and how
 * many there are. Both are updated together at release time, and the release
 * definition of done says so.
 *
 * It sits here rather than in the desktop because the mobile bundle already
 * carried those hundred translated keys per language while having no way to
 * show them: a phone updated, and its owner never learned what changed.
 */

export interface WhatsNewItem {
  version: string;
  releaseDate: string;
  /** Number of `whatsNew.highlightN` keys this release ships. */
  highlightCount: number;
  blogUrl?: string;
}

export const WHATS_NEW_CATALOG: WhatsNewItem[] = [
  {
    version: "0.5.0",
    releaseDate: "2026-07-25",
    highlightCount: 5,
    blogUrl: "https://plainva.com/blog/plainva-0-5-0",
  },
];

export function getLatestWhatsNew(): WhatsNewItem {
  return WHATS_NEW_CATALOG[0];
}

/**
 * True when this build's highlights have not been acknowledged yet.
 *
 * A missing marker means the dialog has never been seen. Whether that makes
 * someone a NEW user (first run) or one upgrading from before the marker
 * existed is decided by the caller, which knows whether a vault was ever
 * opened.
 */
export function shouldShowWhatsNew(seenVersion: string | null | undefined, currentVersion: string): boolean {
  if (!seenVersion) return true;
  return seenVersion !== currentVersion;
}
