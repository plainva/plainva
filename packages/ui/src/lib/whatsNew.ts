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
 *
 * Only the FIRST entry has texts. The `whatsNew.highlightN` keys are flat, not
 * versioned, so each release overwrites them — older entries stay as a record of
 * what shipped when, and rendering one would show the current release's words.
 */

/**
 * The glyph a highlight carries. A NAME, not a component: this file is data
 * that both shells read, and the phone draws its icons at other sizes than the
 * desktop. `whatsNewIcon()` maps a name to a lucide glyph.
 */
export type WhatsNewIconName =
  | "cloud"
  | "layout"
  | "mail"
  | "repeat"
  | "database"
  | "sync"
  | "import"
  | "lock"
  | "trash"
  | "calendar"
  | "phone"
  | "sparkles";

export interface WhatsNewHighlight {
  icon: WhatsNewIconName;
  /**
   * Draws the "Experimental" pill. It belongs in the data, not in the sentence:
   * a warning inside prose is the first thing a reader skips, and a translator
   * can drop it without anyone noticing.
   */
  experimental?: boolean;
}

export interface WhatsNewItem {
  version: string;
  releaseDate: string;
  /**
   * One entry per `whatsNew.highlightN` key, in order — the FIRST one is the
   * lead and is rendered large. Its length is what says how many keys this
   * release ships (`localeParity.test.ts` pins the pair).
   */
  highlights: WhatsNewHighlight[];
  blogUrl?: string;
}

export const WHATS_NEW_CATALOG: WhatsNewItem[] = [
  {
    version: "0.5.1",
    releaseDate: "2026-07-28",
    highlights: [
      { icon: "cloud" },
      { icon: "layout" },
      { icon: "mail" },
      { icon: "repeat" },
      { icon: "database" },
      { icon: "sync" },
    ],
    blogUrl: "https://plainva.com/blog/plainva-0-5-1",
  },
  {
    version: "0.5.0",
    releaseDate: "2026-07-25",
    highlights: [
      { icon: "import" },
      { icon: "lock", experimental: true },
      { icon: "trash" },
      { icon: "calendar" },
      { icon: "phone" },
    ],
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
