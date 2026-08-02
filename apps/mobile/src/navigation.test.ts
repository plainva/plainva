import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  activeFolderPath,
  backStep,
  DEFAULT_BAR_TAB_COUNT,
  ensureVisibleTab,
  MAX_BAR_TABS,
  MIN_BAR_TABS,
  sanitizeBarTabCount,
  barTabs,
  DEFAULT_TAB_ORDER,
  initialNavState,
  moveTabId,
  navTop,
  popTop,
  pushCapturedNote,
  pushEntry,
  sanitizeTabSlots,
  showsCaptureFab,
  TAB_POOL,
  tapTab,
  hidesTabBar,
} from "./navigation";

describe("sanitizeTabSlots (full-order model, redesign P3)", () => {
  it("falls back to the pool order for missing/invalid input", () => {
    expect(sanitizeTabSlots(undefined)).toEqual(DEFAULT_TAB_ORDER);
    expect(sanitizeTabSlots("notes")).toEqual(DEFAULT_TAB_ORDER);
    expect(sanitizeTabSlots([])).toEqual(DEFAULT_TAB_ORDER);
    expect(sanitizeTabSlots(["nope", 42])).toEqual(DEFAULT_TAB_ORDER);
  });

  it("drops unknown ids and duplicates, keeps order, appends the missing pool ids", () => {
    const out = sanitizeTabSlots(["calendar", "notes", "calendar", "bogus", "tasks"]);
    expect(out.slice(0, 3)).toEqual(["calendar", "notes", "tasks"]);
    expect([...out].sort()).toEqual([...TAB_POOL.map((t) => t.id)].sort());
  });

  it("migrates a bar that still names the navigator areas (S9, silently)", () => {
    // Tags, bookmarks and databases left the pool for the navigator. A phone
    // that has them in its stored order must not end up with dead slots — and
    // must not be told about it either (E3: there are no users but the
    // maintainer). Dropping unknown ids is what makes that migration free.
    const out = sanitizeTabSlots(["tags", "notes", "bookmarks", "today", "databases"]);
    expect(out.slice(0, 2)).toEqual(["notes", "today"]);
    expect(out).not.toContain("tags");
    expect(out).toHaveLength(TAB_POOL.length);
    expect(barTabs(out)).toHaveLength(DEFAULT_BAR_TAB_COUNT);
  });

  it("keeps a legacy 4-slot value readable: its entries lead, the bar shows three", () => {
    const out = sanitizeTabSlots(["notes", "today", "tasks", "calendar"]);
    expect(out.slice(0, 4)).toEqual(["notes", "today", "tasks", "calendar"]);
    expect(out).toHaveLength(TAB_POOL.length);
    expect(barTabs(out)).toEqual(["notes", "today", "tasks"]);
    expect(barTabs(out)).toHaveLength(DEFAULT_BAR_TAB_COUNT);
  });

  it("returns a fresh array (callers mutate for reordering)", () => {
    const a = sanitizeTabSlots(undefined);
    const b = sanitizeTabSlots(undefined);
    expect(a).not.toBe(b);
    expect(a).not.toBe(DEFAULT_TAB_ORDER);
  });
});

describe("moveTabId (drag-handle reorder)", () => {
  it("moves an id to the target index; membership follows from position", () => {
    const order = sanitizeTabSlots(undefined);
    // Drag "calendar" (index 4) to the top -> it enters the bar.
    const up = moveTabId(order, "calendar", 0);
    expect(up[0]).toBe("calendar");
    expect(barTabs(up)).toContain("calendar");
    // Drag "notes" below the bar -> it leaves the bar.
    const down = moveTabId(order, "notes", 5);
    expect(barTabs(down)).not.toContain("notes");
    expect(down).toHaveLength(order.length);
  });

  it("clamps the target and ignores unknown ids", () => {
    const order = sanitizeTabSlots(undefined);
    const clamped = moveTabId(order, "notes", 99);
    expect(clamped[clamped.length - 1]).toBe("notes");
    expect(moveTabId(order, "nope" as never, 0)).toEqual(order);
  });
});

describe("nav state (overlay + tab stacks)", () => {
  it("pushes content into the active tab's stack and pops it again", () => {
    let s = initialNavState("notes");
    s = pushEntry(s, { kind: "folder", path: "Projects" });
    s = pushEntry(s, { kind: "note", path: "Projects/A.md" });
    expect(navTop(s)).toEqual({ kind: "note", path: "Projects/A.md" });
    s = popTop(s);
    expect(navTop(s)).toEqual({ kind: "folder", path: "Projects" });
  });

  it("routes global kinds to the overlay above every tab", () => {
    let s = initialNavState("notes");
    s = pushEntry(s, { kind: "folder", path: "Projects" });
    s = pushEntry(s, { kind: "settings", path: "" });
    expect(s.overlay).toHaveLength(1);
    expect(s.stacks.notes).toHaveLength(1);
    expect(navTop(s)?.kind).toBe("settings");
  });

  it("routes the cloud-accounts screen to the overlay (settings area)", () => {
    let s = initialNavState("notes");
    s = pushEntry(s, { kind: "cloudaccounts", path: "" });
    expect(s.overlay).toHaveLength(1);
    expect(s.stacks.notes).toHaveLength(0);
    expect(navTop(s)?.kind).toBe("cloudaccounts");
  });

  it("keeps content opened from an overlay inside the overlay (back returns there)", () => {
    let s = initialNavState("notes");
    s = pushEntry(s, { kind: "search", path: "" });
    s = pushEntry(s, { kind: "note", path: "Hit.md" });
    expect(s.overlay.map((e) => e.kind)).toEqual(["search", "note"]);
    expect(s.stacks.notes).toHaveLength(0);
    s = popTop(s);
    expect(navTop(s)?.kind).toBe("search");
  });

  it("dismisses the overlay on any tab tap (settings -> tab bar works)", () => {
    let s = initialNavState("notes");
    s = pushEntry(s, { kind: "more", path: "" });
    s = pushEntry(s, { kind: "settings", path: "" });
    s = tapTab(s, "today");
    expect(s.overlay).toHaveLength(0);
    expect(s.activeTab).toBe("today");
    expect(navTop(s)).toBeUndefined();
  });

  it("pops the active tab to its root on a same-tab tap, keeps other stacks", () => {
    let s = initialNavState("notes");
    s = pushEntry(s, { kind: "folder", path: "Projects" });
    s = tapTab(s, "today");
    expect(s.stacks.notes).toHaveLength(1); // switching keeps the stack
    s = tapTab(s, "notes");
    expect(s.activeTab).toBe("notes");
    expect(navTop(s)).toEqual({ kind: "folder", path: "Projects" });
    s = tapTab(s, "notes"); // tapping the active tab resets to the root
    expect(s.stacks.notes).toHaveLength(0);
    expect(navTop(s)).toBeUndefined();
  });

  it("back pops overlay before tab stack and only minimizes from a tab root", () => {
    let s = initialNavState("notes");
    s = pushEntry(s, { kind: "folder", path: "Projects" });
    s = pushEntry(s, { kind: "settings", path: "" });
    let r = backStep(s);
    expect(r.minimize).toBe(false);
    expect(navTop(r.next)).toEqual({ kind: "folder", path: "Projects" });
    r = backStep(r.next);
    expect(r.minimize).toBe(false);
    expect(navTop(r.next)).toBeUndefined();
    r = backStep(r.next);
    expect(r.minimize).toBe(true);
    expect(r.next).toEqual(initialNavState("notes"));
  });

  it("captures into the notes tab when the bar has one, else the active tab", () => {
    let s = tapTab(initialNavState("notes"), "today");
    s = pushCapturedNote(s, ["notes", "today"], "Inbox/Note.md");
    expect(s.activeTab).toBe("notes");
    expect(navTop(s)).toEqual({ kind: "note", path: "Inbox/Note.md" });

    let noNotes = initialNavState("today");
    noNotes = pushCapturedNote(noNotes, ["today", "tasks"], "Inbox/Note.md");
    expect(noNotes.activeTab).toBe("today");
    expect(noNotes.stacks.today).toHaveLength(1);
  });

  it("captures on top of an open overlay so back returns there", () => {
    let s = initialNavState("notes");
    s = pushEntry(s, { kind: "settings", path: "" });
    s = pushCapturedNote(s, ["notes"], "Inbox/Note.md");
    expect(s.overlay.map((e) => e.kind)).toEqual(["settings", "note"]);
    expect(popTop(s).overlay.map((e) => e.kind)).toEqual(["settings"]);
  });

  it("stacks PIM calendar settings in the active tab and in the More overlay", () => {
    // The calendar tab itself renders the provider calendar directly. Its
    // settings screen remains normal tab content so Back returns to calendar.
    let s = tapTab(initialNavState("notes"), "calendar");
    expect(navTop(s)).toBeUndefined();
    s = pushEntry(s, { kind: "pimaccounts", path: "" });
    expect(s.overlay).toHaveLength(0);
    expect(navTop(s)).toEqual({ kind: "pimaccounts", path: "" });
    expect(popTop(s).stacks.calendar).toHaveLength(0);
    // From an open overlay (More → Calendar) both stay in the overlay.
    let o = pushEntry(initialNavState("notes"), { kind: "more", path: "" });
    o = pushEntry(o, { kind: "pimcalendar", path: "" });
    expect(o.overlay.map((e) => e.kind)).toEqual(["more", "pimcalendar"]);
  });

  it("keeps capture available and targets nested folders, including overlays", () => {
    let s = initialNavState("notes");
    expect(showsCaptureFab(navTop(s))).toBe(true);
    s = pushEntry(s, { kind: "folder", path: "Projects/Plainva" });
    expect(showsCaptureFab(navTop(s))).toBe(true);
    expect(activeFolderPath(s)).toBe("Projects/Plainva");
    s = pushEntry(s, { kind: "note", path: "Projects/Plainva/Plan.md" });
    expect(showsCaptureFab(navTop(s))).toBe(false);

    let overlay = pushEntry(initialNavState("notes"), { kind: "more", path: "" });
    overlay = pushEntry(overlay, { kind: "folder", path: "Archive/2026" });
    expect(activeFolderPath(overlay)).toBe("Archive/2026");
    expect(showsCaptureFab(navTop(overlay))).toBe(true);
  });

  it("keeps the capture FAB out of Mail, as a tab root and as a pushed screen (B2)", () => {
    // As a TAB there is no top entry at all — the tab id is what decides.
    const mailTab = initialNavState("mail");
    expect(showsCaptureFab(navTop(mailTab), mailTab.activeTab)).toBe(false);
    expect(showsCaptureFab(navTop(initialNavState("notes")), "notes")).toBe(true);

    // Reached through the areas sheet, Mail is a pushed overlay entry.
    const pushed = pushEntry(initialNavState("notes"), { kind: "mail", path: "" });
    expect(showsCaptureFab(navTop(pushed), pushed.activeTab)).toBe(false);
  });
});

/**
 * P5 — the bar carries 3–5 areas and no fixed "More" tab. The count is a
 * setting now; everything outside the bar is reached through the areas sheet.
 */
describe("bar tab count (plan P5)", () => {
  it("clamps into the Material range and falls back to the default", () => {
    expect(sanitizeBarTabCount(undefined)).toBe(DEFAULT_BAR_TAB_COUNT);
    expect(sanitizeBarTabCount("4")).toBe(DEFAULT_BAR_TAB_COUNT);
    expect(sanitizeBarTabCount(0)).toBe(MIN_BAR_TABS);
    expect(sanitizeBarTabCount(99)).toBe(MAX_BAR_TABS);
    expect(sanitizeBarTabCount(4)).toBe(4);
    expect(sanitizeBarTabCount(4.4)).toBe(4);
  });

  it("existing installations keep exactly the bar they had", () => {
    // No stored count (upgrade) must read as the previous hard-coded three.
    expect(DEFAULT_BAR_TAB_COUNT).toBe(MIN_BAR_TABS);
    const order = sanitizeTabSlots(undefined);
    expect(barTabs(order, sanitizeBarTabCount(undefined))).toHaveLength(3);
  });

  it("shows as many areas as configured", () => {
    const order = sanitizeTabSlots(undefined);
    expect(barTabs(order, 5)).toHaveLength(5);
    expect(barTabs(order, 3)).toEqual(order.slice(0, 3));
  });
});

describe("ensureVisibleTab (plan P5)", () => {
  it("falls back to the first visible area when the active one leaves the bar", () => {
    const state = initialNavState("graph");
    const next = ensureVisibleTab(state, ["notes", "today", "tasks"]);
    expect(next.activeTab).toBe("notes");
  });

  it("leaves the state alone while the active area is still in the bar", () => {
    const state = initialNavState("today");
    expect(ensureVisibleTab(state, ["notes", "today", "tasks"])).toBe(state);
  });

  it("never strands the app on an empty bar", () => {
    const state = initialNavState("today");
    expect(ensureVisibleTab(state, [])).toBe(state);
  });
});

describe("bar labels (\u00a7 9.1)", () => {
  it("keeps a short bar label distinct wherever one is declared", () => {
    // The bar renders `barLabelKey ?? labelKey`; the settings preview used to
    // render `labelKey` only, so it promised "Datenbanken" where the bar says
    // "DBs" \u2014 the exact case barLabelKey was introduced for.
    //
    // Since S9 no area needs one: the only holder was "databases", which moved
    // into the navigator. The list may legitimately be empty, so the count is
    // NOT asserted; what must hold is that a declared short label differs from
    // the long one, and that everything drawing the bar reads it.
    for (const def of TAB_POOL.filter((d) => d.barLabelKey)) {
      expect(def.barLabelKey).not.toBe(def.labelKey);
    }
  });

  it("reads the short label everywhere the bar is drawn", () => {
    // Two places draw the bar: the bar itself and the settings preview. Both
    // must fall back the same way, or the preview promises a label the bar
    // does not show \u2014 which is how the divergence appeared the first time.
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of ["App.tsx", "screens/NavBarScreen.tsx"]) {
      const src = readFileSync(join(here, file), "utf8");
      expect(src, file).toMatch(/barLabelKey \?\?\s*\n?\s*(def|d|tab)\.labelKey/);
    }
  });
});

describe("input surfaces hide the navigation bar", () => {
  // A tap on the bar clears the overlay stack. On a surface whose whole point
  // is unfinished input that meant losing a draft mail, entered credentials or
  // the encryption wizard's in-memory keys — the note editor was the only one
  // the shell knew about.
  it("hides it on every surface that holds unsaved input", () => {
    for (const kind of ["note", "mailcompose", "sync"] as const) {
      expect(hidesTabBar({ kind, path: "" }), kind).toBe(true);
    }
  });

  it("keeps it on browsing surfaces and at a tab root", () => {
    // cloudconnect only picks a provider — nothing is lost by leaving it.
    for (const kind of ["folder", "base", "mail", "settings", "tasks", "cloudconnect"] as const) {
      expect(hidesTabBar({ kind, path: "" }), kind).toBe(false);
    }
    expect(hidesTabBar(undefined)).toBe(false);
  });
});
