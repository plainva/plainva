// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePaneLayout } from "./usePaneLayout";
import { resetStartForTests, setStartView, START_VIEW_KEY } from "../services/startView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * "On start" on the desktop (plan 2026-11-05, P10): "Empty workspace" starts
 * the main window without its stored tabs — once, at the start. A vault opened
 * later reopens its tabs, an auxiliary window keeps its own, and what was
 * stored stays until the window changes.
 */
const A = "C:/Vaults/A";
const B = "C:/Vaults/B";
const stored = (path: string) => ({
  panes: [{ tabs: [{ history: [path], historyIndex: 0 }], activeIndex: 0 }],
  direction: "vertical",
  activePaneIndex: 0,
  splitRatio: 0.5,
});

type Seen = { tabs: number; ready: boolean };
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let seen: Seen = { tabs: -1, ready: false };

function Probe({ vaultPath, scope }: { vaultPath: string; scope?: string }) {
  const pane = usePaneLayout({ vaultPath, validatePath: async () => true, layoutScope: scope });
  const tabs = pane.layout.panes.reduce((n, p) => n + p.tabs.length, 0);
  useEffect(() => {
    seen = { tabs, ready: pane.layoutReady };
  });
  return null;
}

async function show(vaultPath: string, scope?: string) {
  if (!host) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => {
    root!.render(<StrictMode><Probe vaultPath={vaultPath} scope={scope} /></StrictMode>);
  });
  // The restore is async; let it land.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  resetStartForTests();
  localStorage.setItem(`plainva-layout-${A}`, JSON.stringify(stored("a.md")));
  localStorage.setItem(`plainva-layout-${B}`, JSON.stringify(stored("b.md")));
  localStorage.setItem(`plainva-layout-${A}-aux1`, JSON.stringify(stored("aux.md")));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  localStorage.clear();
});

describe("on start (P10)", () => {
  it("reopens the tabs by default", async () => {
    expect(localStorage.getItem(START_VIEW_KEY)).toBeNull();
    await show(A);
    expect(seen).toEqual({ tabs: 1, ready: true });
  });

  it("starts the main window empty once, even under StrictMode's second run", async () => {
    setStartView("fresh");
    await show(A);
    expect(seen).toEqual({ tabs: 0, ready: true });
    // The next vault in the same run is not the start: its tabs come back.
    await show(B);
    expect(seen).toEqual({ tabs: 1, ready: true });
  });

  it("leaves an auxiliary window its own tabs", async () => {
    setStartView("fresh");
    await show(A, "aux1");
    expect(seen.tabs).toBe(1);
  });

  it("leaves the stored tabs alone until something changes", async () => {
    setStartView("fresh");
    await show(A);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    // The empty start is not written over what was left: switching back to
    // "As you left it" before working reopens those tabs. The first change in
    // the window is saved as usual and becomes what was left.
    const saved = JSON.parse(localStorage.getItem(`plainva-layout-${A}`) ?? "null");
    expect(saved.panes.flatMap((p: { tabs: Array<{ history: string[] }> }) => p.tabs.map((t) => t.history[0]))).toEqual(["a.md"]);
  });
});
