import { describe, it, expect, afterEach } from "vitest";
import {
  openInPane,
  focusOrOpenVirtualInLayout,
  navigateInPane,
  closeTabInPane,
  closeByPrefixInPane,
  renamePrefixInPane,
  normalizeLayout,
  moveTab,
  closeOtherTabs,
  closeTabsToLeft,
  closeTabsToRight,
  closeAllTabs,
  togglePinInPane,
  restoreLayout,
  type Layout,
  type Pane,
} from "./usePaneLayout";

const tab = (p: string) => ({ history: [p], historyIndex: 0 });
const pane = (paths: string[], activeIndex = 0): Pane => ({ tabs: paths.map(tab), activeIndex });
const layout = (panes: Pane[], activePaneIndex = 0): Layout => ({ panes, direction: "vertical", activePaneIndex });
const paths = (p: Pane) => p.tabs.map((t) => t.history[t.historyIndex]);

describe("openInPane", () => {
  it("appends a new tab when newTab is true", () => {
    const r = openInPane(pane(["a"]), "b", true);
    expect(paths(r)).toEqual(["a", "b"]);
    expect(r.activeIndex).toBe(1);
  });

  it("opens the first document into an empty pane", () => {
    const r = openInPane({ tabs: [], activeIndex: -1 }, "a", false);
    expect(paths(r)).toEqual(["a"]);
    expect(r.activeIndex).toBe(0);
  });

  it("is a no-op when the active tab already shows the path", () => {
    const p = pane(["a"]);
    expect(openInPane(p, "a", false)).toBe(p);
  });

  it("activates an existing tab instead of duplicating it", () => {
    const r = openInPane(pane(["a", "b"], 0), "b", false);
    expect(paths(r)).toEqual(["a", "b"]);
    expect(r.activeIndex).toBe(1);
  });

  it("pushes onto the active tab's history when navigating in place", () => {
    const r = openInPane(pane(["a"]), "b", false);
    expect(r.tabs[0].history).toEqual(["a", "b"]);
    expect(r.tabs[0].historyIndex).toBe(1);
  });
});

describe("navigateInPane", () => {
  it("moves back and forward within bounds", () => {
    const start: Pane = { tabs: [{ history: ["a", "b", "c"], historyIndex: 2 }], activeIndex: 0 };
    const back = navigateInPane(start, -1);
    expect(back.tabs[0].historyIndex).toBe(1);
    const fwd = navigateInPane(back, 1);
    expect(fwd.tabs[0].historyIndex).toBe(2);
  });

  it("clamps at the ends", () => {
    const p: Pane = { tabs: [{ history: ["a"], historyIndex: 0 }], activeIndex: 0 };
    expect(navigateInPane(p, -1)).toBe(p);
    expect(navigateInPane(p, 1)).toBe(p);
  });
});

describe("closeTabInPane", () => {
  it("removes the tab and keeps the active one when closing before it", () => {
    const r = closeTabInPane(pane(["a", "b", "c"], 2), 0);
    expect(paths(r)).toEqual(["b", "c"]);
    expect(r.activeIndex).toBe(1);
  });

  it("moves the active index left when closing the active tab", () => {
    const r = closeTabInPane(pane(["a", "b", "c"], 1), 1);
    expect(paths(r)).toEqual(["a", "c"]);
    expect(r.activeIndex).toBe(0);
  });

  it("empties the pane when the last tab closes", () => {
    const r = closeTabInPane(pane(["a"], 0), 0);
    expect(r.tabs).toEqual([]);
    expect(r.activeIndex).toBe(-1);
  });
});

describe("closeByPrefixInPane", () => {
  it("closes the folder itself and its children, keeping the rest", () => {
    const r = closeByPrefixInPane(pane(["notes/a", "notes", "other"], 0), "notes");
    expect(paths(r)).toEqual(["other"]);
    expect(r.activeIndex).toBe(0);
  });

  it("does not close a sibling with a shared prefix substring", () => {
    const r = closeByPrefixInPane(pane(["notes-archive/a", "notes/b"], 0), "notes");
    expect(paths(r)).toEqual(["notes-archive/a"]);
  });
});

describe("renamePrefixInPane", () => {
  it("renames the exact path and its children across the history", () => {
    const start: Pane = { tabs: [{ history: ["old/a", "old"], historyIndex: 0 }], activeIndex: 0 };
    const r = renamePrefixInPane(start, "old", "new");
    expect(r.tabs[0].history).toEqual(["new/a", "new"]);
  });

  it("returns the same pane when nothing matches", () => {
    const p = pane(["keep/a"]);
    expect(renamePrefixInPane(p, "old", "new")).toBe(p);
  });
});

describe("normalizeLayout", () => {
  it("drops an emptied pane and remaps the focused index", () => {
    const r = normalizeLayout(layout([pane([], -1), pane(["c"], 0)], 1));
    expect(r.panes).toHaveLength(1);
    expect(paths(r.panes[0])).toEqual(["c"]);
    expect(r.activePaneIndex).toBe(0);
  });

  it("keeps a single pane untouched", () => {
    const l = layout([pane(["a"], 0)], 0);
    expect(normalizeLayout(l)).toBe(l);
  });
});

describe("moveTab", () => {
  it("moves a tab to the end of the other pane and focuses it", () => {
    const r = moveTab(layout([pane(["a", "b"], 0), pane(["c"], 0)], 0), 0, 0, 1, null);
    expect(paths(r.panes[0])).toEqual(["b"]);
    expect(paths(r.panes[1])).toEqual(["c", "a"]);
    expect(r.panes[1].activeIndex).toBe(1);
    expect(r.activePaneIndex).toBe(1);
  });

  it("collapses the split when the source pane empties", () => {
    const r = moveTab(layout([pane(["a"], 0), pane(["c"], 0)], 0), 0, 0, 1, null);
    expect(r.panes).toHaveLength(1);
    expect(paths(r.panes[0])).toEqual(["c", "a"]);
    expect(r.activePaneIndex).toBe(0);
  });

  it("reorders within a pane, compensating for the removal shift", () => {
    const r = moveTab(layout([pane(["a", "b", "c"], 0)], 0), 0, 0, 0, 3);
    expect(paths(r.panes[0])).toEqual(["b", "c", "a"]);
    expect(r.panes[0].activeIndex).toBe(2);
  });

  it("is a no-op when dropped onto its own position", () => {
    const l = layout([pane(["a", "b", "c"], 0)], 0);
    expect(moveTab(l, 0, 1, 0, 1)).toBe(l);
    expect(moveTab(l, 0, 1, 0, 2)).toBe(l);
  });

  it("ignores an out-of-range source", () => {
    const l = layout([pane(["a"], 0)], 0);
    expect(moveTab(l, 0, 5, 0, 0)).toBe(l);
  });
});

describe("focusOrOpenVirtualInLayout (ribbon/palette singleton tabs)", () => {
  const V = "plainva://calendar";

  it("opens a fresh tab in the focused pane when not open anywhere", () => {
    const r = focusOrOpenVirtualInLayout(layout([pane(["a", "b"], 0)], 0), V);
    expect(paths(r.panes[0])).toEqual(["a", "b", V]);
    expect(r.panes[0].activeIndex).toBe(2);
    expect(r.activePaneIndex).toBe(0);
  });

  it("focuses the existing tab instead of duplicating it (same pane)", () => {
    const r = focusOrOpenVirtualInLayout(layout([pane([V, "a"], 1)], 0), V);
    expect(paths(r.panes[0])).toEqual([V, "a"]);
    expect(r.panes[0].activeIndex).toBe(0);
  });

  it("switches to the other pane when the tab lives there", () => {
    const l = layout([pane(["a"], 0), pane(["b", V], 0)], 0);
    const r = focusOrOpenVirtualInLayout(l, V);
    expect(r.activePaneIndex).toBe(1);
    expect(r.panes[1].activeIndex).toBe(1);
    expect(r.panes.flatMap(paths).filter((p) => p === V)).toHaveLength(1);
  });
});

/**
 * P2 — the browser-style mass-close family. The single rule that makes pinning
 * worth having: a pinned tab survives every one of them. (Renaming/deleting a
 * file still closes its tab — the file is gone, a pinned dead tab helps nobody;
 * that path is closeByPrefixInPane above.)
 */
describe("mass close (P2)", () => {
  const pinned = (p: string) => ({ history: [p], historyIndex: 0, pinned: true });

  it("closes every other tab but keeps pinned ones", () => {
    const src: Pane = { tabs: [pinned("Daily.md"), tab("A.md"), tab("B.md"), tab("C.md")], activeIndex: 2 };
    const out = closeOtherTabs(src, 2);
    expect(paths(out)).toEqual(["Daily.md", "B.md"]);
    // The right-clicked tab stays active.
    expect(paths(out)[out.activeIndex]).toBe("B.md");
  });

  it("closes to the left and to the right, pinned tabs excepted", () => {
    const src: Pane = { tabs: [pinned("Daily.md"), tab("A.md"), tab("B.md"), tab("C.md")], activeIndex: 0 };
    expect(paths(closeTabsToLeft(src, 2))).toEqual(["Daily.md", "B.md", "C.md"]);
    expect(paths(closeTabsToRight(src, 2))).toEqual(["Daily.md", "A.md", "B.md"]);
  });

  it("closes everything except pinned tabs", () => {
    const src: Pane = { tabs: [pinned("Daily.md"), tab("A.md"), tab("B.md")], activeIndex: 1 };
    const out = closeAllTabs(src);
    expect(paths(out)).toEqual(["Daily.md"]);
    expect(out.activeIndex).toBe(0);
  });

  it("leaves the pane untouched when there is nothing to close", () => {
    const src: Pane = { tabs: [tab("A.md")], activeIndex: 0 };
    expect(closeOtherTabs(src, 0)).toBe(src);
    expect(closeTabsToLeft(src, 0)).toBe(src);
  });
});

describe("togglePinInPane (P2)", () => {
  it("moves a newly pinned tab to the left block and keeps the active tab", () => {
    const src: Pane = { tabs: [tab("A.md"), tab("B.md"), tab("C.md")], activeIndex: 0 };
    const out = togglePinInPane(src, 2);
    expect(paths(out)).toEqual(["C.md", "A.md", "B.md"]);
    expect(out.tabs[0].pinned).toBe(true);
    // "A.md" was active before and still is — the index followed the tab.
    expect(paths(out)[out.activeIndex]).toBe("A.md");
  });

  it("appends to the END of the pinned block, so pin order is stable", () => {
    const src: Pane = {
      tabs: [{ history: ["P1.md"], historyIndex: 0, pinned: true }, tab("A.md"), tab("B.md")],
      activeIndex: 0,
    };
    expect(paths(togglePinInPane(src, 2))).toEqual(["P1.md", "B.md", "A.md"]);
  });

  it("unpinning drops the tab in front of the unpinned block", () => {
    const src: Pane = {
      tabs: [
        { history: ["P1.md"], historyIndex: 0, pinned: true },
        { history: ["P2.md"], historyIndex: 0, pinned: true },
        tab("A.md"),
      ],
      activeIndex: 2,
    };
    const out = togglePinInPane(src, 0);
    expect(paths(out)).toEqual(["P2.md", "P1.md", "A.md"]);
    expect(out.tabs[1].pinned).toBe(false);
    expect(paths(out)[out.activeIndex]).toBe("A.md");
  });

  it("ignores an out-of-range index", () => {
    const src: Pane = { tabs: [tab("A.md")], activeIndex: 0 };
    expect(togglePinInPane(src, 5)).toBe(src);
  });
});

describe("a pinned tab is never overwritten (report 2026-07-29)", () => {
  const pinnedPane = (paths: string[], pinnedAt: number, activeIndex = pinnedAt): Pane => ({
    tabs: paths.map((p, i) => (i === pinnedAt ? { history: [p], historyIndex: 0, pinned: true } : tab(p))),
    activeIndex,
  });

  it("opens a fresh tab and moves the focus there", () => {
    const out = openInPane(pinnedPane(["P.md"], 0), "B.md", false);
    expect(paths(out)).toEqual(["P.md", "B.md"]);
    expect(out.activeIndex).toBe(1);
    // The pinned tab still shows what it showed, with no history pushed onto it.
    expect(out.tabs[0].history).toEqual(["P.md"]);
    expect(out.tabs[0].pinned).toBe(true);
  });

  it("still focuses an existing tab instead of opening a second copy", () => {
    const out = openInPane(pinnedPane(["P.md", "B.md"], 0), "B.md", false);
    expect(paths(out)).toEqual(["P.md", "B.md"]);
    expect(out.activeIndex).toBe(1);
  });

  it("is a no-op when the pinned tab already shows that path", () => {
    const src = pinnedPane(["P.md"], 0);
    expect(openInPane(src, "P.md", false)).toBe(src);
  });

  it("leaves the unpinned case alone: the path goes into the active tab's history", () => {
    const out = openInPane(pane(["A.md"]), "B.md", false);
    expect(paths(out)).toEqual(["B.md"]);
    expect(out.tabs[0].history).toEqual(["A.md", "B.md"]);
  });
});

describe("restoreLayout (what survives a restart)", () => {
  const VAULT = "C:/Vaults/Demo";
  const write = (snapshot: unknown) => localStorage.setItem(`plainva-layout-${VAULT}`, JSON.stringify(snapshot));
  const snapshot = (tabs: unknown[]) => ({
    panes: [{ tabs, activeIndex: 0 }],
    direction: "vertical",
    activePaneIndex: 0,
    splitRatio: 0.5,
  });

  afterEach(() => localStorage.clear());

  it("keeps the pin", async () => {
    write(snapshot([{ history: ["P.md"], historyIndex: 0, pinned: true }, tab("A.md")]));
    const out = await restoreLayout(VAULT, async () => true);
    expect(out?.layout.panes[0].tabs[0].pinned).toBe(true);
    expect(out?.layout.panes[0].tabs[1].pinned).toBeUndefined();
  });

  it("keeps a virtual view without asking the vault whether it exists", async () => {
    write(snapshot([tab("plainva://calendar"), tab("A.md")]));
    const asked: string[] = [];
    const out = await restoreLayout(VAULT, async (p) => {
      asked.push(p);
      return p.endsWith(".md");
    });
    expect(out?.layout.panes[0].tabs.map((t) => t.history[0])).toEqual(["plainva://calendar", "A.md"]);
    expect(asked).toEqual(["A.md"]); // the pseudo path was never looked up
  });

  it("still drops a tab whose file is gone", async () => {
    write(snapshot([tab("A.md"), tab("Weg.md")]));
    const out = await restoreLayout(VAULT, async (p) => p === "A.md");
    expect(out?.layout.panes[0].tabs.map((t) => t.history[0])).toEqual(["A.md"]);
  });

  it("drops the stale back/forward stack of a surviving tab", async () => {
    write(snapshot([{ history: ["A.md", "B.md"], historyIndex: 1 }]));
    const out = await restoreLayout(VAULT, async () => true);
    expect(out?.layout.panes[0].tabs[0]).toEqual({ history: ["B.md"], historyIndex: 0 });
  });

  it("returns null when there is no snapshot", async () => {
    expect(await restoreLayout(VAULT, async () => true)).toBeNull();
  });
});

describe("layout scope (multi-window P4)", () => {
  const VAULT = "C:/Vaults/Demo";
  const snapshot = (paths: string[]) => ({
    panes: [{ tabs: paths.map(tab), activeIndex: 0 }],
    direction: "vertical",
    activePaneIndex: 0,
    splitRatio: 0.5,
  });

  afterEach(() => localStorage.clear());

  it("gives every window its own tabs", async () => {
    // Two windows on one vault must not fight over one key: opening a note in
    // an auxiliary window would otherwise rewrite the central window's tab bar.
    localStorage.setItem(`plainva-layout-${VAULT}`, JSON.stringify(snapshot(["Central.md"])));
    localStorage.setItem(`plainva-layout-${VAULT}-aux-1`, JSON.stringify(snapshot(["Aux.md"])));

    const central = await restoreLayout(VAULT, async () => true);
    const aux = await restoreLayout(VAULT, async () => true, "aux-1");

    expect(central?.layout.panes[0].tabs.map((t) => t.history[0])).toEqual(["Central.md"]);
    expect(aux?.layout.panes[0].tabs.map((t) => t.history[0])).toEqual(["Aux.md"]);
  });

  it("leaves the central window on the key it has always used", async () => {
    // The scope was added in an update, so the unscoped key is what an existing
    // installation carries. Renaming it would silently discard the arrangement
    // the user had open — the update itself would look like data loss.
    localStorage.setItem(`plainva-layout-${VAULT}`, JSON.stringify(snapshot(["Existing.md"])));

    const out = await restoreLayout(VAULT, async () => true, null);

    expect(out?.layout.panes[0].tabs.map((t) => t.history[0])).toEqual(["Existing.md"]);
  });

  it("has nothing to restore for a window that never saved anything", async () => {
    localStorage.setItem(`plainva-layout-${VAULT}`, JSON.stringify(snapshot(["Central.md"])));

    // A fresh auxiliary window starts empty and is then seeded with the content
    // it was opened for — it must not inherit the central window's tabs.
    expect(await restoreLayout(VAULT, async () => true, "aux-9")).toBeNull();
  });
});
