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
});
