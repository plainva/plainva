// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useHoldDrag } from "@plainva/ui";

/**
 * The gesture that replaces the drag handles in the interface (plan E10).
 * Every test pins a failure mode the plan calls out — above all the movement
 * cancel that the action rail is missing today, without which no scrollable
 * list survives the switch.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const calls = {
  drop: [] as string[],
  move: [] as string[],
  click: 0,
};

function Harness({ holdMs = 400 }: { holdMs?: number }) {
  const { dragId, handlers } = useHoldDrag({
    holdMs,
    slopPx: 8,
    onMove: (id) => calls.move.push(id),
    onDrop: (id) => calls.drop.push(id),
  });
  return (
    <button
      type="button"
      data-testid="row"
      data-dragging={dragId === "a" ? "yes" : "no"}
      onClick={() => {
        calls.click += 1;
      }}
      {...handlers("a")}
    >
      Row A
    </button>
  );
}

function render(el: ReactElement) {
  act(() => root.render(el));
}

function row(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-testid="row"]');
  if (!el) throw new Error("row not rendered");
  return el;
}

function fire(el: Element, type: string, init: { clientX?: number; clientY?: number; button?: number } = {}) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: init.button ?? 0,
        clientX: init.clientX ?? 0,
        clientY: init.clientY ?? 0,
      }),
    );
  });
}

function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  calls.drop = [];
  calls.move = [];
  calls.click = 0;
  // jsdom implements neither pointer capture nor PointerEvent defaults.
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  document.body.style.removeProperty("user-select");
});

describe("useHoldDrag", () => {
  it("does nothing before the hold elapses", () => {
    render(<Harness />);
    fire(row(), "pointerdown");
    tick(399);
    expect(row().dataset.dragging).toBe("no");
  });

  it("arms after the hold and drops on release", () => {
    render(<Harness />);
    fire(row(), "pointerdown");
    tick(400);
    expect(row().dataset.dragging).toBe("yes");
    fire(row(), "pointerup");
    expect(calls.drop).toEqual(["a"]);
  });

  it("CANCELS the hold when the pointer travels — scrolling must win", () => {
    render(<Harness />);
    fire(row(), "pointerdown", { clientY: 0 });
    tick(150);
    fire(row(), "pointermove", { clientY: 40 });
    tick(400);
    expect(row().dataset.dragging).toBe("no");
    fire(row(), "pointerup");
    expect(calls.drop).toEqual([]);
  });

  it("tolerates a tremble below the slop", () => {
    render(<Harness />);
    fire(row(), "pointerdown", { clientY: 0 });
    fire(row(), "pointermove", { clientY: 4 });
    tick(400);
    expect(row().dataset.dragging).toBe("yes");
  });

  it("keeps a plain click working", () => {
    render(<Harness />);
    fire(row(), "pointerdown");
    tick(80);
    fire(row(), "pointerup");
    fire(row(), "click");
    expect(calls.click).toBe(1);
  });

  it("swallows the click that follows a drag", () => {
    render(<Harness />);
    fire(row(), "pointerdown");
    tick(400);
    fire(row(), "click");
    expect(calls.click).toBe(0);
  });

  it("reports movement only while armed", () => {
    render(<Harness />);
    fire(row(), "pointerdown");
    fire(row(), "pointermove", { clientY: 2 });
    expect(calls.move).toEqual([]);
    tick(400);
    fire(row(), "pointermove", { clientY: 3 });
    expect(calls.move).toEqual(["a"]);
  });

  it("cancels on Escape without dropping", () => {
    render(<Harness />);
    fire(row(), "pointerdown");
    tick(400);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(row().dataset.dragging).toBe("no");
    fire(row(), "pointerup");
    expect(calls.drop).toEqual([]);
  });

  it("a right-click during the hold means menu, not drag", () => {
    render(<Harness />);
    fire(row(), "pointerdown");
    tick(200);
    fire(row(), "contextmenu");
    tick(400);
    expect(row().dataset.dragging).toBe("no");
  });

  it("releases the text-selection lock when the drag ends", () => {
    render(<Harness />);
    fire(row(), "pointerdown");
    tick(400);
    expect(document.body.style.userSelect).toBe("none");
    fire(row(), "pointerup");
    expect(document.body.style.userSelect).toBe("");
  });

  it("honours a shorter hold (touch shells use 350 ms)", () => {
    render(<Harness holdMs={350} />);
    fire(row(), "pointerdown");
    tick(350);
    expect(row().dataset.dragging).toBe("yes");
  });
});
