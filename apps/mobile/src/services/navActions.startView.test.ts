// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavState, TabScreenId } from "../navigation";
import { initialNavState, pushEntry } from "../navigation";

/**
 * "On start" on the phone (plan 2026-11-05, P10): "As you left it" brings the
 * stored session back, "Home" opens on Home — and either way the session is
 * marked ready, so it keeps being saved for the day the choice goes back.
 */
const settings = { startView: "restore" as "restore" | "fresh" };
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => settings }));
vi.mock("./mobileBar", () => ({
  loadMobileBar: async () => null,
  shownBarTabs: (): TabScreenId[] => ["notes", "today", "tasks"],
}));
vi.mock("./windowClass", () => ({ getWindowClass: () => "compact", isRailClass: () => false }));

const { restoreSession } = await import("./navActions");
const { flushNavSave, readNavState, scheduleNavSave, writeNavState } = await import("./sessionState");
const { rememberLastOpen } = await import("@plainva/ui");

const vaultOf = (vaultId: string) => ({ vaultId, files: { exists: async () => true } }) as unknown as Parameters<typeof restoreSession>[0];

function boot(vaultId: string): Promise<NavState> {
  let nav: NavState = initialNavState("today");
  const setNav = (next: NavState | ((s: NavState) => NavState)) => {
    nav = typeof next === "function" ? next(nav) : next;
  };
  return restoreSession(vaultOf(vaultId), setNav as never).then(() => nav);
}

beforeEach(() => {
  localStorage.clear();
  for (const id of ["v-left", "v-home"]) writeNavState(id, pushEntry(initialNavState("tasks"), { kind: "note", path: "Left/open.md" }));
});

describe("on start (P10)", () => {
  it("as you left it: the stored area and note come back", async () => {
    settings.startView = "restore";
    const nav = await boot("v-left");
    expect(nav.activeTab).toBe("tasks");
    expect(nav.stacks.tasks).toEqual([{ kind: "note", path: "Left/open.md" }]);
  });

  it("Home: opens on Home with nothing on top, and keeps saving the session", async () => {
    settings.startView = "fresh";
    const nav = await boot("v-home");
    expect(nav.activeTab).toBe("notes");
    expect(Object.values(nav.stacks).flat()).toEqual([]);
    // Ready: the next navigation is saved rather than held back as "not read yet".
    scheduleNavSave("v-home", pushEntry(nav, { kind: "note", path: "Later.md" }));
    flushNavSave();
    expect(readNavState("v-home")?.stacks.notes).toEqual([{ kind: "note", path: "Later.md" }]);
  });

  // Issue #173: a session left on Home is a session, not "nothing stored" —
  // the last-note memory is for a start without any saved session.
  it("as you left it, left on Home: starts on Home, not on the note opened last", async () => {
    settings.startView = "restore";
    writeNavState("v-on-home", initialNavState("notes"));
    rememberLastOpen("v-on-home", "Last/opened.md");
    const nav = await boot("v-on-home");
    expect(nav.activeTab).toBe("notes");
    expect(Object.values(nav.stacks).flat()).toEqual([]);
  });

  it("as you left it, the note left open is gone: starts on Home, not on another note", async () => {
    settings.startView = "restore";
    writeNavState("v-gone", pushEntry(initialNavState("notes"), { kind: "note", path: "Gone.md" }));
    rememberLastOpen("v-gone", "Other.md");
    let nav: NavState = initialNavState("notes");
    const vault = { vaultId: "v-gone", files: { exists: async (p: string) => p !== "Gone.md" } } as unknown as Parameters<typeof restoreSession>[0];
    await restoreSession(vault, ((next: NavState | ((s: NavState) => NavState)) => {
      nav = typeof next === "function" ? next(nav) : next;
    }) as never);
    expect(Object.values(nav.stacks).flat()).toEqual([]);
  });

  it("no session stored at all (a first start): the note opened last still comes back", async () => {
    settings.startView = "restore";
    rememberLastOpen("v-first", "Last/opened.md");
    const nav = await boot("v-first");
    expect(Object.values(nav.stacks).flat()).toEqual([{ kind: "note", path: "Last/opened.md" }]);
  });

  it("left on Home: a note a link opens while the session is restored stays open", async () => {
    settings.startView = "restore";
    writeNavState("v-link", initialNavState("notes"));
    rememberLastOpen("v-link", "Last/opened.md");
    let nav: NavState = initialNavState("notes");
    const setNav = (next: NavState | ((s: NavState) => NavState)) => {
      nav = typeof next === "function" ? next(nav) : next;
    };
    const restoring = restoreSession(vaultOf("v-link"), setNav as never);
    // plainva://open, a widget or a reminder, while the restore still awaits the bar.
    setNav((s) => pushEntry(s, { kind: "note", path: "From/link.md" }));
    await restoring;
    expect(Object.values(nav.stacks).flat()).toEqual([{ kind: "note", path: "From/link.md" }]);
  });
});

