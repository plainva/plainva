// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@plainva/ui/i18n";
import { Modal, TextInput } from "@plainva/ui";
import { dialogStore, settleDialog } from "../../services/appDialogs";
import { RepeatTaskModal } from "../tasks/RepeatTaskModal";

/**
 * "Discard your input?" on the desktop (finding 2026-10-22, Sammelplan 3.139
 * Nr. 3). A dialog with a field dropped what was typed on Escape, its X, a
 * click beside it or "Cancel"; only the mail composer asked. The question is
 * the shared one (`askDiscard`), shown with the app's own confirm, which the
 * test setup registers as main.tsx does.
 */

const held = vi.hoisted(() => new Set<() => Promise<boolean>>());
vi.mock("../../services/windowCloseGuard", () => ({
  holdWindowClose: (question: () => Promise<boolean>) => {
    held.add(question);
    return () => {
      held.delete(question);
    };
  },
}));

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
  held.clear();
});

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
};
/** The question on screen, answered. */
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
const escape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

function Draft({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  return (
    <Modal title="Entry" onClose={onClose} unsaved={text.trim() !== ""} testId="draft">
      <TextInput aria-label="text" value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}

describe("a dialog that holds typed input", () => {
  it("closes at once while nothing is typed", async () => {
    const onClose = vi.fn();
    act(() => root.render(<Draft onClose={onClose} />));
    act(() => escape());
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialogStore.get()).toBeNull();
  });

  it("asks before Escape, the X or a click beside it takes what was typed; Cancel keeps it, Discard closes", async () => {
    const onClose = vi.fn();
    act(() => root.render(<Draft onClose={onClose} />));
    const field = container.querySelector<HTMLInputElement>('input[aria-label="text"]')!;
    act(() => type(field, "The heron"));
    // The window is told, so closing it or switching its vault asks the same question.
    await vi.waitFor(() => expect(held.size).toBe(1));

    act(() => escape());
    await answer(false);
    expect(onClose, "Escape took the text without a word").not.toHaveBeenCalled();
    expect(field.value).toBe("The heron");

    act(() => container.querySelector<HTMLButtonElement>(".pv-modal-header button")!.click());
    await answer(false);
    act(() => container.querySelector<HTMLElement>(".pv-overlay")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    await answer(false);
    expect(onClose).not.toHaveBeenCalled();

    act(() => escape());
    await answer(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks once when two ways out are taken while the question stands", async () => {
    const onClose = vi.fn();
    act(() => root.render(<Draft onClose={onClose} />));
    act(() => type(container.querySelector<HTMLInputElement>('input[aria-label="text"]')!, "x"));
    act(() => container.querySelector<HTMLButtonElement>(".pv-modal-header button")!.click());
    act(() => container.querySelector<HTMLElement>(".pv-overlay")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    await settle();
    const asked = dialogStore.get()!;
    await act(async () => settleDialog(asked.id, true));
    await settle();
    expect(dialogStore.get(), "a second question queued behind the first").toBeNull();
  });

  it("the repeat dialog's Cancel asks once the interval was changed", async () => {
    const onCancel = vi.fn();
    act(() => root.render(<RepeatTaskModal taskTitle="Water the plants" initial={null} currentDue="2026-11-02" onCancel={onCancel} onSubmit={async () => {}} />));
    const cancel = () => [...container.querySelectorAll<HTMLButtonElement>(".pv-modal-footer button")].find((b) => /cancel/i.test(b.textContent ?? ""))!;
    act(() => cancel().click());
    await settle();
    expect(onCancel, "nothing changed: Cancel closes at once").toHaveBeenCalledTimes(1);

    onCancel.mockClear();
    act(() => type(container.querySelector<HTMLInputElement>('input[type="number"]')!, "3"));
    act(() => cancel().click());
    await answer(false);
    expect(onCancel).not.toHaveBeenCalled();
    act(() => cancel().click());
    await answer(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
