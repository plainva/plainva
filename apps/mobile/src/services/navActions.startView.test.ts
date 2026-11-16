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
  return restoreSession(vaultOf(vaultId), setNav as never, nav).then(() => nav);
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
    }) as never, nav);
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
    const restoring = restoreSession(vaultOf("v-link"), setNav as never, nav);
    // plainva://open, a widget or a reminder, while the restore still awaits the bar.
    setNav((s) => pushEntry(s, { kind: "note", path: "From/link.md" }));
    await restoring;
    expect(Object.values(nav.stacks).flat()).toEqual([{ kind: "note", path: "From/link.md" }]);
  });

  // Review of issue 173: what a person opens while the start is restored wins in every branch.
  async function openDuringRestore(vaultId: string): Promise<NavState> {
    let nav: NavState = initialNavState("notes");
    const setNav = (next: NavState | ((s: NavState) => NavState)) => {
      nav = typeof next === "function" ? next(nav) : next;
    };
    const restoring = restoreSession(vaultOf(vaultId), setNav as never, nav);
    setNav((s) => pushEntry(s, { kind: "note", path: "From/link.md" }));
    await restoring;
    return nav;
  }

  it("as you left it, with a note to restore: a note a link opens meanwhile stays, the session comes back beside it", async () => {
    settings.startView = "restore";
    const nav = await openDuringRestore("v-left");
    expect(nav.activeTab).toBe("notes");
    expect(nav.stacks.notes).toEqual([{ kind: "note", path: "From/link.md" }]);
    expect(nav.stacks.tasks).toEqual([{ kind: "note", path: "Left/open.md" }]);
  });

  it("Home: a note a link opens meanwhile stays", async () => {
    settings.startView = "fresh";
    const nav = await openDuringRestore("v-home");
    expect(Object.values(nav.stacks).flat()).toEqual([{ kind: "note", path: "From/link.md" }]);
  });

  it("a first start: the note opened last does not cover a note a link opened meanwhile", async () => {
    settings.startView = "restore";
    rememberLastOpen("v-first-link", "Last/opened.md");
    const nav = await openDuringRestore("v-first-link");
    expect(nav.stacks.notes).toEqual([{ kind: "note", path: "Last/opened.md" }, { kind: "note", path: "From/link.md" }]);
  });

  // Review of issue 173, second round: a screen the app opens itself at a cold
  // start is no claim. The connect run's next step (Android ended the app
  // during the sign-in) comes back on top of the restored session.
  it("a screen the app opens itself meanwhile stays on top of the restored session", async () => {
    settings.startView = "restore";
    let nav: NavState = initialNavState("notes");
    const setNav = (next: NavState | ((s: NavState) => NavState)) => {
      nav = typeof next === "function" ? next(nav) : next;
    };
    const restoring = restoreSession(vaultOf("v-left"), setNav as never, nav);
    setNav((s) => ({ ...s, overlay: [...s.overlay, { kind: "sync", path: "" }] }));
    await restoring;
    expect(nav.activeTab).toBe("tasks");
    expect(nav.stacks.tasks).toEqual([{ kind: "note", path: "Left/open.md" }]);
    expect(nav.overlay).toEqual([{ kind: "sync", path: "" }]);
  });

  it("a launcher shortcut that only switches the area keeps it: the restore does not take it back", async () => {
    settings.startView = "restore";
    let nav: NavState = initialNavState("notes");
    const setNav = (next: NavState | ((s: NavState) => NavState)) => {
      nav = typeof next === "function" ? next(nav) : next;
    };
    const restoring = restoreSession(vaultOf("v-left"), setNav as never, nav);
    // newInTab -> tabTapped switches the tab; the stacks stay empty.
    setNav((s) => ({ ...s, activeTab: "today" }));
    await restoring;
    expect(nav.activeTab).toBe("today");
    expect(nav.stacks.today).toEqual([]);
    // The session comes back where it was, beside the area chosen.
    expect(nav.stacks.tasks).toEqual([{ kind: "note", path: "Left/open.md" }]);
  });

  // Review of issue 173, third round: no entry point has to claim anything.
  // Siri's "open note", a tapped comment notification or a tap in a list push
  // a note the way every other opener does, and it stays.
  it("a note opened meanwhile by any opener stays on top, without a word from that opener", async () => {
    settings.startView = "restore";
    let nav: NavState = initialNavState("notes");
    const setNav = (next: NavState | ((s: NavState) => NavState)) => {
      nav = typeof next === "function" ? next(nav) : next;
    };
    const restoring = restoreSession(vaultOf("v-left"), setNav as never, nav);
    setNav((s) => pushEntry(s, { kind: "note", path: "From/siri.md" }));
    await restoring;
    expect(nav.activeTab).toBe("notes");
    expect(nav.stacks.notes).toEqual([{ kind: "note", path: "From/siri.md" }]);
    expect(nav.stacks.tasks).toEqual([{ kind: "note", path: "Left/open.md" }]);
  });

  it("a tab the bar adoption moves the start off is no choice: the restored tab wins", async () => {
    settings.startView = "restore";
    let nav: NavState = initialNavState("journal"); // not in the bar any more
    const setNav = (next: NavState | ((s: NavState) => NavState)) => {
      nav = typeof next === "function" ? next(nav) : next;
    };
    const restoring = restoreSession(vaultOf("v-left"), setNav as never, nav);
    setNav((s) => ({ ...s, activeTab: "notes" })); // ensureVisibleTab in adoptBar
    await restoring;
    expect(nav.activeTab).toBe("tasks");
    expect(nav.stacks.tasks).toEqual([{ kind: "note", path: "Left/open.md" }]);
  });
});
