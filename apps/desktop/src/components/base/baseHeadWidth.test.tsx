// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { BASE_HEAD_NARROW, headContentWidth, isNarrowHead, useNarrowHead } from "./baseHeadWidth";

/**
 * A database's head says by itself whether it is narrow.
 *
 * It was a size container, asked by a container query. Its menus and popovers
 * are placed by the window, and a size container can take that placing over
 * (see baseHeadWidth.ts) — so the head measures now. What these tests pin is
 * that nothing changed for the eye: the labels go at the width they always
 * went at, which is the width of the head's CONTENT, and they go in the first
 * frame, not one frame late.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PADDING = 12;
let width = 0;
let observers: Array<() => void> = [];
let host: HTMLDivElement;
let root: Root;

function Head() {
  const { narrow, ref } = useNarrowHead();
  return <div ref={ref} data-testid="head" data-narrow={narrow ? "" : undefined} style={{ paddingLeft: PADDING, paddingRight: PADDING }} />;
}
const head = () => host.querySelector<HTMLElement>('[data-testid="head"]')!;
/** The head's box becomes `next` wide, and the browser says so. */
async function resizeTo(next: number) {
  width = next;
  await act(async () => { for (const fire of observers) fire(); });
}

beforeEach(() => {
  observers = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ width, height: 40 }) as DOMRect);
  vi.stubGlobal("ResizeObserver", class {
    private readonly fire: () => void;
    constructor(callback: () => void) { this.fire = callback; }
    observe() { observers.push(this.fire); }
    disconnect() { observers = observers.filter((fire) => fire !== this.fire); }
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("how wide a database's head is", () => {
  it("is the room for its content: its box without its padding", () => {
    const el = document.createElement("div");
    el.style.paddingLeft = `${PADDING}px`;
    el.style.paddingRight = `${PADDING}px`;
    width = 624;
    expect(headContentWidth(el)).toBe(600);
  });

  it("is narrow at the width the labels always went at, and below it", () => {
    const el = document.createElement("div");
    el.style.paddingLeft = `${PADDING}px`;
    el.style.paddingRight = `${PADDING}px`;
    width = BASE_HEAD_NARROW + 2 * PADDING;
    expect(isNarrowHead(el)).toBe(true);
    width += 1;
    expect(isNarrowHead(el)).toBe(false);
    width = 300;
    expect(isNarrowHead(el)).toBe(true);
  });

  it("has nothing to say before the head has a width", () => {
    width = 0;
    expect(isNarrowHead(document.createElement("div"))).toBe(false);
  });
});

describe("the head that measures itself", () => {
  it("is narrow in the very commit that attaches it", async () => {
    width = 505;
    await act(async () => { root.render(<Head />); });
    expect(head().hasAttribute("data-narrow")).toBe(true);
  });

  it("follows its pane: narrow when the pane is, and wide again after", async () => {
    width = 1365;
    await act(async () => { root.render(<Head />); });
    expect(head().hasAttribute("data-narrow")).toBe(false);

    await resizeTo(505);
    expect(head().hasAttribute("data-narrow")).toBe(true);
    await resizeTo(1365);
    expect(head().hasAttribute("data-narrow")).toBe(false);
  });

  it("stops listening when the head goes", async () => {
    width = 1365;
    await act(async () => { root.render(<Head />); });
    expect(observers).toHaveLength(1);
    await act(async () => { root.render(<></>); });
    expect(observers).toHaveLength(0);
  });
});
