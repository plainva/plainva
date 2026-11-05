// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { dialogStore, settleDialog } from "../services/appDialogs";
import { TaskCaptureBar } from "./tasks/TaskCaptureBar";
import { AddPropertyPopover } from "./PropertyValues";

/**
 * The last desktop surfaces that dropped typed text without a word
 * (Sammelplan 3.174 Nr. 1): the task capture bar on Escape and the
 * add-property popover on Escape. Both ask the shared "Discard your input?".
 */

vi.mock("../services/windowCloseGuard", () => ({ holdWindowClose: () => () => {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  dialogStore.clearAll();
});

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
};
async function answer(discard: boolean) {
  await vi.waitFor(() => expect(dialogStore.get()?.type, "the question is on screen").toBe("confirm"));
  const asked = dialogStore.get()!;
  await act(async () => settleDialog(asked.id, discard));
  await settle();
}
function type(field: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
const escapeOn = (el: Element) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

describe("the task capture bar", () => {
  it("clears at once while nothing is typed and asks before it clears typed text", async () => {
    act(() => root.render(<TaskCaptureBar todayKey="2026-11-05" providerList={null} focusTick={0} onSubmit={async () => true} />));
    const field = container.querySelector<HTMLInputElement>("input")!;
    act(() => escapeOn(field));
    await settle();
    expect(dialogStore.get(), "nothing typed: no question").toBeNull();

    act(() => type(field, "Water the plants"));
    act(() => escapeOn(field));
    await answer(false);
    expect(field.value, "Escape took the text without a word").toBe("Water the plants");

    act(() => escapeOn(field));
    await answer(true);
    expect(field.value).toBe("");
  });
});

describe("the add-property popover", () => {
  it("asks before Escape takes a typed name", async () => {
    const onClose = vi.fn();
    void i18n.changeLanguage("en");
    act(() => root.render(<AddPropertyPopover onAdd={() => {}} onClose={onClose} t={i18n.t.bind(i18n)} />));
    const field = container.querySelector<HTMLInputElement>("input")!;
    act(() => escapeOn(field));
    await settle();
    expect(onClose, "nothing typed: closes at once").toHaveBeenCalledTimes(1);

    onClose.mockClear();
    act(() => type(field, "mood"));
    act(() => escapeOn(field));
    await answer(false);
    expect(onClose).not.toHaveBeenCalled();
    act(() => escapeOn(field));
    await answer(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
