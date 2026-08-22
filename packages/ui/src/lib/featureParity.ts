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
 * A `@parity-mobile <id>` marker found above an assertion in a MOBILE source
 * guard. It says: this assertion requires the named capability to exist on the
 * phone.
 */
export interface ParityGuardMarker {
  /** The catalog id the marker names. */
  id: string;
  /** Human-readable location, e.g. `mobileLint.test.ts:1074`. */
  where: string;
}

/**
 * Catches the failure that made this rule necessary.
 *
 * On 2026-08-20 the catalog said `note-to-mail` had "no path from an open note"
 * on the phone, while `mobileLint.test.ts` carried an assertion named "offers
 * the note itself as mail" that PINNED the two paths the catalog called
 * missing. Two guards in the same repo contradicted each other and the suite
 * stayed green, because neither knew about the other — the entry was simply
 * describing a state that had moved on.
 *
 * `featureParity.test.ts` cannot detect that on its own: the reason is prose.
 * So the mobile guard states which entry it speaks for, and this function holds
 * the two sides together. A marker means the capability is REQUIRED to exist on
 * the phone, so the entry may not claim the phone is without it.
 *
 * Deliberately NOT inferred from titles or file names: a fuzzy match would
 * either miss the real case or fire on unrelated ones, and a guard that cries
 * wolf gets silenced within a week.
 */
export function findGuardContradictions(
  features: readonly ParityFeatureDef[],
  markers: readonly ParityGuardMarker[],
): string[] {
  const out: string[] = [];
  const byId = new Map(features.map((f) => [f.id, f]));

  for (const m of markers) {
    const f = byId.get(m.id);
    if (!f) {
      // A marker pointing nowhere is a typo or the leftover of a deleted entry;
      // either way it silently stops guarding.
      out.push(`${m.where}: @parity-mobile "${m.id}" names no catalog entry`);
      continue;
    }
    if (f.mobile === null) {
      out.push(
        `${m.where}: a mobile guard requires "${m.id}", but the catalog says the ` +
          `phone does not have it — one of the two is out of date`,
      );
    }
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
    id: "note-to-mail",
    title: "Send the open note by mail",
    area: "editor",
    kind: "gap",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "Two of the three routes exist on both shells over the same helpers: the " +
      "mailto handoff (buildMailtoUrl) and the composer with the note as the " +
      "body. Only sending the note AS AN ATTACHMENT is desktop-only, and it is " +
      "not a menu entry away: the mobile MailDraft carries accountId, to, " +
      "subject and body and has no attachments field, so the draft type, the " +
      "compose screen and the send path all have to grow one.",
    verified: "2026-08-20",
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
    id: "multi-window",
    title: "Open notes, databases and views in separate OS windows",
    area: "platform",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "Mobile shells have no OS windows: Android and iOS present one activity or " +
      "scene at a time, so 'open this note in a second window' has no counterpart " +
      "to build. The need behind it — looking at two things at once — is answered " +
      "there by pushed screens, the context sheet and, on tablets, the adaptive " +
      "two-column layout. Permanent by platform, not a backlog item.",
    verified: "2026-08-22",
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
      "typing a long query again is no more pleasant with a keyboard. The store " +
      "now sits in the shared layer (lib/recentSearches, speaking only through " +
      "getPlatformServices().loadSettings()); the work left is the desktop " +
      "surface under the search field.",
    mobile: "yes",
    verified: "2026-08-20",
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
];
