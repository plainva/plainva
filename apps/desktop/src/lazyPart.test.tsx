// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, Component, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { FAILED_LOAD_HELD_MS, lazyPart, preloadLazyPart } from "@plainva/ui";

/**
 * A part of the app loaded on demand (performance plan L5): a part loaded ahead draws at once, without a frame of
 * its fallback; a load that failed is shown by the boundary and loaded again when the part mounts anew.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class Catch extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p data-testid="failed">failed</p> : this.props.children;
  }
}

function mount(node: ReactNode) {
  const host = document.createElement("div");
  const root = createRoot(host);
  return { host, root, render: () => act(async () => root.render(node)) };
}

describe("a part loaded on demand", () => {
  it("draws at once once it was loaded ahead", async () => {
    expect.hasAssertions();
    const Shown = ({ word }: { word: string }) => <p>{word}</p>;
    const load = vi.fn(async () => Shown);
    await preloadLazyPart(load);
    const Part = lazyPart(load);
    expect(lazyPart(load)).toBe(Part);
    const host = document.createElement("div");
    const root = createRoot(host);
    // One synchronous render, nothing awaited: a part that suspended would show its fallback here.
    act(() => root.render(<Suspense fallback={<p>waiting</p>}><Part word="there" /></Suspense>));
    expect(host.textContent).toBe("there");
    expect(load).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("shows a failed load at its boundary, and loads again when it mounts anew", async () => {
    expect.hasAssertions();
    const Shown = () => <p>loaded</p>;
    const load = vi.fn<() => Promise<typeof Shown>>().mockRejectedValueOnce(new Error("no chunk")).mockResolvedValueOnce(Shown);
    const Part = lazyPart(load);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const first = mount(<Catch><Suspense fallback={null}><Part /></Suspense></Catch>);
      await first.render();
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      await vi.waitFor(() => expect(first.host.querySelector('[data-testid="failed"]')).not.toBeNull());
      act(() => first.root.unmount());
      await new Promise((resolve) => setTimeout(resolve, FAILED_LOAD_HELD_MS + 50));
      const again = mount(<Catch><Suspense fallback={null}><Part /></Suspense></Catch>);
      await again.render();
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      await vi.waitFor(() => expect(again.host.textContent).toBe("loaded"));
      expect(load).toHaveBeenCalledTimes(2);
      act(() => again.root.unmount());
    } finally {
      spy.mockRestore();
    }
  });
});
