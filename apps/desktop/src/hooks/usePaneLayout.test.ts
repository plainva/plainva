import { describe, it, expect } from "vitest";
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
