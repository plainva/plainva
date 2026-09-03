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

      // The type says "yes" | "partial" | null, but this catalog is edited by
      // hand, and a plausible-looking "no" once slipped past every rule below:
      // it is not "yes", so it merely had to carry a reason, and it did. Only
      // the typecheck objected. A guard over this file should not need the
      // compiler to notice a state that does not exist.
      if (state !== null && state !== "yes" && state !== "partial") {
        out.push(
          `${where}: ${JSON.stringify(state)} is not a shell state - use "yes", "partial" or null`,
        );
        continue;
      }

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
 *
 * Its reach, measured on 2026-08-24 when the SAME class slipped past it twice:
 *
 *  - **A marker is only as sharp as the assertion it names.** `note-to-mail`
 *    survived as a gap because the guard pinned two of the three routes and the
 *    entry claimed the third (the attachment) was missing — which the phone had
 *    grown on 2026-08-20, in the very commit that wrote the marker. No
 *    contradiction, because the marker never spoke about that route.
 *  - **It only looks one way.** `recent-searches` was a DESKTOP gap
 *    (`desktop: null`) closed by `4ec8cd76`, and there is no `@parity-desktop`
 *    counterpart to notice. Not built here: with the catalog holding no gaps at
 *    all any more, a second mechanism would have nothing to guard.
 *
 * What actually keeps this honest is the shape of what is left: every remaining
 * entry is a `decision`, and a decision describes a platform limit — those do
 * not quietly get built. A `gap` is the entry that rots, because the work
 * happens and the line stays.
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
    id: "compare-merge",
    title: "Merging two versions line by line in the comparison view",
    area: "platform",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "Both shells compare the same two sides under the same rule (left is what " +
      "the note holds, right is the other version) and offer the same exits: take " +
      "the other version whole, keep both, discard the copy, decide later. What " +
      "the phone does not offer is the per-chunk arrow that pulls one block over " +
      "while the rest stays — that is a mouse gesture on a side-by-side editor, " +
      "and a phone shows the differences stacked, not side by side. Whoever needs " +
      "to merge does it at the desk (feedback round 2026-09-01, P2 / mockup " +
      "\"Zwei Fassungen auf 375 Pixeln\").",
    verified: "2026-09-02",
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
    id: "multi-vault",
    title: "Work in two vaults at the same time, one per window",
    area: "platform",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "Follows from multi-window: a second vault needs a second window to show it, " +
      "and the phone has none. Mobile also holds exactly ONE vault container at a " +
      "time by construction - switching stops the worker, closes the index and " +
      "boots the next one - which is the right shape for a device that shows one " +
      "screen anyway. Permanent by platform, not a backlog item.",
    verified: "2026-08-24",
  },
  {
    id: "multi-window",
    title: "Open notes, databases and views in separate OS windows, or a second full one",
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
    verified: "2026-08-23",
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
    id: "system-back",
    title: "Go back with a system gesture or button, not only through the app's own arrow",
    area: "platform",
    kind: "decision",
    desktop: null,
    desktopReason:
      "A desktop window has no navigation stack to go back in: tabs, panes and " +
      "windows are all visible at once, and the browser-style history lives inside " +
      "one tab (its own back/forward arrows). There is nothing here for a system " +
      "back to act on.",
    mobile: "partial",
    mobileReason:
      "Android has a system back trigger (gesture or button) and it pops the same " +
      "navigation stack as the app bar's arrow; iOS has none of ours — the maintainer " +
      "ruled out an own edge gesture on 2026-09-01 (the same movement with two " +
      "origins on two platforms is the kind of asymmetry nobody can explain later). " +
      "On iOS the app bar's arrow is THE way back, so it carries the full 44px " +
      "touch target. Both shells run through one pop path; only the trigger differs.",
    verified: "2026-09-03",
  },
  {
    id: "comment-anchor-create",
    title: "Attaching a comment or a suggestion to a passage",
    area: "security",
    kind: "gap",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "The phone reads every thread, replies, resolves, jumps to a passage by " +
      "tapping its quote, and accepts or declines a proposal. Since Stufe E it also " +
      "STARTS a comment on everything that is not a passage: a picture (and a " +
      "region drawn inside it with a finger), a diagram, a table cell, a database " +
      "property. None of those need selected text, which is why they could be " +
      "closed first. What is left is the passage itself: both flows begin with a " +
      "text selection, and the note opens read-first on the phone, so the selection " +
      "would have to compete with the system's own copy bubble. That is a gap, not " +
      "a platform limit — a phone can select text — and it is written up in the " +
      "collected-remainders plan (Sammelplan, C26). The read half was the urgent " +
      "one either way: on a phone you mostly answer what somebody else pointed at.",
    verified: "2026-09-02",
  },
  {
    id: "comment-notification-latency",
    title: "How soon you are told about a new remark",
    area: "security",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "Everything ELSE about remark notifications is the same on both shells " +
      "since F3: the same three levels, the same preview switch, the same " +
      "per-note silencing, the same landing on the card that was pointed at. " +
      "What differs is WHEN, and only that. Plainva has no server that could " +
      "push a notification, so a remark can only be noticed where a device looks " +
      "anyway - in a sync cycle. The desktop worker runs continuously (15 s by " +
      "default), so it tells you almost at once. A phone runs no timer in the " +
      "background, so it notices after a sideband cycle and on returning to the " +
      "foreground - the same platform limit the PIM refresh hit " +
      "(services/appLifecycle.ts). This is a decision rather than a gap because " +
      "closing it would mean a push service, and a push service means a foreign " +
      "server learning when who commented on which note - exactly what the " +
      "encryption prevents. The settings screen says so in its own words rather " +
      "than making a promise the phone cannot keep.",
    verified: "2026-09-02",
  },
  {
    id: "lift-encryption",
    title: "Turn encryption off and go back to plain files",
    area: "security",
    kind: "gap",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "Both shells can decommission a workspace — that is local, works offline and " +
      "leaves the encrypted objects in the cloud untouched. Lifting encryption is the " +
      "other half: it re-uploads every file of the vault as plaintext into the same " +
      "folder, which is the heaviest network operation this app has and the one the " +
      "phone deliberately meters (see connect-metering). It needs a surface that can " +
      "show a long, resumable whole-vault upload; until then the phone offers the " +
      "decommission it can finish rather than a start it cannot.",
    verified: "2026-08-25",
  },
  {
    id: "workspace-passphrase-change",
    title: "Change the passphrase that seals the keys on this device",
    area: "security",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "There is no passphrase on the phone to change. A workspace falls back to a " +
      "passphrase only where no system keychain answers - a headless Linux desktop - " +
      "and the Capacitor shell always has the Android/iOS keystore, so its key " +
      "storage is invariably native (mobileWorkspaceSecurity.ts persists through " +
      "secureCredentialStore and carries no fallback branch). The desktop shows the " +
      "control on the same condition: only when its own storage is the passphrase.",
    verified: "2026-08-25",
  },
  {
    id: "workspace-slice-kinds",
    title: "Which kinds of Vault Slice can be created",
    area: "security",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "Folder slices only. A selection slice needs a multi-select across every " +
      "encrypted object in the vault, and a dynamic one needs the rule builder — " +
      "both are choosing surfaces that only make sense at desktop width. A folder is " +
      "the share people actually ask for and it is expressible in one field, so the " +
      "phone offers exactly that instead of a cramped version of the other two. " +
      "Slices of any kind made elsewhere are listed, previewed and honoured here.",
    verified: "2026-08-25",
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
