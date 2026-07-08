// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initWebviewHardening,
  resetWebviewHardeningForTests,
  isReloadKey,
  isDevtoolsKey,
} from "./webviewHardening";
import { contextMenuStore, closeContextMenu } from "./contextMenuStore";

function mockSelection(text: string) {
  vi.spyOn(window, "getSelection").mockReturnValue({
    isCollapsed: text.length === 0,
    toString: () => text,
  } as unknown as Selection);
}

beforeEach(() => {
  resetWebviewHardeningForTests();
  closeContextMenu();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("isDevtoolsKey: F12 and Ctrl/Cmd+Shift+I/J/C", () => {
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "F12" }))).toBe(true);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "I", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "j", metaKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "i", ctrlKey: true }))).toBe(false);
    expect(isDevtoolsKey(new KeyboardEvent("keydown", { key: "F5" }))).toBe(false);
  });
});

describe("webviewHardening listeners", () => {
  it("swallows the reload key but leaves the sidebar toggle alone", () => {
    initWebviewHardening();
    const f5 = new KeyboardEvent("keydown", { key: "F5", cancelable: true, bubbles: true });
    window.dispatchEvent(f5);
    expect(f5.defaultPrevented).toBe(true);

    const sidebar = new KeyboardEvent("keydown", { key: "r", ctrlKey: true, altKey: true, cancelable: true, bubbles: true });
    window.dispatchEvent(sidebar);
    expect(sidebar.defaultPrevented).toBe(false);
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
