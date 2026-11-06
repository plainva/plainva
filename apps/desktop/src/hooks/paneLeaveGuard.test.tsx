// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { registerDiscardQuestion, useDiscardGuard } from "@plainva/ui";
import { desktopDiscardHost } from "../services/discardQuestion";
import { holdWindowClose, resetWindowCloseGuardForTest } from "../services/windowCloseGuard";
import { lostPaths, usePaneLayout, type Layout } from "./usePaneLayout";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * An unsent comment is asked about when the pane that shows its note closes or
 * shows another note (data-safety D5) - not only when the window closes. The
 * check sits in `usePaneLayout`, around the mutators, so no caller can forget it.
 */
const VAULT = "C:/Vaults/Guard";
type Api = ReturnType<typeof usePaneLayout>;
let api: Api;
let answer: boolean;
let asked: Array<{ message: string; title?: string; keep?: string }>;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** A comment being written for `path`, held exactly as the comments column holds it. */
function Draft({ path }: { path: string }) {
  useDiscardGuard(true, () => {}, `Your comment on ${path} has not been sent yet.`, { path, wording: { title: "Discard comment?", keepLabel: "Keep writing" } });
  return null;
}
function Probe() {
  const value = usePaneLayout({ vaultPath: VAULT, validatePath: async () => true });
  useEffect(() => { api = value; });
  return null;
}

async function mount(drafts: string[]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<><Probe />{drafts.map((path) => <Draft key={path} path={path} />)}</>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  // The guard loads lazily; let its hold land.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const paths = () => api.layout.panes.map((pane) => pane.tabs.map((tab) => tab.history[tab.historyIndex]));
const act2 = async (work: () => void) => { await act(async () => { work(); await new Promise((resolve) => setTimeout(resolve, 0)); }); };

beforeEach(() => {
  answer = false;
  asked = [];
  resetWindowCloseGuardForTest();
  registerDiscardQuestion({
    ask: async (message, wording) => { asked.push({ message, title: wording?.title, keep: wording?.keepLabel }); return answer; },
    hold: (question, scope) => holdWindowClose(question, scope?.path),
  });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null; host = null;
  localStorage.clear();
  resetWindowCloseGuardForTest();
  registerDiscardQuestion(desktopDiscardHost);
});

describe("a comment being written stays with its note", () => {
  it("changes nothing for a window without a held comment: no question, same turn", async () => {
    await mount([]);
    await act2(() => api.openInFocusedPane("a.md"));
    act(() => api.closeTab(0, 0));
    expect(asked).toEqual([]);
    expect(paths()).toEqual([[]]);
  });

  it("closing the tab asks; 'Keep writing' keeps the tab, 'Discard' closes it", async () => {
    await mount(["a.md"]);
    await act2(() => api.openInFocusedPane("a.md"));
    await act2(() => api.closeTab(0, 0));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ title: "Discard comment?", keep: "Keep writing" });
    expect(paths()).toEqual([["a.md"]]);
    answer = true;
    await act2(() => api.closeTab(0, 0));
    expect(asked).toHaveLength(2);
    expect(paths()).toEqual([[]]);
  });

  it("another note in the same tab asks, and so does a new tab (the pane stops showing the note)", async () => {
    await mount(["a.md"]);
    await act2(() => api.openInFocusedPane("a.md"));
    await act2(() => api.openInFocusedPane("c.md"));
    expect(asked).toHaveLength(1);
    expect(paths()).toEqual([["a.md"]]);
    await act2(() => api.openInFocusedPane("b.md", true));
    expect(asked).toHaveLength(2);
    expect(paths()).toEqual([["a.md"]]);
    answer = true;
    await act2(() => api.openInFocusedPane("b.md", true));
    expect(paths()).toEqual([["a.md", "b.md"]]);
    expect(api.activePath).toBe("b.md");
    // Coming back to the note the comment belongs to takes nothing out of the pane that is held.
    asked.length = 0;
    await act2(() => api.selectTab(0, 0));
    expect(asked).toEqual([]);
    expect(api.activePath).toBe("a.md");
  });

  it("back and forward over the note the comment belongs to ask", async () => {
    await mount(["b.md"]);
    await act2(() => api.openInFocusedPane("a.md"));
    await act2(() => api.openInFocusedPane("b.md"));
    expect(asked).toHaveLength(0);
    await act2(() => api.navigateTab(0, -1));
    expect(asked).toHaveLength(1);
    expect(paths()).toEqual([["b.md"]]);
    answer = true;
    await act2(() => api.navigateTab(0, -1));
    expect(api.activePath).toBe("a.md");
  });

  it("switching to another tab, closing several tabs and moving the tab ask too", async () => {
    await mount(["a.md"]);
    await act2(() => api.openInFocusedPane("a.md"));
    answer = true;
    await act2(() => api.openInFocusedPane("b.md", true));
    await act2(() => api.selectTab(0, 0));
    answer = false;
    asked.length = 0;
    await act2(() => api.selectTab(0, 1));
    expect(asked).toHaveLength(1);
    expect(api.activePath).toBe("a.md");
    await act2(() => api.closeTabsBulk(0, 0, "all"));
    expect(asked).toHaveLength(2);
    expect(paths()).toEqual([["a.md", "b.md"]]);
    // Moving the tab into a new pane remounts its editor: the comment would go.
    await act2(() => api.splitEditorWithTab("vertical", 0, 0));
    expect(asked).toHaveLength(3);
    expect(api.layout.panes).toHaveLength(1);
    answer = true;
    await act2(() => api.closeTabsBulk(0, 0, "all"));
    expect(paths()).toEqual([[]]);
  });

  it("a switch in another pane does not ask", async () => {
    await mount(["a.md"]);
    await act2(() => api.openInFocusedPane("a.md"));
    await act2(() => api.openPathInSplit("b.md", "vertical"));
    expect(paths()).toEqual([["a.md"], ["b.md"]]);
    await act2(() => api.openInFocusedPane("c.md"));
    expect(paths()).toEqual([["a.md"], ["b.md", "c.md"].slice(1)]);
    await act2(() => api.closeTab(1, 0));
    expect(asked).toEqual([]);
    expect(paths()).toEqual([["a.md"]]);
  });

  it("deleting or renaming a note closes its tab without asking", async () => {
    await mount(["a.md"]);
    await act2(() => api.openInFocusedPane("a.md"));
    await act2(() => api.closeTabsByPrefix("a.md"));
    expect(asked).toEqual([]);
    expect(paths()).toEqual([[]]);
  });

  it("the comment of another note does not hold this note's pane", async () => {
    await mount(["other.md"]);
    await act2(() => api.openInFocusedPane("a.md"));
    await act2(() => api.closeTab(0, 0));
    expect(asked).toEqual([]);
  });
});

describe("lostPaths", () => {
  const layout = (...panes: string[][]): Layout => ({
    direction: "vertical",
    activePaneIndex: 0,
    panes: panes.map((tabs) => ({ tabs: tabs.map((path) => ({ history: [path], historyIndex: 0 })), activeIndex: tabs.length ? 0 : -1 })),
  });
  it("names the note a pane stops showing, also when it only moves to another pane", () => {
    expect(lostPaths(layout(["a.md"]), layout(["b.md"]))).toEqual(["a.md"]);
    expect(lostPaths(layout(["a.md"]), layout([]))).toEqual(["a.md"]);
    expect(lostPaths(layout(["a.md"], ["b.md"]), layout(["b.md"]))).toEqual(["a.md", "b.md"]);
    expect(lostPaths(layout(["a.md"], ["b.md"]), layout(["a.md"], ["c.md"]))).toEqual(["b.md"]);
    expect(lostPaths(layout(["a.md"]), layout(["a.md"]))).toEqual([]);
  });
});

void vi;
