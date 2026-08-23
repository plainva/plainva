// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The routing decision behind multi-window (plan E2).
 *
 * "Content is open once, app-wide" is the rule the whole design leans on: two
 * editors on one file would put the July sync hardening back into the state it
 * was rescued from. Everything here is about who gets to show a path — the
 * window that already has it, the central window's tab, or the caller.
 *
 * `@tauri-apps/api/webviewWindow` is mocked, so what runs is the routing itself
 * rather than a real OS window.
 */

const focused: string[] = [];
const created: Array<{
  label: string;
  url: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  alwaysOnTop?: boolean;
}> = [];
/** Labels whose OS window has vanished without telling the registry. */
const gone = new Set<string>();
/** URL fragments whose window construction throws (a window that will not come up). */
const refuse = new Set<string>();

vi.mock("@tauri-apps/api/webviewWindow", () => {
  class FakeWindow {
    label: string;
    constructor(
      label: string,
      options: { url: string; width?: number; height?: number; x?: number; y?: number; alwaysOnTop?: boolean },
    ) {
      this.label = label;
      for (const frag of refuse) {
        if (options.url.includes(frag)) throw new Error("the OS refused this window");
      }
      created.push({
        label,
        url: options.url,
        width: options.width,
        height: options.height,
        x: options.x,
        y: options.y,
        alwaysOnTop: options.alwaysOnTop,
      });
    }
    async onCloseRequested() {
      return () => {};
    }
    async unminimize() {}
    async show() {}
    async setFocus() {
      focused.push(this.label);
    }
    async close() {}
    static async getByLabel(label: string) {
      if (gone.has(label)) return null;
      // A HANDLE to an existing window, not a new one: constructing a
      // FakeWindow here would record a creation that never happened and make
      // the "no second window" assertion pass for the wrong reason.
      return {
        label,
        async unminimize() {},
        async show() {},
        async setFocus() {
          focused.push(label);
        },
        async close() {},
      };
    }
  }
  return { WebviewWindow: FakeWindow };
});

/** The settings store behind the restore switch. */
const settings = new Map<string, unknown>();
let settingsBroken = false;
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => {
    if (settingsBroken) throw new Error("no settings store");
    return {
      get: async (k: string) => settings.get(k),
      set: async (k: string, v: unknown) => {
        settings.set(k, v);
      },
      save: async () => {},
    };
  },
}));

/** What `availableMonitors()` answers; the array is swapped per test. */
let monitors: Array<{ position: { x: number; y: number }; size: { width: number; height: number } }> = [];
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: async () => monitors,
}));

import {
  findWindowForContent,
  isReachable,
  noteWindowAlwaysOnTop,
  noteWindowContents,
  openPresetWindow,
  restoreAuxWindows,
  getRestoreWindowsSetting,
  setRestoreWindowsSetting,
  openAuxWindow,
  openComposeWindow,
  openOrFocusContent,
  ownerHasContent,
  readPersistedWindows,
  resetWindowRegistryForTest,
  setOwnerOpenContents,
  noteWindowContent,
  isDuplicableView,
  noteVaultChanged,
} from "./windowManager";

import { forgetComposeDraft, readComposeDraft } from "./mail/composeHandoff";

const VAULT = "/vault";

const DRAFT = {
  accountId: "a1",
  fromAddress: "me@example.org",
  to: "you@example.org",
  cc: "",
  bcc: "",
  showCc: false,
  subject: "Quarterly numbers",
  body: "text",
  attachments: [],
  mailbox: "Drafts",
};

beforeEach(() => {
  resetWindowRegistryForTest();
  setOwnerOpenContents([]);
  focused.length = 0;
  created.length = 0;
  gone.clear();
  refuse.clear();
  settings.clear();
  settingsBroken = false;
  monitors = [{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }];
  window.localStorage.clear();
});

describe("window routing (dedup)", () => {
  it("focuses the window that already shows the content instead of opening a second", async () => {
    const rec = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Note.md" });
    created.length = 0;

    const result = await openOrFocusContent({ vaultPath: VAULT, path: "Note.md" });

    expect(result).toEqual({ where: "focused", label: rec.label });
    expect(focused).toEqual([rec.label]);
    expect(created, "a second window for the same note would be the duplicate the rule forbids").toEqual([]);
  });

  it("does not tell a window to focus itself", async () => {
    const rec = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Note.md" });

    // The window showing the note follows a link back to it: it draws it, and
    // nothing flashes to the front.
    const result = await openOrFocusContent({ vaultPath: VAULT, path: "Note.md", from: rec.label });

    expect(result).toEqual({ where: "caller" });
    expect(focused).toEqual([]);
  });

  it("sends the request to the central window when a tab holds the content", async () => {
    setOwnerOpenContents(["Tabbed.md"]);
    const result = await openOrFocusContent({ vaultPath: VAULT, path: "Tabbed.md" });
    expect(result).toEqual({ where: "owner" });
    expect(created).toEqual([]);
  });

  it("lets the caller draw content nobody has open", async () => {
    const result = await openOrFocusContent({ vaultPath: VAULT, path: "Fresh.md" });
    expect(result).toEqual({ where: "caller" });
    expect(created).toEqual([]);
  });

  it("opens a window when asked for a popout, and passes the content in the URL", async () => {
    const result = await openOrFocusContent({ vaultPath: VAULT, path: "Note.md", newWindow: true });

    expect(result.where).toBe("focused");
    expect(created).toHaveLength(1);
    const url = created[0]!.url;
    expect(url).toContain("win=aux");
    expect(url).toContain(encodeURIComponent("Note.md"));
    expect(url).toContain(encodeURIComponent(VAULT));
  });

  it("opens a fresh window when the remembered one is gone", async () => {
    const rec = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Note.md" });
    created.length = 0;
    // Killed by the OS without the close handler ever running.
    gone.add(rec.label);

    const result = await openOrFocusContent({ vaultPath: VAULT, path: "Note.md", newWindow: true });

    expect(result.where).toBe("focused");
    expect(created, "routing into a dead window would swallow the click").toHaveLength(1);
    expect(findWindowForContent(VAULT, "Note.md")?.label).not.toBe(rec.label);
  });

  it("keeps windows of other vaults out of the answer", async () => {
    await openAuxWindow({ role: "aux", vaultPath: "/other", content: "Note.md" });
    const result = await openOrFocusContent({ vaultPath: VAULT, path: "Note.md" });
    expect(result).toEqual({ where: "caller" });
  });

  it("follows a window that navigated on its own", async () => {
    const rec = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "First.md" });
    noteWindowContent(rec.label, "Second.md");

    expect(findWindowForContent(VAULT, "First.md")).toBeNull();
    expect(await openOrFocusContent({ vaultPath: VAULT, path: "Second.md" })).toEqual({
      where: "focused",
      label: rec.label,
    });
  });
});

describe("window size", () => {
  it("gives a view a landscape window and a note a column", async () => {
    const view = await openAuxWindow({ role: "aux", vaultPath: "/v", content: "plainva://calendar" });
    const note = await openAuxWindow({ role: "aux", vaultPath: "/v", content: "Note.md" });

    const viewWin = created.find((c) => c.label === view.label)!;
    const noteWin = created.find((c) => c.label === note.label)!;
    // A month grid or a mail list is not a column: opening it at note width
    // means the user resizes every single window by hand.
    expect(viewWin.width).toBeGreaterThan(noteWin.width!);
    expect(noteWin.height).toBeGreaterThan(noteWin.width!);
  });

  it("lets a remembered size win over the default", async () => {
    const rec = await openAuxWindow({
      role: "aux",
      vaultPath: "/v",
      content: "plainva://calendar",
      bounds: { x: 10, y: 20, width: 640, height: 480 },
    });

    const win = created.find((c) => c.label === rec.label)!;
    expect([win.width, win.height]).toEqual([640, 480]);
  });
});

describe("the owner's open-content mirror", () => {
  it("answers only for what the tabs currently hold", () => {
    setOwnerOpenContents(["A.md", "B.base"]);
    expect(ownerHasContent("A.md")).toBe(true);
    expect(ownerHasContent("B.base")).toBe(true);
    expect(ownerHasContent("C.md")).toBe(false);

    setOwnerOpenContents(["C.md"]);
    expect(ownerHasContent("A.md")).toBe(false);
    expect(ownerHasContent("C.md")).toBe(true);
  });
});

describe("remembering windows", () => {
  it("persists per vault and forgets the entry when the last window closes", async () => {
    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Note.md" });
    expect(readPersistedWindows(VAULT)).toHaveLength(1);
    expect(readPersistedWindows("/other")).toEqual([]);

    resetWindowRegistryForTest();
    // resetWindowRegistryForTest only drops the in-memory map; what a restart
    // reads is the stored list, which is what P4 restores from.
    expect(readPersistedWindows(VAULT)).toHaveLength(1);
  });

  it("moves its windows to the vault the central window switched to (C5)", async () => {
    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Note.md" });

    noteVaultChanged("/other");

    // BOTH lists are written, and that is the whole point: persisting only the
    // new one leaves the window listed under the old vault as well, so the next
    // start restores a window for content that vault no longer has.
    expect(readPersistedWindows("/other")).toHaveLength(1);
    expect(readPersistedWindows(VAULT)).toEqual([]);
    // The window itself is not lost — it is the same window, on another vault.
    expect(findWindowForContent("/other", "Note.md")).not.toBeNull();
  });

  it("ignores a stored list that is not a list of windows", () => {
    window.localStorage.setItem(`plainva-windows-${VAULT}`, '{"nope":true}');
    expect(readPersistedWindows(VAULT)).toEqual([]);
  });
});

describe("the composer as its own window", () => {
  it("hands the draft to the window it was opened for, however often it asks", async () => {
    const rec = await openComposeWindow({ vaultPath: VAULT, snapshot: DRAFT, title: DRAFT.subject });

    expect(readComposeDraft(rec.label)).toEqual(DRAFT);
    // Asking twice must not empty the form. This used to be a take, and React
    // StrictMode runs an effect twice in development: the second answer came
    // back null and won, so the writer saw "the draft is gone" over an empty
    // composer (maintainer finding 2026-08-23).
    expect(readComposeDraft(rec.label)).toEqual(DRAFT);
  });

  it("forgets the draft when its window goes away", async () => {
    const rec = await openComposeWindow({ vaultPath: VAULT, snapshot: DRAFT, title: DRAFT.subject });

    // What bounds the map now that reading no longer clears it: the close
    // handler wired in openAuxWindow, whichever way the window closed.
    forgetComposeDraft(rec.label);

    expect(readComposeDraft(rec.label)).toBeNull();
  });

  it("opens a second composer instead of focusing the first", async () => {
    const one = await openComposeWindow({ vaultPath: VAULT, snapshot: DRAFT, title: "One" });
    const two = await openComposeWindow({ vaultPath: VAULT, snapshot: { ...DRAFT, subject: "Two" }, title: "Two" });

    // "Content is open once" is about content in the vault. Writing two mails
    // at once is ordinary, and the drafts must not share an address.
    expect(one.label).not.toBe(two.label);
    expect(created).toHaveLength(2);
    expect(focused).toEqual([]);
    expect(readComposeDraft(two.label)?.subject).toBe("Two");
  });

  it("is not remembered for the next start", async () => {
    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Note.md" });
    await openComposeWindow({ vaultPath: VAULT, snapshot: DRAFT, title: DRAFT.subject });

    // Restoring a composer would reopen an EMPTY one: what it holds is unsaved
    // text in memory. A window that lies about having kept something is worse
    // than no window.
    const stored = readPersistedWindows(VAULT);
    expect(stored.map((w) => w.role)).toEqual(["aux"]);
  });
});

describe("tabs in an auxiliary window (P4)", () => {
  it("finds content in a window's second tab, not just the one on screen", async () => {
    const rec = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "One.md" });
    // The window opens a second tab and reports what it now holds.
    noteWindowContents(rec.label, "Two.md", ["One.md", "Two.md"]);
    created.length = 0;

    const result = await openOrFocusContent({ vaultPath: VAULT, path: "One.md" });

    // Dedup is about content, not about what happens to be visible: the note
    // sits in a background tab over there, so a second copy here would be the
    // duplicate editor the rule exists to prevent.
    expect(result).toEqual({ where: "focused", label: rec.label });
    expect(created).toEqual([]);
  });

  it("keeps finding content in a window that predates tabs", async () => {
    // A window recorded before this update has `content` and no `contents`.
    const rec = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Old.md" });
    expect(findWindowForContent(VAULT, "Old.md")?.label).toBe(rec.label);
  });

  it("stops finding a note that was closed in the other window", async () => {
    const rec = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "One.md" });
    noteWindowContents(rec.label, "Two.md", ["One.md", "Two.md"]);

    noteWindowContents(rec.label, "Two.md", ["Two.md"]);

    expect(findWindowForContent(VAULT, "One.md")).toBeNull();
    expect(findWindowForContent(VAULT, "Two.md")?.label).toBe(rec.label);
  });
});

describe("presets (E4)", () => {
  it("opens one window that starts with mail and calendar", async () => {
    const rec = await openPresetWindow({ vaultPath: VAULT, preset: "mail-calendar" });

    expect(created).toHaveLength(1);
    expect(created[0].url).toContain("preset=mail-calendar");
    // The first pane doubles as the dedup identity, so a second request finds it.
    expect(rec.content).toBe("plainva://mail");
    expect(findWindowForContent(VAULT, "plainva://mail")?.label).toBe(rec.label);
  });
});

describe("reachability of a saved position (E5)", () => {
  const HD = [{ position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }];

  it("accepts a window on screen", () => {
    expect(isReachable({ x: 100, y: 100, width: 900, height: 700 }, HD)).toBe(true);
  });

  it("rejects a window on the monitor that is gone", () => {
    // Saved on a second screen at x=2400; that screen is unplugged. The window
    // would come back where nothing can reach it.
    expect(isReachable({ x: 2400, y: 200, width: 900, height: 700 }, HD)).toBe(false);
  });

  it("accepts a window that hangs off the edge but keeps a grabbable title bar", () => {
    // 200px of the title bar remain: the user can pull it back. Judging by AREA
    // would move a window the user deliberately parked at the edge.
    expect(isReachable({ x: 1720, y: 300, width: 900, height: 700 }, HD)).toBe(true);
  });

  it("rejects a window with only a sliver left", () => {
    expect(isReachable({ x: 1880, y: 300, width: 900, height: 700 }, HD)).toBe(false);
  });

  it("rejects a window whose title bar sits above the desktop", () => {
    // Dragged under a taskbar or off the top: the body is visible, the drag
    // region is not — and that is the part you need to move it.
    expect(isReachable({ x: 100, y: -80, width: 900, height: 700 }, HD)).toBe(false);
  });

  it("does not move anything when the monitors cannot be read", () => {
    // No answer is not a reason to rearrange someone's desktop.
    expect(isReachable({ x: 4000, y: 4000, width: 900, height: 700 }, [])).toBe(true);
  });
});

describe("restoring windows on start (E5)", () => {
  it("reopens an auxiliary window where it was", async () => {
    await openAuxWindow({
      role: "aux",
      vaultPath: VAULT,
      content: "Note.md",
      bounds: { x: 120, y: 80, width: 900, height: 700 },
    });
    resetWindowRegistryForTest(); // as if the app had been restarted
    created.length = 0;

    const opened = await restoreAuxWindows(VAULT);

    expect(opened).toHaveLength(1);
    expect(created[0]).toMatchObject({ x: 120, y: 80, width: 900, height: 700 });
    expect(created[0].url).toContain("content=Note.md");
  });

  it("keeps the size but drops a position that no longer lands on a monitor", async () => {
    await openAuxWindow({
      role: "aux",
      vaultPath: VAULT,
      content: "Note.md",
      bounds: { x: 2400, y: 200, width: 900, height: 700 },
    });
    resetWindowRegistryForTest();
    created.length = 0;

    await restoreAuxWindows(VAULT);

    // Size is the user's choice and survives; the position is left to the OS
    // rather than restored out of reach.
    expect(created[0]).toMatchObject({ width: 900, height: 700 });
    expect(created[0].x).toBeUndefined();
    expect(created[0].y).toBeUndefined();
  });

  it("never restores a composer", async () => {
    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Note.md" });
    await openComposeWindow({ vaultPath: VAULT, snapshot: DRAFT, title: DRAFT.subject });
    resetWindowRegistryForTest();
    created.length = 0;

    const opened = await restoreAuxWindows(VAULT);

    // An unsent draft lives in memory. Reopening the window would produce an
    // EMPTY composer that claims to have kept something.
    expect(opened).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(created[0].url).toContain("content=Note.md");
  });

  it("brings back a preset window as a preset window", async () => {
    await openPresetWindow({ vaultPath: VAULT, preset: "mail-calendar" });
    resetWindowRegistryForTest();
    created.length = 0;

    await restoreAuxWindows(VAULT);

    // Without the preset the window would come back with mail alone — the
    // split is what the user opened it for.
    expect(created[0].url).toContain("preset=mail-calendar");
  });

  it("restores the pin (E6)", async () => {
    const rec = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Note.md" });
    noteWindowAlwaysOnTop(rec.label, true);
    resetWindowRegistryForTest();
    created.length = 0;

    await restoreAuxWindows(VAULT);

    expect(created[0].alwaysOnTop).toBe(true);
  });

  it("lets the other windows come up when one fails", async () => {
    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Kaputt.md" });
    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Heil.md" });
    resetWindowRegistryForTest();
    created.length = 0;
    refuse.add("content=Kaputt.md");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const opened = await restoreAuxWindows(VAULT);

    // One window that will not come up must not cost the others: a failed
    // restore that took the whole arrangement with it would look like the
    // setting had been off.
    warn.mockRestore();
    expect(opened).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(created[0].url).toContain("content=Heil.md");
  });

  it("has nothing to restore for a vault without saved windows", async () => {
    expect(await restoreAuxWindows("/other")).toEqual([]);
    expect(created).toEqual([]);
  });
});

describe("the restore switch (E5)", () => {
  it("is on for someone who never touched it", async () => {
    // A window arrangement is something the user built. Dropping it on every
    // start would make the whole feature feel accidental.
    expect(await getRestoreWindowsSetting()).toBe(true);
  });

  it("stays off once it was turned off", async () => {
    await setRestoreWindowsSetting(false);
    expect(await getRestoreWindowsSetting()).toBe(false);
  });

  it("falls back to on when the setting cannot be read", async () => {
    settingsBroken = true;
    // A store that will not answer is not a decision to change the behaviour.
    expect(await getRestoreWindowsSetting()).toBe(true);
  });
});

describe("window identity across restarts (finding 2026-08-23)", () => {
  it("keeps a restored window under the label its layout is stored beneath", async () => {
    // The panes and tabs of a window live in localStorage under its LABEL. Come
    // back with a different name and the tabs stay behind -- and land on
    // whichever window is called that next time.
    // Deliberately NOT the name a fresh counter would pick: after a restart it
    // starts at 0, so a window that was `aux-1` matches by luck and the
    // assertion would hold with or without the fix (red probe 2026-08-23).
    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Kept.md", label: "aux-5" });
    const saved = readPersistedWindows(VAULT);
    expect(saved).toHaveLength(1);
    const label = saved[0].label;
    expect(label).toBe("aux-5");

    resetWindowRegistryForTest();
    setRestoreWindowsSetting(true);
    created.length = 0;
    await restoreAuxWindows(VAULT);

    expect(created.map((c) => c.label), "a restored window must come back as itself").toEqual([label]);
  });

  it("never hands a fresh window a name that is already taken", async () => {
    // `counter` starts at 0 in every process. Without the guard the first new
    // window of a session collides with a restored one -- the maintainer asked
    // for tasks and got the graph, then the calendar.
    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "First.md", label: "aux-1" });
    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Second.md", label: "aux-2" });

    const fresh = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Third.md" });

    expect(["aux-1", "aux-2"]).not.toContain(fresh.label);
  });

  it("drops the stored tabs of an earlier window with the same name", async () => {
    // Closed by hand, so nothing restores it -- but its layout outlives it and
    // the name comes round again.
    window.localStorage.setItem(`plainva-layout-${VAULT}-aux-1`, JSON.stringify({ panes: [{ tabs: ["Ghost.md"] }] }));

    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Wanted.md" });

    expect(
      window.localStorage.getItem(`plainva-layout-${VAULT}-aux-1`),
      "a fresh window shows what it was opened with, not a stranger's tabs",
    ).toBeNull();
  });

  it("leaves the stored tabs alone when a window is restored", async () => {
    const layout = JSON.stringify({ panes: [{ tabs: ["Kept.md", "AlsoKept.md"] }] });
    window.localStorage.setItem(`plainva-layout-${VAULT}-aux-7`, layout);

    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Kept.md", label: "aux-7" });

    expect(window.localStorage.getItem(`plainva-layout-${VAULT}-aux-7`)).toBe(layout);
  });
});

describe("what a window leaves behind (multi-window C4)", () => {
  it("drops the sidebar state of an earlier window with the same name", async () => {
    // Same finding as the tabs above, one surface further: a full window keeps
    // its own sidebar widths and collapsed state, and a fresh window under a
    // recycled name would come up wearing them.
    window.localStorage.setItem("plainva-w-aux-1-plainva-left-sidebar-width", "480");
    window.localStorage.setItem("plainva-w-aux-1-plainva-right-panel-open-outline", "true");
    window.localStorage.setItem(`plainva-expanded-${VAULT}-aux-1`, JSON.stringify(["Projects"]));

    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Wanted.md" });

    expect(window.localStorage.getItem("plainva-w-aux-1-plainva-left-sidebar-width")).toBeNull();
    expect(window.localStorage.getItem("plainva-w-aux-1-plainva-right-panel-open-outline")).toBeNull();
    expect(window.localStorage.getItem(`plainva-expanded-${VAULT}-aux-1`)).toBeNull();
  });

  it("touches no other window and no other vault", async () => {
    window.localStorage.setItem("plainva-w-aux-2-plainva-left-sidebar-width", "300");
    window.localStorage.setItem("plainva-left-sidebar-width", "260");
    // The reason the label LEADS these keys: with a trailing label, this one —
    // a second vault whose folder happens to be named like a window — would be
    // swept away by opening `aux-1`.
    window.localStorage.setItem("plainva-expanded-D:/notes/aux-1", JSON.stringify(["Inbox"]));

    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Wanted.md" });

    expect(window.localStorage.getItem("plainva-w-aux-2-plainva-left-sidebar-width")).toBe("300");
    expect(window.localStorage.getItem("plainva-left-sidebar-width"), "the central window's own state").toBe("260");
    expect(window.localStorage.getItem("plainva-expanded-D:/notes/aux-1")).not.toBeNull();
  });

  it("leaves it alone when the window is restored", async () => {
    window.localStorage.setItem("plainva-w-aux-7-plainva-left-sidebar-width", "420");

    await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Kept.md", label: "aux-7" });

    expect(window.localStorage.getItem("plainva-w-aux-7-plainva-left-sidebar-width")).toBe("420");
  });
});

describe("views may exist more than once (maintainer decision 2026-08-23)", () => {
  it("opens a second window for a view that is already in one", async () => {
    const first = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "plainva://calendar" });
    created.length = 0;
    focused.length = 0;

    const result = await openOrFocusContent({ vaultPath: VAULT, path: "plainva://calendar", newWindow: true });

    expect(result.where).toBe("focused");
    expect(
      result.where === "focused" ? result.label : null,
      "the calendar may sit on both monitors",
    ).not.toBe(first.label);
    expect(created).toHaveLength(1);
    expect(focused, "nothing should be pulled forward instead").toEqual([]);
  });

  it("still refuses a second window for a note", async () => {
    const first = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "Note.md" });
    created.length = 0;

    const result = await openOrFocusContent({ vaultPath: VAULT, path: "Note.md", newWindow: true });

    expect(result).toEqual({ where: "focused", label: first.label });
    expect(created, "two editors on one file is the race the rule exists for").toEqual([]);
  });

  it("names which paths may be duplicated", () => {
    expect(isDuplicableView("plainva://mail")).toBe(true);
    expect(isDuplicableView("plainva://graph")).toBe(true);
    expect(isDuplicableView("Notes/Plan.md")).toBe(false);
    expect(isDuplicableView("Tasks.base")).toBe(false);
  });
});

describe("the communications window (finding 2026-08-23)", () => {
  it("starts from its preset instead of a stranger's leftovers", async () => {
    // The preset only decides what the two panes START with, and the aux shell
    // skips that seeding when a stored layout already holds tabs. So a layout
    // left behind under the same name -- one pane, mail only -- made the window
    // come up with mail and no calendar, permanently.
    window.localStorage.setItem(
      `plainva-layout-${VAULT}-aux-1`,
      JSON.stringify({ panes: [{ tabs: ["plainva://mail"] }] }),
    );

    const rec = await openPresetWindow({ vaultPath: VAULT, preset: "mail-calendar" });

    expect(window.localStorage.getItem(`plainva-layout-${VAULT}-${rec.label}`)).toBeNull();
    expect(rec.preset).toBe("mail-calendar");
  });
});
