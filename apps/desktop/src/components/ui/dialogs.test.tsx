// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@plainva/ui/i18n";
import { DialogHost } from "./DialogHost";
import { ToastHost } from "@plainva/ui";
import { appConfirm, appMessage, appPrompt, dialogStore } from "../../services/appDialogs";
import { toast } from "@plainva/ui";

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
  toast.clearAll();
});

const flush = () => act(async () => {});

function footerButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>(".pv-modal-footer button"));
}

describe("appDialogs + DialogHost", () => {
  it("confirm renders title/message and resolves true on the primary action", async () => {
    render(<DialogHost />);
    let result: boolean | undefined;
    act(() => {
      void appConfirm({ title: "Löschen?", message: "Datei A.md löschen?", kind: "danger" }).then(
        (r) => (result = r)
      );
    });
    expect(container.querySelector(".pv-modal-heading")!.textContent).toBe("Löschen?");
    expect(container.querySelector(".pv-dialog-msg")!.textContent).toContain("A.md");
    // Danger dialogs start focused on Cancel (safe default).
    const [cancelBtn, confirmBtn] = footerButtons();
    expect(document.activeElement).toBe(cancelBtn);
    expect(confirmBtn.className).toContain("pv-btn--danger");
    act(() => confirmBtn.click());
    await flush();
    expect(result).toBe(true);
    expect(container.querySelector(".pv-modal-heading")).toBeNull();
  });

  it("Escape cancels a confirm (false)", async () => {
    render(<DialogHost />);
    let result: boolean | undefined;
    act(() => {
      void appConfirm({ title: "Frage", message: "Ok?" }).then((r) => (result = r));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();
    expect(result).toBe(false);
  });

  it("prompt returns the typed value on Enter and null on cancel", async () => {
    render(<DialogHost />);
    let value: string | null | undefined;
    act(() => {
      void appPrompt({ title: "Name", initial: "Alt" }).then((v) => (value = v));
    });
    const input = container.querySelector<HTMLInputElement>(".pv-modal input.pv-field")!;
    expect(document.activeElement).toBe(input);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Neu");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    expect(value).toBe("Neu");

    let second: string | null | undefined;
    act(() => {
      void appPrompt({ title: "Nochmal" }).then((v) => (second = v));
    });
    act(() => footerButtons()[0].click()); // Cancel
    await flush();
    expect(second).toBeNull();
  });

  it("message shows a single OK action; queued dialogs appear in order", async () => {
    render(<DialogHost />);
    let firstDone = false;
    let secondDone = false;
    act(() => {
      void appMessage({ title: "Erste", message: "eins" }).then(() => (firstDone = true));
      void appMessage({ title: "Zweite", message: "zwei" }).then(() => (secondDone = true));
    });
    expect(container.querySelector(".pv-modal-heading")!.textContent).toBe("Erste");
    expect(footerButtons()).toHaveLength(1);
    act(() => footerButtons()[0].click());
    await flush();
    expect(firstDone).toBe(true);
    expect(container.querySelector(".pv-modal-heading")!.textContent).toBe("Zweite");
    act(() => footerButtons()[0].click());
    await flush();
    expect(secondDone).toBe(true);
    expect(container.querySelector(".pv-modal-heading")).toBeNull();
  });
});

describe("toastStore + ToastHost", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a toast, auto-dismisses and supports manual dismiss", () => {
    render(<ToastHost />);
    act(() => {
      toast.success("Gespeichert");
      toast.error("Fehlgeschlagen");
    });
    const toasts = container.querySelectorAll(".pv-toast");
    expect(toasts).toHaveLength(2);
    expect(toasts[0].textContent).toContain("Gespeichert");
    expect(toasts[1].className).toContain("pv-toast--error");

    act(() => {
      vi.advanceTimersByTime(5500); // success gone (5s), error still visible (8s)
    });
    expect(container.querySelectorAll(".pv-toast")).toHaveLength(1);

    act(() => container.querySelector<HTMLButtonElement>(".pv-toast-x")!.click());
    expect(container.querySelectorAll(".pv-toast")).toHaveLength(0);
  });
});

function render(el: React.ReactElement) {
  act(() => root.render(el));
}
