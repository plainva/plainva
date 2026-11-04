// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QuickCaptureSettings } from "./components/settings/QuickCaptureSettings";
import type { QuickCaptureConfig } from "./services/quickCapture";

/**
 * The recorder of the global quick-capture shortcut (issue #123).
 *
 * WebKit on macOS does not move the focus to a button that is clicked. The
 * recorder used to listen for the key on its button, so on a Mac it heard
 * nothing after "Change" and could only be left with Escape. Pinned here: a
 * click that focuses NOTHING — which is what that web view does, and what a
 * bare `click()` does in this environment — still makes the next key press the
 * shortcut, wherever the press lands.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", async () => {
  const data = (await import("../../../packages/ui/src/locales/en.json")).default;
  return { initReactI18next: { type: "3rdParty", init() {} }, useTranslation: () => ({ i18n: { language: "en" },
    t: (key: string) => {
      const value = key.split(".").reduce<unknown>((obj, k) => (obj as Record<string, unknown>)?.[k], data);
      return typeof value === "string" ? value : key;
    },
  }) };
});

const saved: QuickCaptureConfig[] = [];
vi.mock("./services/quickCapture", async () => {
  const actual = await vi.importActual<typeof import("./services/quickCapture")>("./services/quickCapture");
  return {
    ...actual,
    readQuickCaptureConfig: async () => ({ enabled: true, shortcut: actual.DEFAULT_QUICK_CAPTURE_SHORTCUT }),
    saveQuickCaptureConfig: async (config: QuickCaptureConfig) => { saved.push(config); return { status: "on" as const, shortcut: config.shortcut }; },
  };
});

let host: HTMLDivElement;
let root: Root;

const byId = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const recordButton = () => byId("quick-capture-record") as HTMLButtonElement;
const isRecording = () => host.textContent?.includes("Esc cancels") ?? false;

/** A click the way WebKit on macOS delivers it: the button is activated, the focus stays where it was. */
async function clickWithoutFocus(el: HTMLElement) {
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
}

/** A key press that lands where the focus is — on the body, since the click moved none. */
async function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => { (document.activeElement ?? document.body).dispatchEvent(event); });
  await settle();
  return event;
}

beforeEach(async () => {
  saved.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<QuickCaptureSettings />); });
  await settle();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

describe("the recorder of the global quick-capture shortcut", () => {
  it("takes the next key press as the shortcut although the click focused nothing (#123)", async () => {
    await clickWithoutFocus(recordButton());
    expect(document.activeElement).toBe(document.body);
    expect(isRecording()).toBe(true);

    const event = await press({ key: "k", code: "KeyK", ctrlKey: true, altKey: true });

    expect(saved).toEqual([{ enabled: true, shortcut: "Control+Alt+K" }]);
    expect(event.defaultPrevented).toBe(true);
    expect(isRecording()).toBe(false);
    expect(byId("quick-capture-shortcut")?.textContent).toMatch(/K$/);
  });

  it("says what a bare key lacks and keeps listening", async () => {
    await clickWithoutFocus(recordButton());
    await press({ key: "j", code: "KeyJ" });
    expect(saved).toEqual([]);
    // The info button of the switch brings a live region of its own; the hint is one of the status lines.
    expect(Array.from(host.querySelectorAll('[role="status"]'), (el) => el.textContent).join(" ")).toMatch(/Ctrl, Alt/);
    expect(isRecording()).toBe(true);

    await press({ key: "l", code: "KeyL", metaKey: true, shiftKey: true });
    expect(saved).toEqual([{ enabled: true, shortcut: "Shift+Super+L" }]);
  });

  it("is left with Escape, and the key goes no further", async () => {
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    try {
      await clickWithoutFocus(recordButton());
      const event = await press({ key: "Escape", code: "Escape" });
      expect(isRecording()).toBe(false);
      expect(event.defaultPrevented).toBe(true);
      expect(behind).not.toHaveBeenCalled();
      expect(saved).toEqual([]);
    } finally {
      document.removeEventListener("keydown", behind);
    }
  });

  it("ends with a press beside the button and when the window loses the focus", async () => {
    await clickWithoutFocus(recordButton());
    await act(async () => { document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    expect(isRecording()).toBe(false);

    await clickWithoutFocus(recordButton());
    expect(isRecording()).toBe(true);
    await act(async () => { window.dispatchEvent(new Event("blur")); });
    expect(isRecording()).toBe(false);

    // Not recording: a key press is the app's again.
    const event = await press({ key: "k", code: "KeyK", ctrlKey: true, altKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(saved).toEqual([]);
  });

  it("is switched off again by a second click on the button", async () => {
    await clickWithoutFocus(recordButton());
    await act(async () => { recordButton().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    expect(isRecording()).toBe(true);
    await clickWithoutFocus(recordButton());
    expect(isRecording()).toBe(false);
  });
});
