// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  applyClickSelection,
  checkboxSelectionMode,
  clickSelectionMode,
  pruneSelection,
  useRowSelection,
  type SelectionRow,
} from "@plainva/ui";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rows = (...paths: string[]): SelectionRow[] => paths.map((path) => ({ path }));

describe("pruneSelection", () => {
  it("drops paths that left the result set", () => {
    const out = pruneSelection(new Set(["a.md", "b.md", "gone.md"]), rows("a.md", "b.md"));
    expect([...out].sort()).toEqual(["a.md", "b.md"]);
  });

  it("keeps a selection whose rows merely reordered", () => {
    const out = pruneSelection(new Set(["a.md", "b.md"]), rows("b.md", "c.md", "a.md"));
    expect(out.size).toBe(2);
  });

  it("returns the same empty set instead of allocating", () => {
    const empty = new Set<string>();
    expect(pruneSelection(empty, rows("a.md"))).toBe(empty);
  });
});

describe("useRowSelection", () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof useRowSelection>;

  function Probe({ resetKey, list }: { resetKey: string; list: SelectionRow[] }) {
    api = useRowSelection(resetKey, list);
    return <output>{[...api.selection].sort().join(",")}</output>;
  }

  const shown = () => container.querySelector("output")?.textContent ?? "";
  const render = (resetKey: string, list: SelectionRow[]) =>
    act(() => { root.render(<Probe resetKey={resetKey} list={list} />); });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("toggles rows and reports whether anything is selected", () => {
    const list = rows("a.md", "b.md", "c.md");
    render("k1", list);
    expect(api.active).toBe(false);
    act(() => api.toggle("b.md"));
    expect(shown()).toBe("b.md");
    expect(api.active).toBe(true);
    act(() => api.toggle("b.md"));
    expect(shown()).toBe("");
  });

  it("selects a range from the anchor and honours the platform modifier", () => {
    const list = rows("a.md", "b.md", "c.md", "d.md");
    render("k1", list);
    act(() => api.click("a.md", list, "single"));
    act(() => api.click("c.md", list, "range"));
    expect(shown()).toBe("a.md,b.md,c.md");
    // macOS Ctrl+click belongs to the context menu (Issue #13) — it must not move
    // the selection, so the reducer never sees anything for it.
    act(() => api.click("d.md", list, "none"));
    expect(shown()).toBe("a.md,b.md,c.md");
  });

  it("toggleAll selects every row, then clears when all are already selected", () => {
    const list = rows("a.md", "b.md");
    render("k1", list);
    act(() => api.toggleAll(list));
    expect(shown()).toBe("a.md,b.md");
    act(() => api.toggleAll(list));
    expect(shown()).toBe("");
  });

  /**
   * The contract that keeps a bulk action honest. A selection made under one
   * filter must not survive into another view, where the same rows may not even
   * be shown — otherwise "delete selected" hits what the person cannot see.
   */
  it("drops the whole selection when the view changes", () => {
    const list = rows("a.md", "b.md");
    render("k1", list);
    act(() => api.toggleAll(list));
    expect(shown()).toBe("a.md,b.md");
    render("k2", list);
    expect(shown()).toBe("");
  });

  /**
   * The other half of that contract: row churn inside the SAME view prunes but
   * never resets. Setting a value on several rows requeries them; clearing the
   * selection there would make every second bulk edit start from scratch.
   */
  it("prunes vanished rows without clearing the rest", () => {
    render("k1", rows("a.md", "b.md", "c.md"));
    act(() => api.toggleAll(rows("a.md", "b.md")));
    expect(shown()).toBe("a.md,b.md");
    render("k1", rows("a.md", "c.md"));
    expect(shown()).toBe("a.md");
  });
});

describe("checkboxSelectionMode (finding 2026-09-03: a ticked box unticks on click)", () => {
  const ev = (o: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }>) =>
    ({ shiftKey: false, ctrlKey: false, metaKey: false, ...o });

  it("reads a plain click as toggle, never as a single-select", () => {
    expect(checkboxSelectionMode(ev({}), false)).toBe("toggle");
    expect(checkboxSelectionMode(ev({}), true)).toBe("toggle");
    expect(checkboxSelectionMode(ev({ ctrlKey: true }), false)).toBe("toggle");
    expect(checkboxSelectionMode(ev({ metaKey: true }), true)).toBe("toggle");
  });

  it("keeps Shift as the range gesture and macOS Ctrl-click as the context menu", () => {
    expect(checkboxSelectionMode(ev({ shiftKey: true }), false)).toBe("range");
    expect(checkboxSelectionMode(ev({ ctrlKey: true }), true)).toBe("none");
  });

  it("a second click on the same box clears the selection through the reducer", () => {
    const first = applyClickSelection(new Set(), null, rows("a.md", "b.md"), "a.md", checkboxSelectionMode(ev({}), false) as "toggle");
    expect([...first.selection]).toEqual(["a.md"]);
    const second = applyClickSelection(first.selection, first.anchor, rows("a.md", "b.md"), "a.md", checkboxSelectionMode(ev({}), false) as "toggle");
    expect(second.selection.size).toBe(0);
  });
});

describe("clickSelectionMode (shared, unchanged by the lift)", () => {
  const ev = (o: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }>) =>
    ({ shiftKey: false, ctrlKey: false, metaKey: false, ...o });

  it("reads Ctrl as the multi-select modifier off macOS and as nothing on it", () => {
    expect(clickSelectionMode(ev({ ctrlKey: true }), false)).toBe("toggle");
    expect(clickSelectionMode(ev({ ctrlKey: true }), true)).toBe("none");
    expect(clickSelectionMode(ev({ metaKey: true }), true)).toBe("toggle");
  });

  it("falls back to a plain click when the anchor is unknown", () => {
    const r = applyClickSelection(new Set(["x"]), "missing.md", rows("a.md"), "a.md", "range");
    expect([...r.selection]).toEqual(["a.md"]);
    expect(r.anchor).toBe("a.md");
  });
});
