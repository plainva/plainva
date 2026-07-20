import { describe, expect, it } from "vitest";
import {
  backStep,
  BAR_TAB_COUNT,
  barTabs,
  DEFAULT_TAB_ORDER,
  initialNavState,
  moveTabId,
  navTop,
  popTop,
  pushCapturedNote,
  pushEntry,
  sanitizeTabSlots,
  TAB_POOL,
  tapTab,
} from "./navigation";

describe("sanitizeTabSlots (full-order model, redesign P3)", () => {
  it("falls back to the pool order for missing/invalid input", () => {
    expect(sanitizeTabSlots(undefined)).toEqual(DEFAULT_TAB_ORDER);
    expect(sanitizeTabSlots("notes")).toEqual(DEFAULT_TAB_ORDER);
    expect(sanitizeTabSlots([])).toEqual(DEFAULT_TAB_ORDER);
    expect(sanitizeTabSlots(["nope", 42])).toEqual(DEFAULT_TAB_ORDER);
  });

  it("drops unknown ids and duplicates, keeps order, appends the missing pool ids", () => {
    const out = sanitizeTabSlots(["calendar", "notes", "calendar", "bogus", "tags"]);
    expect(out.slice(0, 3)).toEqual(["calendar", "notes", "tags"]);
    expect([...out].sort()).toEqual([...TAB_POOL.map((t) => t.id)].sort());
  });

  it("keeps a legacy 4-slot value readable: its entries lead, the bar shows three", () => {
    const out = sanitizeTabSlots(["notes", "today", "tags", "bookmarks"]);
    expect(out.slice(0, 4)).toEqual(["notes", "today", "tags", "bookmarks"]);
    expect(out).toHaveLength(TAB_POOL.length);
    expect(barTabs(out)).toEqual(["notes", "today", "tags"]);
    expect(barTabs(out)).toHaveLength(BAR_TAB_COUNT);
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
    noNotes = pushCapturedNote(noNotes, ["today", "tags"], "Inbox/Note.md");
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

  it("routes the PIM calendar screens through the active tab, and its accounts screen stacks on top", () => {
    // calendar-mobile: the PIM calendar opens from the daily calendar (a tab
    // root) — as content it lands in the active tab's stack (back returns to
    // the daily calendar), and its accounts screen pushes on top of it.
    let s = tapTab(initialNavState("notes"), "calendar");
    s = pushEntry(s, { kind: "pimcalendar", path: "" });
    expect(s.overlay).toHaveLength(0);
    expect(navTop(s)).toEqual({ kind: "pimcalendar", path: "" });
    s = pushEntry(s, { kind: "pimaccounts", path: "" });
    expect(navTop(s)).toEqual({ kind: "pimaccounts", path: "" });
    expect(popTop(s).stacks.calendar.map((e) => e.kind)).toEqual(["pimcalendar"]);
    // From an open overlay (More → Calendar) both stay in the overlay.
    let o = pushEntry(initialNavState("notes"), { kind: "more", path: "" });
    o = pushEntry(o, { kind: "calendar", path: "" });
    o = pushEntry(o, { kind: "pimcalendar", path: "" });
    expect(o.overlay.map((e) => e.kind)).toEqual(["more", "calendar", "pimcalendar"]);
  });
});
