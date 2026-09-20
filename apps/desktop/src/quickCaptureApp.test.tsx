// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import en from "../../../packages/ui/src/locales/en.json";
import { QuickCaptureApp } from "./QuickCaptureApp";
import { setWindowBusForTest, type WindowBus } from "./services/windowBus";

/**
 * The quick-capture window of the global shortcut (plan Journal, J7): it holds
 * a text and hands it to the central window. Pinned here: what travels, that
 * the window only closes once the entry EXISTS, and that a refusal is shown in
 * this window — a toast in the central one would not be seen from here.
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

const closeWindow = vi.fn(async () => undefined);
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ close: closeWindow }) }));

let host: HTMLDivElement;
let root: Root;
const requests: Array<[string, unknown]> = [];
let answer: (args: { text: string; task: boolean }) => Promise<unknown>;

const byId = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function type(text: string) {
  const field = byId("quick-capture-field-input") as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return field;
}
const press = (field: HTMLElement, key: string) => act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });

beforeEach(async () => {
  requests.length = 0;
  closeWindow.mockClear();
  answer = async () => ({ ok: true });
  setWindowBusForTest({
    request: async (kind: string, args: unknown) => { requests.push([kind, args]); return answer(args as { text: string; task: boolean }); },
  } as unknown as WindowBus);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<QuickCaptureApp />); });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setWindowBusForTest(null);
});

describe("QuickCaptureApp", () => {
  it("hands the text and its kind to the central window, and closes once the entry exists", async () => {
    const field = await type("Router is in the basement #client");
    await act(async () => { byId("quick-capture-field-task")!.click(); });
    await press(field, "Enter");
    await settle();
    expect(requests).toEqual([["journal-capture", { text: "Router is in the basement #client", task: true }]]);
    expect(closeWindow).toHaveBeenCalledOnce();
  });

  it("shows a refusal here and keeps what was typed", async () => {
    answer = async () => ({ ok: false, message: en.quickCapture.noVault });
    const field = await type("a thought");
    await press(field, "Enter");
    await settle();
    expect(closeWindow).not.toHaveBeenCalled();
    expect(byId("quick-capture-error")!.textContent).toBe(en.quickCapture.noVault);
    expect(field.value).toBe("a thought");
    // Typing on takes the sentence away; the next Enter tries again.
    await type("a thought, continued");
    expect(byId("quick-capture-error")).toBeNull();
  });

  it("says so when the central window does not answer at all", async () => {
    answer = async () => { throw new Error("window RPC timed out"); };
    const field = await type("a thought");
    await press(field, "Enter");
    await settle();
    expect(byId("quick-capture-error")!.textContent).toBe(en.quickCapture.failed);
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it("sends nothing for an empty field, and Esc or the close button discard", async () => {
    const field = byId("quick-capture-field-input")!;
    await press(field, "Enter");
    expect(requests).toEqual([]);
    await press(field, "Escape");
    await settle();
    expect(closeWindow).toHaveBeenCalledTimes(1);
    await act(async () => { byId("quick-capture-close")!.click(); });
    await settle();
    expect(closeWindow).toHaveBeenCalledTimes(2);
  });
});
