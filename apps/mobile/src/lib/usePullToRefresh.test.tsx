// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useRef } from "react";

vi.mock("../services/haptics", () => ({ haptics: { light: () => {} } }));
vi.mock("../services/syncService", () => ({ getSyncStatus: () => "idle", subscribeSyncStatus: () => () => {}, syncNow: () => {} }));

import { usePullToRefresh } from "./usePullToRefresh";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A finger on the page: the events the gesture listens for, with the one coordinate it reads. */
function touch(el: Element, type: "touchstart" | "touchmove" | "touchend", clientY?: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: clientY === undefined ? [] : [{ clientY }] });
  el.dispatchEvent(event);
}

/** A list screen; until it is `ready` it shows something else, as the mail list does until its accounts are read. */
function Screen({ ready, onRefresh }: { ready: boolean; onRefresh: () => Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null);
  const indicator = usePullToRefresh(ref, onRefresh);
  if (!ready) return <p>no accounts yet</p>;
  return (
    <div ref={ref} data-testid="page">
      {indicator}
      <p>the list</p>
    </div>
  );
}

/** Down from the top past the threshold, one move per commit — the indicator re-renders the page as it grows. */
async function pull(page: Element, to = 320) {
  await act(async () => touch(page, "touchstart", 100));
  for (let y = 140; y <= to; y += 40) await act(async () => touch(page, "touchmove", y));
  await act(async () => touch(page, "touchend"));
}

/** A screen whose page is replaced by another element mid-pull (a branch or a key that renders another page). */
function Swapping({ page, onRefresh }: { page: "a" | "b"; onRefresh: () => Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null);
  const indicator = usePullToRefresh(ref, onRefresh);
  return (
    <div ref={ref} key={page} data-testid={`page-${page}`}>
      {indicator}
      <p>the list</p>
    </div>
  );
}

/**
 * A screen whose page keeps its element but loses the ref and gets it back, as
 * the mail list's does: its empty state and its list are one root element,
 * and only the list's branch hands the gesture its ref.
 */
function Detaching({ attached, onRefresh }: { attached: boolean; onRefresh: () => Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null);
  const indicator = usePullToRefresh(ref, onRefresh);
  return (
    <div ref={attached ? ref : undefined} data-testid="page">
      {indicator}
      <p>the list</p>
    </div>
  );
}

async function mount(first: boolean, onRefresh: () => Promise<void>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Screen ready={first} onRefresh={onRefresh} />));
  return {
    host,
    show: () => act(async () => root.render(<Screen ready onRefresh={onRefresh} />)),
    done: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("pull to refresh", () => {
  it("works on a page that comes a render after the first", async () => {
    // The mail list renders an empty state first; the gesture looked for its
    // page once, found none, and never looked again.
    const onRefresh = vi.fn(async () => {});
    const screen = await mount(false, onRefresh);
    await screen.show();
    await pull(screen.host.querySelector("[data-testid=page]")!);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await screen.done();
  });

  it("carries a pull through the renders it causes, and a short one refreshes nothing", async () => {
    const onRefresh = vi.fn(async () => {});
    const screen = await mount(true, onRefresh);
    const page = screen.host.querySelector("[data-testid=page]")!;
    await pull(page, 180);
    expect(onRefresh).not.toHaveBeenCalled();
    await pull(page);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await screen.done();
  });

  it("leaves a pull behind with its page — one that never ended there does not run on the next", async () => {
    // Pulled far enough on one page, which then gave way to another: the end
    // of that pull was never heard, and a finger lifted on the new page ran
    // the refresh.
    const onRefresh = vi.fn(async () => {});
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Swapping page="a" onRefresh={onRefresh} />));
    const first = host.querySelector("[data-testid=page-a]")!;
    await act(async () => touch(first, "touchstart", 100));
    for (let y = 140; y <= 320; y += 40) await act(async () => touch(first, "touchmove", y));
    await act(async () => root.render(<Swapping page="b" onRefresh={onRefresh} />));
    await act(async () => touch(host.querySelector("[data-testid=page-b]")!, "touchend"));
    expect(onRefresh).not.toHaveBeenCalled();
    // Nor is its indicator left standing on the new page.
    expect(host.querySelector(".m-ptr")).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });

  it("leaves a pull behind when its page loses the gesture and gets it back — the mail list's way", async () => {
    const onRefresh = vi.fn(async () => {});
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Detaching attached onRefresh={onRefresh} />));
    const page = host.querySelector("[data-testid=page]")!;
    await act(async () => touch(page, "touchstart", 100));
    for (let y = 140; y <= 320; y += 40) await act(async () => touch(page, "touchmove", y));
    expect(host.querySelector(".m-ptr")).not.toBeNull();
    await act(async () => root.render(<Detaching attached={false} onRefresh={onRefresh} />));
    await act(async () => root.render(<Detaching attached onRefresh={onRefresh} />));
    await act(async () => touch(page, "touchend"));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(host.querySelector(".m-ptr")).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });
});
