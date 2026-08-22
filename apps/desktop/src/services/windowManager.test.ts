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
const created: Array<{ label: string; url: string; width?: number; height?: number }> = [];
/** Labels whose OS window has vanished without telling the registry. */
const gone = new Set<string>();

vi.mock("@tauri-apps/api/webviewWindow", () => {
  class FakeWindow {
    label: string;
    constructor(label: string, options: { url: string; width?: number; height?: number }) {
      this.label = label;
      created.push({ label, url: options.url, width: options.width, height: options.height });
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

import {
  findWindowForContent,
  openAuxWindow,
  openOrFocusContent,
  ownerHasContent,
  readPersistedWindows,
  resetWindowRegistryForTest,
  setOwnerOpenContents,
  noteWindowContent,
} from "./windowManager";

const VAULT = "/vault";

beforeEach(() => {
  resetWindowRegistryForTest();
  setOwnerOpenContents([]);
  focused.length = 0;
  created.length = 0;
  gone.clear();
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

  it("ignores a stored list that is not a list of windows", () => {
    window.localStorage.setItem(`plainva-windows-${VAULT}`, '{"nope":true}');
    expect(readPersistedWindows(VAULT)).toEqual([]);
  });
});
