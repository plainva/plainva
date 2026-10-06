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

/**
 * Grouping for reading the catalog by subsystem. `ai` belongs to the AI
 * harness (harness plan §21a.4): sorted first, its entries sit at the top of
 * the catalog, away from the lines other sessions append to.
 */
export type ParityArea =
  | "ai"
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
 *
 * The one gap written back since (`palette-command-reach`, 2026-09-24) is held
 * from the code's side instead: MOBILE_ABSENT_COMMANDS points at it command by
 * command, and mobileCommands.test.ts wants a line deleted as soon as the phone
 * offers that command, and the entry deleted once no line points at it.
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
    id: "ai-answer-in-background",
    title: "An AI answer keeps arriving while the app is in the background",
    area: "ai",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "The answer streams into the web view, and iOS and Android suspend a " +
      "backgrounded app's web view: on the phone an answer arrives only while " +
      "Plainva is open, which the handbook says. A run that outlives the app " +
      "needs the whole loop native, the routines of plan KI-Harness P8.",
    verified: "2026-09-24",
  },
  {
    id: "ai-local-servers",
    title: "AI models on this computer (Ollama, LM Studio)",
    area: "ai",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "Ollama and LM Studio are servers that run on a computer; neither exists " +
      "for a phone, and a phone cannot reach a computer's localhost. A server " +
      "elsewhere is added as an OpenAI-compatible server over https, which " +
      "both shells offer.",
    verified: "2026-09-24",
  },
  {
    id: "ai-mcp-client-programs",
    title: "A program on this device as a server whose tools the assistant uses (MCP client, plan KI-Harness P4.5)",
    area: "ai",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "An MCP server that is a program is started by the app and spoken to over " +
      "its standard input and output. Neither iOS nor Android lets an app start " +
      "another program, and there is no place to install one. The phone uses " +
      "the servers that are services on the internet, over https, exactly as " +
      "the desktop does (AiMcpPlugin on both platforms).",
    verified: "2026-10-07",
  },
  {
    id: "ai-mcp-server",
    title: "AI apps on this computer read the vault through Plainva (MCP server)",
    area: "ai",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "The clients that speak MCP locally (Claude Code, Claude Desktop, editors) " +
      "run on computers and start Plainva's helper as a program of their own. " +
      "A phone runs no such client, and neither iOS nor Android lets one app " +
      "offer another a local pipe or socket; reaching a phone from outside would " +
      "need a server on the internet, which Plainva does not run (plan KI-Harness " +
      "§17.3, §22). The phone's own assistant reads the vault directly.",
    verified: "2026-09-29",
  },
  {
    id: "ai-platform-models",
    title: "The system's own AI model on this device (plan KI-Harness P2c)",
    area: "ai",
    kind: "decision",
    desktop: null,
    desktopReason:
      "Windows and Linux bring no model an app may call. macOS has one on " +
      "Apple-silicon Macs, but the desktop's way without a key is a model of " +
      "the user's choice on the computer itself, through Ollama or LM Studio " +
      "(ADR 0021, decision 5); a second, smaller system model would add a " +
      "native bridge for less than that path already gives.",
    mobile: "yes",
    verified: "2026-10-01",
  },
  {
    id: "ai-web-fetch-pinned-address",
    title: "A page the assistant fetches comes from exactly the address that was checked (plan KI-Harness P4)",
    area: "ai",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "Android connects to the checked addresses like the desktop. On iOS, " +
      "URLSession offers no way to name the address a request connects to, so " +
      "the check stands on both sides of the request instead: every address of " +
      "the name is found public before it starts, and the far end the system " +
      "reports afterwards is checked again; an answer from an address that is " +
      "not public is thrown away. A name server that answers twice differently " +
      "can make one GET without a body reach a private address there — never " +
      "its answer a model (AiWebFetch in AiWebPlugin.swift).",
    verified: "2026-10-06",
  },
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
    id: "theme-quick-toggle",
    title: "Switching between light and dark with one click",
    area: "appearance",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "The desktop has a toggle in the title bar and in the palette, beside the " +
      "Appearance setting. The phone keeps the choice in one place, Appearance " +
      "(System, Light, Dark): the system's own dark mode is a quick setting on both " +
      "platforms, and a second switch inside the app would drift from the one that " +
      "owns the choice. So the phone's palette has no toggle-theme.",
    verified: "2026-09-24",
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
    id: "board-card-color-entry",
    title: "Setting a note's colour from its board card",
    area: "database",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "Both shells tint a board card with the note's colour (2026-09-19). The desktop " +
      "sets it from the card's context menu. On the phone a long press on a board card " +
      "arms the drag - the only way to move a card by hand - so the card has no menu; the " +
      "colour is set in the note's own menu, one tap away, and the card shows it on return.",
    verified: "2026-09-19",
  },
  {
    id: "embedded-pinboard-new-entry",
    title: "\"New entry\" from a pinboard embedded in a note",
    area: "database",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "Both shells make a pinboard entry the same way - a title and the full editor, the same " +
      "file (plan Befunde 2026-09-24, E14/E17). An EMBEDDED board is a different surface on " +
      "each: the desktop draws the whole board inside the note, head and \"Entry\" included; " +
      "the phone draws an embedded database as a few rows that lead to the database itself, " +
      "because a masonry of cards inside a note on a 360 px screen is unreadable. So on the " +
      "phone a new entry is made one tap further, on the board's own page, with its FAB.",
    verified: "2026-09-29",
  },
  {
    id: "tag-colors-table-cell",
    title: "Coloured tags in a database table cell",
    area: "database",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "\"Colour tags\" reaches every surface that DRAWS a tag as a chip: the note, the " +
      "properties, the pinboard label and the tag list in both shells, and the desktop's " +
      "table cell (2026-09-19). The phone's table has no chips to colour: it draws every " +
      "list value as one line of text, because a row of chips per cell does not fit a " +
      "44 px row on a 360 px screen.",
    verified: "2026-09-19",
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
    id: "journal-place-stamp",
    title: "Adding your position to a journal entry",
    area: "editor",
    kind: "decision",
    desktop: "partial",
    mobile: "yes",
    desktopReason:
      "The phone asks its native receiver through @capacitor/geolocation and " +
      "always has one to ask. The desktop asks the WebView: WebView2 and " +
      "WebKitGTK answer navigator.geolocation and prompt the user, but a " +
      "system that refuses the API - a Linux build without a location " +
      "service, a machine with the permission switched off for the whole OS - " +
      "gives the WebView nothing. Where that happens the button is ABSENT " +
      "rather than present and always failing, which is the deliberate part: " +
      "a control that cannot work should not be offered. The feature is opt-in " +
      "per device and off by default on both shells, and the line it writes " +
      "is the same plain Markdown (plan Journal-Erweiterungen, E6).",
    verified: "2026-09-22",
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
    id: "read-mode-edit-verb",
    title: "Switch from reading to writing at the marked passage",
    area: "editor",
    kind: "decision",
    desktop: "partial",
    desktopReason:
      "The desktop's read mode is its own renderer without a selection bar; the " +
      "mode switch is Mod+E or the mode button, and a mouse double-click must keep " +
      "selecting the word. The phone's read mode is the editor itself, so the bar " +
      "over a selection carries Edit (Build-91 feedback, E5), Copy and Select all.",
    mobile: "yes",
    verified: "2026-09-15",
  },
  {
    id: "reader-chrome-auto-hide",
    title: "Automatically hide controls while reading",
    area: "editor",
    kind: "decision",
    desktop: "partial",
    desktopReason: "Desktop uses its explicit focus-mode command and shortcut. Touch readers hide the header and pencil on downward scrolling, with a device-local opt-out; the tablet navigation rail stays available.",
    mobile: "yes",
    verified: "2026-09-16",
  },
  {
    id: "tag-pill-open-while-editing",
    title: "Opening a tag from its pill while the note is being edited",
    area: "editor",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "A tag in a note is a pill in both shells, and opening it shows the notes that carry " +
      "it (2026-09-19). On the desktop the mouse opens it at any time, as it opens a wiki " +
      "link. On the phone a tap while EDITING places the caret - a finger has no other way " +
      "to put it inside a word - so the pill opens while the note is being read, which is " +
      "how the phone treats every link in a note.",
    verified: "2026-09-19",
  },
  {
    id: "device-pim-accounts",
    title: "The device's own calendars and reminder lists as a calendar account",
    area: "pim",
    kind: "decision",
    desktop: null,
    desktopReason:
      "EventKit exists on macOS only; Windows and Linux have no system calendar " +
      "store, and a provider that exists on one desktop platform is the kind of " +
      "asymmetry nobody can explain. The desktop reaches the same calendars " +
      "through CalDAV, Google and Graph; the device account never travels in the " +
      "settings profile (plan EventKit E3/E8, 2026-09-04).",
    mobile: "partial",
    mobileReason:
      "Calendars on both platforms (EventKit / CalendarContract). Reminder lists " +
      "only on iOS, because Android has no system task store. Conflict detection " +
      "on Android rests on a hash of the visible fields instead of a modification " +
      "date the provider does not expose - a change that leaves every visible " +
      "field alone is invisible to it. Both named on the account card.",
    verified: "2026-09-04",
  },
  {
    id: "note-copy-as-email",
    title: "Copying a note as formatted text for an email",
    area: "pim",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "The desktop puts the note on the clipboard as HTML and as plain text, to be " +
      "pasted into a mail program's window beside the note. The phone deliberately " +
      "leaves the copy out (NoteScreen.tsx): it keeps no mail window open next to " +
      "the note, so its note menu hands the note to mail directly - through mailto, " +
      "Plainva's own composer, or as an attachment. Getting a note into a mail works " +
      "on both shells; only the clipboard route is the desktop's.",
    verified: "2026-09-24",
  },
  {
    id: "task-reminder-actions",
    title: "Done and Later on a task reminder",
    area: "pim",
    kind: "decision",
    desktop: "partial",
    desktopReason:
      "The desktop backend of the notification plugin builds a notification from " +
      "title and body only and registers neither buttons nor click reports " +
      "(tauri-plugin-notification 2.3.3, src/desktop.rs - the same limit that makes " +
      "the desktop keep its own timers). The OS notification therefore cannot carry " +
      "Done or Later; the toast that accompanies it opens the task, where ticking it " +
      "off is one click. Task time, the task lead and the per-task `remind` exception " +
      "apply on both shells (plan Aufgaben-Oberflaeche B4, 2026-09-20).",
    mobile: "yes",
    verified: "2026-09-20",
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
        "Both shells identify the current file and conflict copy with full paths, " +
        "check both displayed contents before resolving, and offer the same exits: " +
        "replace the current file with the copy, keep both, delete the copy, or " +
        "decide later. Proven different tasks can only be kept separately. What " +
      "the phone does not offer is the per-chunk arrow that pulls one block over " +
      "while the rest stays — that is a mouse gesture on a side-by-side editor, " +
      "and a phone shows the differences stacked, not side by side. Whoever needs " +
      "to merge does it at the desk (feedback round 2026-09-01, P2 / mockup " +
      "\"Zwei Fassungen auf 375 Pixeln\").",
      verified: "2026-09-11",
  },
  {
    id: "editor-tabs",
    title: "Tabs: closing one, reopening the last one closed",
    area: "platform",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "The phone has no tab strip. It shows one screen at a time and moves between " +
      "them on a navigation stack: going back pops it (see system-back), and the " +
      "bottom bar switches between the main screens rather than between open notes. " +
      "With no strip there is no tab to close and no closed tab to bring back, so " +
      "the phone's palette has no close-tab and no reopen-tab.",
    verified: "2026-09-24",
  },
  {
    id: "external-change-watcher",
    title: "Notice files changed or moved outside Plainva while the app is open",
    area: "platform",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "No file watcher on the phone: neither Android nor iOS gives an app a " +
      "reliable one for its own container or a picked folder, and a backgrounded " +
      "app runs no code to receive events anyway. The phone re-reads the vault " +
      "instead - every vault, on every return to the app (at most once a minute) " +
      "and on every pull-to-refresh, both through the core's reconcile that also " +
      "removes what vanished (issue 110, E9). A note, a database or an image " +
      "that went missing follows its file the same way on both shells. What " +
      "differs is only the moment: the desktop within a second, the phone when " +
      "it comes back to the front.",
    verified: "2026-09-24",
  },
  {
    id: "global-quick-capture",
    title: "Global quick capture: a system-wide shortcut opens a small capture window",
    area: "platform",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "A phone gives an app no system-wide key. What the shortcut is for — an entry " +
      "without opening the app first — the phone reaches its own way: the launcher " +
      "shortcut and quick action \"Journal entry\" and the share target \"Into the journal\". " +
      "On the desktop it is opt-in and off by default; under a Wayland session the " +
      "platform gives applications no global shortcut either, and the setting says " +
      "so instead of registering one that never fires.",
    verified: "2026-09-20",
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
    id: "home-screen-widgets",
    title: "Home-screen widgets for today's list and quick capture",
    area: "platform",
    kind: "decision",
    desktop: null,
    desktopReason:
      "A Windows widget needs the app shipped as an MSIX package with its own " +
      "widget provider service, a macOS widget a native app extension signed " +
      "beside the app — neither is something the Tauri shell carries, and either " +
      "would change how Plainva is packaged on that platform for one surface. " +
      "The desktop answers the same need from the tray (next appointment, new " +
      "task, journal entry), which is there whenever the window is not.",
    mobile: "yes",
    verified: "2026-09-23",
  },
  {
    id: "keyboard-shortcuts",
    title: "Keyboard shortcuts and the overview that lists them",
    area: "platform",
    kind: "decision",
    desktop: "yes",
    mobile: null,
    mobileReason:
      "The phone is operated by touch and has no app-level shortcut layer: no Mod+N, " +
      "no F1, only the arrow keys a focused list answers to. An overview would have " +
      "nothing to list, so the phone's palette has no show-shortcuts. A keyboard " +
      "attached to a tablet types and edits text through the system; the actions " +
      "themselves sit on the FAB, the bottom bar and the palette.",
    verified: "2026-09-24",
  },
  {
    id: "launcher-shortcuts",
    title: "Long-press launcher shortcuts (new note, new task, today, journal)",
    area: "platform",
    kind: "decision",
    desktop: null,
    desktopReason:
      "A launcher affordance of the phone (Android app shortcuts, iOS quick " +
      "actions — one table, guarded by launcherShortcuts.test.ts) with no desktop " +
      "counterpart; the same actions are one keystroke away there (Mod+N, " +
      "Mod+Shift+D, Mod+Shift+J) and sit in the ribbon, and the tray menu carries " +
      "\"New task\" and \"Journal entry\" for a window that is hidden.",
    mobile: "yes",
    verified: "2026-09-20",
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
      "two-column layout. Desktop tabs can return to the main window with a " +
      "confirmed draft transfer; a version comparison can retain its selected " +
      "snapshot in a separate window. Mobile uses its full comparison screen " +
      "with the same line-change counts. Permanent by platform, not a backlog item.",
    verified: "2026-09-14",
  },
  {
    id: "palette-command-reach",
    title: "Reaching screen actions through the command palette",
    area: "platform",
    kind: "gap",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "Each of these works on the phone, on a screen of its own, but the phone's " +
      "palette does not list them yet: the comment overview (Comments), import, the " +
      "index rebuild and the index.md overviews (Maintenance), backup now (the " +
      "vault's detail screen), a new template (New from template), version history " +
      "(the note's context), and from the note menu Markdown source, insert " +
      "template, save as template, mailto and compose. Closing it takes a handler " +
      "per command in mobileCommands.ts - for the note ones an event the note " +
      "screen listens for, as rename does. MOBILE_ABSENT_COMMANDS names them one by " +
      "one; in the maintainer's open-items plan since 2026-09-24.",
    verified: "2026-09-24",
  },
  {
    id: "process-exit-diagnostics",
    title: "Why the system ended the app, in the sync diagnostics",
    area: "platform",
    kind: "decision",
    desktop: null,
    desktopReason:
      "A desktop OS has no per-app memory limiter and keeps no per-package exit " +
      "record the app could read; the entry exists for Android 17's limiter, " +
      "which kills without a trace the user could see (plan 2026-09-04, P1). " +
      "iOS is covered by the same mobile screen showing nothing: it has no " +
      "comparable list either.",
    mobile: "yes",
    verified: "2026-09-04",
  },
  {
    id: "share-target",
    title: "Receive text, links and files with durable staging and destination review",
    area: "platform",
    kind: "decision",
    desktop: null,
    desktopReason:
      "Desktop operating systems have no comparable inbound share bus; the desktop " +
      "equivalent is drag & drop, paste and file import. The mobile inbox keeps " +
      "waiting transfers until the user confirms a vault destination. Worth " +
      "revisiting only if a platform grows a real share target.",
    mobile: "yes",
    verified: "2026-09-14",
  },
  {
    id: "side-panels",
    title: "Side panels beside the editor, shown and hidden at will",
    area: "platform",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "A phone screen has no room beside the note: the file tree is the Notes " +
      "screen and the note's context opens as a sheet. From 1024 px (a tablet) the " +
      "context docks beside the note, and the context button in the note's bar " +
      "docks and undocks it - the right sidebar's counterpart, kept on the note it " +
      "belongs to. The file tree stays a screen of its own there too, because the " +
      "tablet's two columns are navigator and work surface. So the desktop's two " +
      "sidebar toggles have no entry in the phone's palette.",
    verified: "2026-09-24",
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
    id: "comment-card-actions-hover",
    title: "When a comment card shows its actions",
    area: "security",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "On the desktop the reply/resolve/task row stays quiet until the card is " +
      "hovered, selected or focused (K3, decision E3): four buttons on every " +
      "card were the noise. A touch screen has no hover, so the phone's cards " +
      "keep the row visible - the shared stylesheet does the same for any " +
      "pointer that cannot hover.",
    verified: "2026-09-03",
  },
  {
    id: "comment-column-toggle",
    title: "Showing and hiding the comments beside a note",
    area: "security",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "The desktop has a toolbar button with the open-thread count that shows " +
      "or hides the column, remembered per vault (K3, finding 2026-09-03). The " +
      "phone shows the same records in a sheet, and a sheet IS the toggle: it " +
      "opens from the note's menu and closes with a swipe. A second switch for " +
      "a surface that is never permanently on screen would be a control without " +
      "a state to show.",
    verified: "2026-09-03",
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
    id: "suggest-mode-entry",
    title: "Where the suggestion mode is switched on",
    area: "security",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "The desktop carries the mode as a fourth pill beside Read, Live and " +
      "Source (Vorschlagsmodus, V2): it IS a way of looking at the note, and " +
      "that row is where the ways of looking live. The phone keeps its view " +
      "switch in the note's menu, so the mode sits there too, as the entry " +
      "\"Suggest\" (V5). Band, counter, sentence, Discard and Send are the same; " +
      "only the switch is where each shell keeps its switches.",
    verified: "2026-09-03",
  },
  {
    id: "suggestion-inline-pill",
    title: "Accepting or declining a suggestion from its inline rendering",
    area: "security",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "Both shells draw an open suggestion in the text (K5): the passage " +
      "struck, the proposal behind it. The desktop adds a hover pill with " +
      "accept and decline on the proposal itself. A touch screen has no hover, " +
      "and a permanently visible pair of buttons inside running text is a " +
      "tap target nobody asked for - the phone keeps accept and decline in the " +
      "comments sheet, where the same record already carries them.",
    verified: "2026-09-03",
  },
  {
    id: "table-cell-comment-affordance",
    title: "Finding the way to comment on a table cell",
    area: "security",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "The desktop shows a speech bubble on the hovered cell (K2, finding " +
      "2026-09-03: the cell menu alone was not found). A touch screen has no " +
      "hover, and a bubble that appeared after a tap would stick to the last " +
      "tapped cell, so the phone keeps the long-press sheet with the same " +
      "entry - one gesture, not a hidden one. Both reach the same request.",
    verified: "2026-09-03",
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
    id: "workspace-quarantine-export",
    title: "Exporting the diagnosis of quarantined artifacts",
    area: "security",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "The desktop writes the JSON diagnosis to a file through a save dialog; the " +
      "phone copies the same JSON to the clipboard. There is no save-as on the " +
      "phone, and a share sheet for a JSON nobody opens on a phone would only move " +
      "the copy step somewhere else - the reader of a diagnosis is a person at a " +
      "desktop, and the clipboard is the shortest way there. Grouping, the " +
      "explanations, check again, ignore and mark-as-fixed are the same on both " +
      "(finding 2026-09-03). The per-entry ciphertext export stays desktop-only for " +
      "the same reason.",
    verified: "2026-09-03",
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
  {
    id: "external-folder-sync",
    title: "Cloud sync for a vault that lives in a folder another program keeps",
    area: "sync",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason:
      "The phone can open a folder the user picked outside the app container " +
      "(external vault folder plan, P4), but cloud sync is deliberately off for " +
      "such a vault (E4): that folder exists because another program — Syncthing, " +
      "the Files app, a second sync client — already keeps it, and two syncs on " +
      "one store overwrite each other. The desktop runs the same risk and leaves " +
      "it to the user; the phone names the reason on the vault card instead of " +
      "offering the switch. Editing, indexing, backups and conflict copies work " +
      "the same on both.",
    verified: "2026-09-03",
  },
  {
    id: "http-platform-trust",
    title: "Secure self-hosted connections and actionable TLS diagnostics",
    area: "sync",
    kind: "decision",
    desktop: "yes",
    mobile: "partial",
    mobileReason: "Android explicitly includes user-installed CAs in the platform network security configuration. iOS uses URLSession platform trust and may report an indeterminate trust failure without distinguishing a hostname failure. Both retain TLS and hostname validation; no per-host trust bypass is offered.",
    verified: "2026-09-14",
  },
];
