// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "../i18n";
import { ContextMenuHost } from "./ContextMenuHost";
import { openContextMenu, closeContextMenu } from "../services/contextMenuStore";
import { findEditable } from "@plainva/ui";

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
  document.body.innerHTML = "";
  closeContextMenu();
  vi.restoreAllMocks();
});

function render(el: ReactElement) {
  act(() => root.render(el));
}

function items(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".pv-menu-item"));
}

describe("ContextMenuHost", () => {
  it("renders nothing while the store is empty", () => {
    render(<ContextMenuHost />);
    expect(document.querySelector(".pv-menu")).toBeNull();
  });

  it("shows only Copy over a plain text selection", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<ContextMenuHost />);
    act(() => openContextMenu({ x: 12, y: 34, selection: "hello world", editable: null }));

    expect(items()).toHaveLength(1);
    act(() => items()[0].click());
    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("offers Cut/Copy/Paste over an editable field and pastes clipboard text", async () => {
    const input = Object.assign(document.createElement("input"), { type: "text", value: "ab" });
    document.body.appendChild(input);
    input.setSelectionRange(2, 2); // caret at end, no selection
    const editable = findEditable(input);

    const readText = vi.fn().mockResolvedValue("XY");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { readText, writeText }, configurable: true });

    render(<ContextMenuHost />);
    act(() => openContextMenu({ x: 1, y: 1, selection: "", editable }));

    const labels = items().map((b) => b.textContent);
    expect(labels).toEqual([
      i18n.t("contextMenu.cut"),
      i18n.t("contextMenu.copy"),
      i18n.t("contextMenu.paste"),
    ]);
    // No selection -> Cut and Copy disabled, Paste enabled.
    expect(items()[0].disabled).toBe(true);
    expect(items()[1].disabled).toBe(true);
    expect(items()[2].disabled).toBe(false);

    act(() => items()[2].click()); // Paste
    await vi.waitFor(() => expect(input.value).toBe("abXY"));
    expect(readText).toHaveBeenCalled();
  });

  it("cuts: copies the selection then deletes it from the field", async () => {
    const input = Object.assign(document.createElement("input"), { type: "text", value: "abXYef" });
    document.body.appendChild(input);
    input.setSelectionRange(2, 4); // "XY"
    const editable = findEditable(input);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<ContextMenuHost />);
    act(() => openContextMenu({ x: 1, y: 1, selection: "XY", editable }));

    // Cut is the first item and enabled (there is a selection).
    act(() => items()[0].click());
    expect(writeText).toHaveBeenCalledWith("XY");
    await vi.waitFor(() => expect(input.value).toBe("abef"));
  });
});
