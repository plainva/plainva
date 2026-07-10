// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import "@plainva/ui/i18n";
import { PinModeToggle } from "./PinModeToggle";

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
});

function render(el: ReactElement) {
  act(() => root.render(el));
}

function toggle(): HTMLButtonElement {
  return container.querySelector('[data-testid="graph-pin-toggle"]') as HTMLButtonElement;
}

describe("PinModeToggle", () => {
  it("reflects the active state via aria-pressed and fires onToggle on click", () => {
    const onToggle = vi.fn();
    render(<PinModeToggle active onToggle={onToggle} />);
    const btn = toggle();
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    act(() => btn.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows the inactive state when the mode is off", () => {
    render(<PinModeToggle active={false} onToggle={() => {}} />);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });
});
