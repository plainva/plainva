import { describe, expect, it } from "vitest";
import {
  backStep,
  DEFAULT_TAB_SLOTS,
  initialNavState,
  MAX_TAB_SLOTS,
  navTop,
  popTop,
  pushCapturedNote,
  pushEntry,
  sanitizeTabSlots,
  TAB_POOL,
  tapTab,
} from "./navigation";

describe("sanitizeTabSlots", () => {
  it("falls back to the default for missing/invalid input", () => {
    expect(sanitizeTabSlots(undefined)).toEqual(DEFAULT_TAB_SLOTS);
    expect(sanitizeTabSlots("notes")).toEqual(DEFAULT_TAB_SLOTS);
    expect(sanitizeTabSlots([])).toEqual(DEFAULT_TAB_SLOTS);
    expect(sanitizeTabSlots(["nope", 42])).toEqual(DEFAULT_TAB_SLOTS);
  });

  it("drops unknown ids and duplicates, keeps order, caps the count", () => {
    expect(sanitizeTabSlots(["calendar", "notes", "calendar", "bogus", "tags"])).toEqual([
      "calendar",
      "notes",
      "tags",
    ]);
    const all = TAB_POOL.map((t) => t.id);
    expect(sanitizeTabSlots(all)).toHaveLength(MAX_TAB_SLOTS);
  });

  it("returns a fresh array (callers mutate for reordering)", () => {
    const a = sanitizeTabSlots(undefined);
    const b = sanitizeTabSlots(undefined);
    expect(a).not.toBe(b);
    expect(a).not.toBe(DEFAULT_TAB_SLOTS);
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
});
