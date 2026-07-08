// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useDebouncedValue } from "./useDebouncedValue";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ value }: { value: string }) {
  const debounced = useDebouncedValue(value, 150);
  return <output>{debounced}</output>;
}

describe("useDebouncedValue", () => {
  let container: HTMLDivElement;
  let root: Root;
  const shown = () => container.querySelector("output")?.textContent;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("passes the initial value through immediately", () => {
    act(() => {
      root.render(<Probe value="a" />);
    });
    expect(shown()).toBe("a");
  });

  it("holds updates for the delay and collapses rapid changes to the last one", () => {
    act(() => {
      root.render(<Probe value="a" />);
    });
    act(() => {
      root.render(<Probe value="ab" />);
    });
    act(() => {
      root.render(<Probe value="abc" />);
    });
    expect(shown()).toBe("a");
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(shown()).toBe("a");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(shown()).toBe("abc");
  });
});
