// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useStableHandler } from "./useStableHandler";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const captured: Array<(x: number) => string> = [];

function Probe({ suffix }: { suffix: string }) {
  const handler = useStableHandler((x: number) => `${x}${suffix}`);
  captured.push(handler);
  return null;
}

describe("useStableHandler (P2.12)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    captured.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the same identity across renders (memo children skip re-renders)", () => {
    act(() => { root.render(<Probe suffix="a" />); });
    act(() => { root.render(<Probe suffix="b" />); });
    expect(captured.length).toBe(2);
    expect(captured[0]).toBe(captured[1]);
  });

  it("always calls the LATEST render's closure, never a stale one", () => {
    act(() => { root.render(<Probe suffix="a" />); });
    const stable = captured[0];
    expect(stable(1)).toBe("1a");
    act(() => { root.render(<Probe suffix="z" />); });
    // Same function object, new behavior — no stale closure.
    expect(stable(1)).toBe("1z");
  });

  it("forwards arguments and return values", () => {
    act(() => { root.render(<Probe suffix="!" />); });
    expect(captured[0](42)).toBe("42!");
  });
});
