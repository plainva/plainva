// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initWebviewHardening,
  resetWebviewHardeningForTests,
  isReloadKey,
  isDevtoolsKey,
} from "./webviewHardening";
import { contextMenuStore, closeContextMenu } from "./contextMenuStore";
import { SHORTCUT_CATEGORIES } from "./shortcutCatalog";

function mockSelection(text: string) {
  vi.spyOn(window, "getSelection").mockReturnValue({
    isCollapsed: text.length === 0,
    toString: () => text,
  } as unknown as Selection);
}

/**
 * Presses a key the way the webview delivers it — at the focused element, then
 * bubbling — and reports whether the app's own listener saw it. That listener
 * sits where AppShell's global shortcut handler sits: on window, bubble phase.
 */
function press(init: KeyboardEventInit): { reachedApp: boolean; prevented: boolean } {
  let reachedApp = false;
  const app = () => { reachedApp = true; };
  window.addEventListener("keydown", app);
  const ev = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  document.body.dispatchEvent(ev);
  window.removeEventListener("keydown", app);
  return { reachedApp, prevented: ev.defaultPrevented };
}

const MODIFIER_TOKENS = new Set(["Mod", "Ctrl", "Alt", "Shift"]);
/** `KeyboardEvent.key` for the catalog's display tokens; the others are spelled alike. */
const KEY_OF_TOKEN: Record<string, string> = {
  Del: "Delete", Esc: "Escape", Space: " ", "−": "-",
  "←": "ArrowLeft", "→": "ArrowRight", "↑": "ArrowUp", "↓": "ArrowDown",
};

/**
 * Every key press the shortcuts window (F1) documents, as the webview would
 * deliver it: "Mod" once as Ctrl (Windows, Linux) and once as Cmd (macOS). A
 * combo of several plain keys (`[[`, the four arrows) is pressed key by key.
 */
function catalogPresses(): { label: string; init: KeyboardEventInit }[] {
  const presses: { label: string; init: KeyboardEventInit }[] = [];
  for (const category of SHORTCUT_CATEGORIES) {
    for (const row of category.keyboard) {
      for (const combo of row.keys) {
        const shiftKey = combo.includes("Shift");
        const altKey = combo.includes("Alt");
        const mods: KeyboardEventInit[] = combo.includes("Mod")
          ? [{ ctrlKey: true }, { metaKey: true }]
          : [{ ctrlKey: combo.includes("Ctrl") }];
        for (const token of combo.filter((t) => !MODIFIER_TOKENS.has(t))) {
          let key = KEY_OF_TOKEN[token] ?? token;
          if (key.length === 1) key = shiftKey ? key.toUpperCase() : key.toLowerCase();
          for (const mod of mods) {
            presses.push({
              label: `${row.descKey}: ${combo.join("+")}${mod.metaKey ? " (Cmd)" : ""}`,
              init: { key, shiftKey, altKey, ...mod },
            });
          }
        }
      }
    }
  }
  return presses;
}

beforeEach(() => {
  resetWebviewHardeningForTests();
  closeContextMenu();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("webviewHardening key predicates", () => {
  it("isReloadKey: F5 and Ctrl/Cmd+R, but not Mod+Alt+R", () => {
    expect(isReloadKey(new KeyboardEvent("keydown", { key: "F5" }))).toBe(true);
    expect(isReloadKey(new KeyboardEvent("keydown", { key: "r", ctrlKey: true }))).toBe(true);
    expect(isReloadKey(new KeyboardEvent("keydown", { key: "r", metaKey: true }))).toBe(true);
    // Mod+Alt+R is the right-sidebar toggle — must stay free.
    expect(isReloadKey(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, altKey: true }))).toBe(false);
    expect(isReloadKey(new KeyboardEvent("keydown", { key: "r" }))).toBe(false);
  });

  it("isDevtoolsKey: F12 and Ctrl/Cmd+Shift+I/C — not J, the journal entry", () => {
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "F12" }))).toBe(true);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "I", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "i", metaKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "C", metaKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "J", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "j", metaKey: true, shiftKey: true }))).toBe(false);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "i", ctrlKey: true }))).toBe(false);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "F5" }))).toBe(false);
  });
});

describe("webviewHardening in a release build", () => {
  beforeEach(() => {
    vi.stubEnv("PROD", true);
    initWebviewHardening();
  });

  it("lets Ctrl/Cmd+Shift+J through to the journal entry", () => {
    expect(press({ key: "J", ctrlKey: true, shiftKey: true })).toEqual({ reachedApp: true, prevented: false });
    expect(press({ key: "J", metaKey: true, shiftKey: true })).toEqual({ reachedApp: true, prevented: false });
  });

  it("still swallows the devtools keys", () => {
    const devtools: KeyboardEventInit[] = [
      { key: "F12" },
      { key: "I", ctrlKey: true, shiftKey: true },
      { key: "I", metaKey: true, shiftKey: true },
      { key: "C", ctrlKey: true, shiftKey: true },
      { key: "C", metaKey: true, shiftKey: true },
    ];
    for (const init of devtools) {
      expect(press(init), JSON.stringify(init)).toEqual({ reachedApp: false, prevented: true });
    }
  });

  it("swallows no key the shortcuts window (F1) documents", () => {
    const presses = catalogPresses();
    // Not vacuous: the catalog is read, down to the key this guard exists for.
    expect(presses.map((p) => p.label)).toContain("journal.newEntry: Mod+Shift+J (Cmd)");
    const swallowed = presses
      .filter(({ init }) => {
        const { reachedApp, prevented } = press(init);
        return !reachedApp || prevented;
      })
      .map(({ label }) => label);
    expect(swallowed).toEqual([]);
  });
});

describe("webviewHardening in a dev build", () => {
  it("leaves the devtools keys to the webview, so the maintainer can still debug", () => {
    vi.stubEnv("PROD", false);
    initWebviewHardening();
    expect(press({ key: "F12" })).toEqual({ reachedApp: true, prevented: false });
    expect(press({ key: "I", ctrlKey: true, shiftKey: true })).toEqual({ reachedApp: true, prevented: false });
  });
});

describe("webviewHardening listeners", () => {
  it("never reloads the webview but now re-reads the vault, and leaves the sidebar toggle alone", () => {
    initWebviewHardening();
    const refreshed = vi.fn();
    window.addEventListener("plainva-refresh-vault", refreshed);

    const f5 = new KeyboardEvent("keydown", { key: "F5", cancelable: true, bubbles: true });
    window.dispatchEvent(f5);
    // Still cancelled — a webview reload would drop tabs and unsaved buffers …
    expect(f5.defaultPrevented).toBe(true);
    // … but the key is no longer dead: it means "read the vault again" (P1b).
    expect(refreshed).toHaveBeenCalledOnce();

    const sidebar = new KeyboardEvent("keydown", { key: "r", ctrlKey: true, altKey: true, cancelable: true, bubbles: true });
    window.dispatchEvent(sidebar);
    expect(sidebar.defaultPrevented).toBe(false);
    expect(refreshed).toHaveBeenCalledOnce();
    window.removeEventListener("plainva-refresh-vault", refreshed);
  });

  it("suppresses the native menu and opens the copy menu on a text selection", () => {
    mockSelection("hello");
    initWebviewHardening();
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 });
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(contextMenuStore.get()).toEqual({ x: 10, y: 20, selection: "hello", editable: null });
  });

  it("opens over an editable field even without a selection (for Paste)", () => {
    const input = Object.assign(document.createElement("input"), { type: "text", value: "hi" });
    document.body.appendChild(input);
    initWebviewHardening();
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 6 });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const state = contextMenuStore.get();
    expect(state?.editable?.kind).toBe("input");
    expect(state?.selection).toBe("");
    input.remove();
  });

  it("suppresses the native menu but shows nothing when there is no selection", () => {
    mockSelection("");
    initWebviewHardening();
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(contextMenuStore.get()).toBeNull();
  });

  it("leaves an app-owned context menu untouched (already preventDefaulted)", () => {
    const appHandler = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", appHandler);
    mockSelection("hello");
    initWebviewHardening();
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(contextMenuStore.get()).toBeNull();
    document.removeEventListener("contextmenu", appHandler);
  });

  it("is idempotent — a second init does not double-fire", () => {
    mockSelection("x");
    initWebviewHardening();
    initWebviewHardening();
    let calls = 0;
    const unsub = contextMenuStore.subscribe(() => { calls += 1; });
    document.body.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(calls).toBe(1);
    unsub();
  });
});
