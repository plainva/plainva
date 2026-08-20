/**
 * The catalog of KNOWN desktop/mobile asymmetries.
 *
 * Plainva is one product with two shells, and the working rule is that a
 * feature or a fix reaches both. The rule needed a place where breaking it is
 * a written fact instead of an omission nobody sees: the same failure kept
 * surfacing and the maintainer kept finding it on the device. The account
 * import existed on the desktop and simply did not exist on the phone; the
 * "sign in on this device" surface existed only on the phone while the desktop
 * could not even render the state; a comment on the mobile calendar card
 * promised since P7 that the mail client would render "the same two" and that
 * promise went unredeemed for months. A promise in a comment is not a guard.
 *
 * WHAT THIS FILE IS: the list of places where the two shells differ, each with
 * a reason. An entry is either a `gap` (should be closed; belongs in the
 * maintainer's open-items plan) or a `decision` (stays asymmetric because the
 * platform demands it). Both are legitimate. The third state — a difference
 * nobody wrote down — is the one this file exists to make impossible.
 *
 * WHAT THIS FILE IS NOT: a feature inventory. An entry whose two sides are both
 * `"yes"` is noise, and the guard rejects it — when a gap is closed, the entry
 * is DELETED. The catalog stays short on purpose, so that reading it end to end
 * remains the honest answer to "what does the phone still not do".
 *
 * HONEST LIMIT: `featureParity.test.ts` enforces that every entry IN here is
 * complete, dated and justified. It cannot know about a feature someone built
 * for one shell and never entered — no test can. That part is carried by the
 * working rule in the AI entry files and by review. Do not let this file's
 * existence read as a guarantee it cannot give.
 *
 * The shape follows `profileFields.ts`, where the same "a null REQUIRES a
 * documented reason" pattern already earns its keep.
 */

/**
 * How well a shell serves a feature. `"partial"` means reachable but reduced —
 * it REQUIRES a reason just like `null` does, because "it kind of works there"
 * is exactly the state that silently drifts into "it does not".
 */
export type ParityShellState = "yes" | "partial" | null;

/**
 * Why the difference exists. `gap` is a debt with an intended end; `decision`
 * is permanent. Keeping them apart matters: "not yet" and "not ever" call for
 * different follow-ups, and collapsing them turns the catalog into a list of
 * excuses.
 */
export type ParityKind = "gap" | "decision";

/** Grouping for reading the catalog by subsystem. */
export type ParityArea =
  | "editor"
  | "database"
  | "graph"
  | "search"
  | "sync"
  | "security"
  | "pim"
  | "vault"
  | "appearance"
  | "platform";

export interface ParityFeatureDef {
  /** Stable kebab-case identifier. Never reused for a different feature. */
  id: string;
  /** Short English label — what a user would call it. */
  title: string;
  area: ParityArea;
  kind: ParityKind;
  /** Desktop coverage; `"partial"` or `null` REQUIRES `desktopReason`. */
  desktop: ParityShellState;
  /** Why the desktop side is reduced or absent. */
  desktopReason?: string;
  /** Mobile coverage; `"partial"` or `null` REQUIRES `mobileReason`. */
  mobile: ParityShellState;
  /** Why the mobile side is reduced or absent. */
  mobileReason?: string;
  /**
   * When this entry was last checked AGAINST THE CODE (YYYY-MM-DD).
   *
   * Required, because a "verified" without a date next to it is a claim with an
   * expiry: on 2026-08-18 the open-items plan still listed Windows code signing
   * as unwired, carrying a "verified" from three weeks before the signing
   * actually shipped. Re-check the date when you touch the area.
   */
  verified: string;
}

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PLACEHOLDER = /\b(tbd|todo|tbc|fixme|xxx|\?\?\?)\b/i;
const MIN_REASON = 20;

/**
 * Every rule the catalog must satisfy, as a pure function so the guard can run
 * it against the real catalog AND against deliberately broken fixtures. A test
 * that only ever sees valid input proves nothing about what it would catch.
 *
 * Returns one human-readable line per violation; empty means clean.
 */
export function findParityViolations(features: readonly ParityFeatureDef[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const f of features) {
    const at = `${f.area}/${f.id}`;

    if (!ID_PATTERN.test(f.id)) out.push(`${at}: id must be kebab-case`);
    if (seen.has(f.id)) out.push(`${at}: duplicate id`);
    seen.add(f.id);
    if (!f.title.trim()) out.push(`${at}: needs a title`);
    if (!DATE_PATTERN.test(f.verified)) out.push(`${at}: verified must be YYYY-MM-DD`);

    // Both sides served: the entry is noise. Closing a gap means DELETING it,
    // otherwise the catalog stops reading as "what still differs".
    if (f.desktop === "yes" && f.mobile === "yes") {
      out.push(`${at}: both shells are "yes" — delete the entry instead of keeping it`);
    }
    // Nothing anywhere is not an asymmetry, it is an unbuilt feature.
    if (f.desktop === null && f.mobile === null) {
      out.push(`${at}: neither shell has it — this belongs in planning, not here`);
    }

    for (const shell of ["desktop", "mobile"] as const) {
      const state = f[shell];
      const reason = shell === "desktop" ? f.desktopReason : f.mobileReason;
      const where = `${at}.${shell}`;

      if (state === "yes") {
        // A leftover reason next to a served shell goes stale unnoticed and
        // then reads as fact.
        if (reason !== undefined) out.push(`${where}: is "yes" — drop the stale reason`);
        continue;
      }
      if ((reason?.trim().length ?? 0) < MIN_REASON) {
        out.push(`${where}: ${state === null ? "absent" : "partial"} needs a reason`);
      } else if (PLACEHOLDER.test(reason ?? "")) {
        out.push(`${where}: placeholder is not a reason`);
      }
    }
  }

  const keys = features.map((f) => `${f.area}/${f.id}`);
  const sorted = [...keys].sort();
  if (keys.some((k, i) => k !== sorted[i])) {
    out.push("PARITY_FEATURES must stay sorted by (area, id)");
  }

  return out;
}

/**
 * Kept sorted by (area, id) — the guard enforces it. A deterministic order
 * keeps diffs readable and stops two sessions from appending to the same line.
 */
export const PARITY_FEATURES: ParityFeatureDef[] = [
  {
    id: "density-mode",
    title: "Comfortable/compact density choice",
    area: "appearance",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "The phone is pinned to a single touch density (mobileSettings.ts sets " +
      "data-density=\"touch\"). Offering the desktop's compact mode would put " +
      "targets below the 44px floor the touch guard enforces, so this is a fixed " +
      "value rather than a missing setting.",
    verified: "2026-08-19",
  },
  {
    id: "ui-zoom",
    title: "Zoom the whole interface (80-150%)",
    area: "appearance",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "Rests on the webview's setZoom, which the Capacitor shell does not expose. " +
      "The phone covers the underlying need through the content font size scale " +
      "and the OS-level display size, both of which reach the same reader.",
    verified: "2026-08-19",
  },
  {
    id: "base-bulk-range-select",
    title: "Selecting a RANGE of database rows in one gesture",
    area: "database",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "Both shells select several rows; the range shortcut is the difference. " +
      "The desktop extends from the anchor with Shift+click. A phone has no " +
      "Shift, and inventing a drag-across-rows gesture would collide with the " +
      "scroll it shares the surface with — so the phone selects one row per tap " +
      "after a hold opens the sheet. Everything the selection then does (delete, " +
      "set a value) is identical on both.",
    verified: "2026-08-20",
  },
  {
    id: "base-peek-depth",
    title: "Peek preview of a database entry",
    area: "database",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "Both shells peek, in the modality that fits: the desktop opens a floating " +
      "window carrying the full editor, a .base or the image viewer; the phone " +
      "opens a bottom sheet with the row's fields and prev/next. Rendering a full " +
      "editor inside a sheet would nest two scroll surfaces on a small screen.",
    verified: "2026-08-19",
  },
  {
    id: "image-editor",
    title: "Crop, rotate and draw on an attached image",
    area: "editor",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "Deliberately not rebuilt for touch (stated in ImageViewerScreen.tsx). Every " +
      "phone ships a capable image editor, and the share sheet hands the file to " +
      "it; a finger-sized reimplementation of crop handles would be worse than the " +
      "one the platform already has.",
    verified: "2026-08-19",
  },
  {
    id: "markdown-export-file",
    title: "Export a note as a Markdown file",
    area: "editor",
    kind: "gap",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "The phone routes the export through the OS share sheet, so the file leaves " +
      "the app but the user cannot pick a destination the way the desktop's save " +
      "dialog allows, and the desktop's warning about relative attachment links is " +
      "missing. Closing this needs a mobile save-to-Files path plus that warning.",
    verified: "2026-08-19",
  },
  {
    id: "note-to-mail",
    title: "Send the open note by mail",
    area: "editor",
    kind: "gap",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "The desktop offers three routes from a note into mail (copy as mail, " +
      "mailto, save as draft). Mobile mail can compose and draft on its own but " +
      "has no path from an open note, even though the shared composeMarkdown and " +
      "mail-out helpers are already in the bundle. This is wiring, not a rebuild.",
    verified: "2026-08-19",
  },
  {
    id: "print-note",
    title: "Print a note or save it as PDF",
    area: "editor",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "There is no print dialog on the phone; the share sheet carries the system's " +
      "own Print and Save-to-Files entries, which is how printing works on iOS and " +
      "Android. The capability is reachable, the affordance is the platform's " +
      "rather than ours.",
    verified: "2026-08-20",
  },
  {
    id: "template-authoring",
    title: "Create a template or save a note as one",
    area: "editor",
    kind: "gap",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "The phone can USE templates (picker sheet, folder rules) but cannot create " +
      "one or promote the open note into one. Both desktop actions are thin " +
      "wrappers over shared helpers, so the gap is a missing menu entry rather " +
      "than missing logic.",
    verified: "2026-08-19",
  },
  {
    id: "camera-capture",
    title: "Insert a photo from camera or gallery",
    area: "platform",
    kind: "decision",
    desktop: null,
    desktopReason:
      "No camera path on the desktop; the equivalent there is dragging a file in " +
      "from the file manager or pasting it. Both shells can therefore get an image " +
      "into a note — through the input each device actually has.",
    mobile: "yes",
    verified: "2026-08-19",
  },
  {
    id: "haptics",
    title: "Haptic feedback at gesture thresholds",
    area: "platform",
    kind: "decision",
    desktop: null,
    desktopReason:
      "Desktop hardware has no haptic actuator to speak of. The feedback the phone " +
      "gives by vibrating is carried on the desktop by hover and cursor states, " +
      "which touch in turn does not have.",
    mobile: "yes",
    verified: "2026-08-19",
  },
  {
    id: "launcher-shortcuts",
    title: "Long-press launcher shortcuts (new note, today)",
    area: "platform",
    kind: "decision",
    desktop: null,
    desktopReason:
      "An Android launcher affordance with no desktop counterpart; the same two " +
      "actions are one keystroke away there (Mod+N, Mod+Shift+D) and sit in the " +
      "ribbon. Note this is Android-only even within mobile — iOS carries no " +
      "equivalent shortcut items today.",
    mobile: "yes",
    verified: "2026-08-19",
  },
  {
    id: "share-target",
    title: "Receive text or images shared from other apps",
    area: "platform",
    kind: "decision",
    desktop: null,
    desktopReason:
      "Desktop operating systems have no comparable inbound share bus; the desktop " +
      "equivalent is drag & drop and paste, which the phone in turn lacks. Worth " +
      "revisiting only if a platform grows a real share target.",
    mobile: "yes",
    verified: "2026-08-19",
  },
  {
    id: "split-editor",
    title: "Two editor panes side by side",
    area: "platform",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "A phone screen cannot carry two editing surfaces at a usable width. Tablets " +
      "do get a two-column layout (navigator plus one work surface), which is the " +
      "adaptive answer to the same need rather than a smaller version of the " +
      "desktop's split.",
    verified: "2026-08-19",
  },
  {
    id: "recent-searches",
    title: "Recently used search terms",
    area: "search",
    kind: "gap",
    desktop: null,
    desktopReason:
      "The phone remembers recent search terms; the desktop does not, although " +
      "typing a long query again is no more pleasant with a keyboard. The store is " +
      "a small mobile-only service that could move into the shared layer.",
    mobile: "yes",
    verified: "2026-08-19",
  },
  {
    id: "vault-find-replace",
    title: "Vault-wide search and replace",
    area: "search",
    kind: "gap",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "The phone searches the vault and can find within a note, but cannot replace " +
      "anything beyond the open note. The core helpers (findReplace, renameTag) are " +
      "platform-neutral already; what is missing is the preview-and-deselect " +
      "surface, which needs a touch design rather than a port of the modal.",
    verified: "2026-08-19",
  },
  {
    id: "qr-pairing-scan",
    title: "Scan a pairing QR code with the camera",
    area: "security",
    kind: "gap",
    desktop: null,
    desktopReason:
      "The desktop can only paste the token or type the manual code. Joining a " +
      "workspace from a desktop next to a phone that shows the code therefore means " +
      "retyping it. A webcam scan would use the same shared decoder the phone " +
      "already runs.",
    mobile: "yes",
    verified: "2026-08-19",
  },
  {
    id: "connect-metering",
    title: "Consent and queue for metered network work",
    area: "sync",
    kind: "decision",
    desktop: null,
    desktopReason:
      "A model built for phones: ask before spending mobile data, run only in the " +
      "foreground, queue the rest. A desktop on mains power and fixed-line network " +
      "has no equivalent cost to meter, so the desktop syncs on its interval.",
    mobile: "yes",
    verified: "2026-08-19",
  },
  {
    id: "import-source-coverage",
    title: "Import: all sources and destinations",
    area: "vault",
    kind: "gap",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "The wizard exists on both shells over the same registry, but the phone " +
      "filters to file-based sources: the Notion API importer (inputKind 'api') " +
      "and the Obsidian folder-picker entry are absent, and mobile can only import " +
      "into a subfolder, never into a new vault.",
    verified: "2026-08-20",
  },
  {
    id: "index-md-management",
    title: "Generate and refresh index.md overviews",
    area: "vault",
    kind: "gap",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "The phone scaffolds index.md when creating a vault from a template but has " +
      "no surface to generate, adopt or refresh them afterwards, and no auto-update " +
      "runner. A vault edited on the phone therefore drifts out of date until a " +
      "desktop opens it.",
    verified: "2026-08-19",
  },
  {
    id: "okf-conversion",
    title: "Scan a vault for OKF conformance and convert it",
    area: "vault",
    kind: "gap",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "Mobile shows the explainer but offers neither the scan nor the conversion " +
      "run. The conversion writes to every note in the vault, so the missing part " +
      "is not only the screen: it needs the dry-run preview and the progress and " +
      "cancel path before it can be trusted on a device that gets backgrounded.",
    verified: "2026-08-19",
  },
];
