import { describe, it, expect } from "vitest";
import {
  sanitizeAreaOrder,
  visibleAreas,
  hiddenAreas,
  isAreaVisible,
  moveArea,
  setAreaVisible,
  setVisibleCount,
  applyAreaOrder,
  sameAreaOrder,
  resolveAreaOrder,
  type AreaOrderSpec,
} from "@plainva/ui";

const RAIL: AreaOrderSpec = {
  known: ["new", "open", "daily", "graph", "tasks"],
  defaultVisibleCount: 5,
};

const LEFT_TABS: AreaOrderSpec = {
  known: ["files", "tags", "databases"],
  alwaysVisible: ["files"],
  defaultVisibleCount: 3,
};

const MOBILE_BAR: AreaOrderSpec = {
  known: ["notes", "today", "tags", "bookmarks", "calendar"],
  minVisible: 3,
  maxVisible: 5,
  defaultVisibleCount: 3,
};

describe("sanitizeAreaOrder", () => {
  it("falls back to the factory order with everything visible", () => {
    const v = sanitizeAreaOrder(undefined, RAIL);
    expect(v.order).toEqual(["new", "open", "daily", "graph", "tasks"]);
    expect(v.visibleCount).toBe(5);
  });

  it("keeps a stored order, drops unknown ids and appends new ones", () => {
    // "chat" never existed, "daily" is missing — the app has gained "tasks".
    const v = sanitizeAreaOrder({ order: ["graph", "chat", "open"], visibleCount: 2 }, RAIL);
    expect(v.order).toEqual(["graph", "open", "new", "daily", "tasks"]);
    expect(v.visibleCount).toBe(2);
  });

  it("drops duplicates", () => {
    const v = sanitizeAreaOrder({ order: ["open", "open", "new"], visibleCount: 5 }, RAIL);
    expect(v.order.filter((id) => id === "open")).toHaveLength(1);
  });

  it("reads a bare array (legacy shape) and shows everything", () => {
    const v = sanitizeAreaOrder(["graph", "new"], RAIL);
    expect(v.order.slice(0, 2)).toEqual(["graph", "new"]);
    expect(v.visibleCount).toBe(5);
  });

  it("pulls pinned ids into the visible part even if they were stored below", () => {
    const v = sanitizeAreaOrder({ order: ["tags", "databases", "files"], visibleCount: 1 }, LEFT_TABS);
    expect(v.order[0]).toBe("files");
    expect(isAreaVisible(v, "files")).toBe(true);
  });

  it("clamps the count into the configured bounds", () => {
    expect(sanitizeAreaOrder({ order: [], visibleCount: 99 }, MOBILE_BAR).visibleCount).toBe(5);
    expect(sanitizeAreaOrder({ order: [], visibleCount: 1 }, MOBILE_BAR).visibleCount).toBe(3);
    expect(sanitizeAreaOrder({ order: [], visibleCount: Number.NaN }, MOBILE_BAR).visibleCount).toBe(3);
  });
});

describe("visible / hidden split", () => {
  it("splits at the line", () => {
    const v = sanitizeAreaOrder({ order: ["new", "open", "daily", "graph", "tasks"], visibleCount: 2 }, RAIL);
    expect(visibleAreas(v)).toEqual(["new", "open"]);
    expect(hiddenAreas(v)).toEqual(["daily", "graph", "tasks"]);
  });
});

describe("moveArea", () => {
  it("moves within the visible part without changing visibility", () => {
    const v = sanitizeAreaOrder({ order: ["new", "open", "daily"], visibleCount: 3 }, RAIL);
    const moved = moveArea(v, "daily", 0, RAIL);
    expect(moved.order.slice(0, 3)).toEqual(["daily", "new", "open"]);
    expect(moved.visibleCount).toBe(3);
  });

  it("hides an entry when it is dragged below the line", () => {
    const v = sanitizeAreaOrder({ order: ["new", "open", "daily", "graph", "tasks"], visibleCount: 2 }, RAIL);
    const moved = moveArea(v, "new", 4, RAIL);
    expect(isAreaVisible(moved, "new")).toBe(false);
    expect(visibleAreas(moved)).toEqual(["open", "daily"]);
  });

  it("shows an entry when it is dragged above the line", () => {
    const v = sanitizeAreaOrder({ order: ["new", "open", "daily", "graph", "tasks"], visibleCount: 2 }, RAIL);
    const moved = moveArea(v, "tasks", 0, RAIL);
    expect(isAreaVisible(moved, "tasks")).toBe(true);
    expect(visibleAreas(moved)).toEqual(["tasks", "new"]);
  });

  it("never lets a pinned id fall below the line", () => {
    const v = sanitizeAreaOrder({ order: ["files", "tags", "databases"], visibleCount: 2 }, LEFT_TABS);
    const moved = moveArea(v, "files", 2, LEFT_TABS);
    expect(isAreaVisible(moved, "files")).toBe(true);
  });

  it("never lets another id jump in front of a pinned one", () => {
    const v = sanitizeAreaOrder({ order: ["files", "tags", "databases"], visibleCount: 3 }, LEFT_TABS);
    const moved = moveArea(v, "databases", 0, LEFT_TABS);
    expect(moved.order[0]).toBe("files");
    expect(moved.order[1]).toBe("databases");
  });

  it("ignores an unknown id", () => {
    const v = sanitizeAreaOrder(undefined, RAIL);
    expect(moveArea(v, "nope", 0, RAIL)).toBe(v);
  });
});

describe("setAreaVisible", () => {
  it("hides and reshows an entry, keeping the neighbours in order", () => {
    const v = sanitizeAreaOrder({ order: ["new", "open", "daily", "graph", "tasks"], visibleCount: 5 }, RAIL);
    const hidden = setAreaVisible(v, "open", false, RAIL);
    expect(visibleAreas(hidden)).toEqual(["new", "daily", "graph", "tasks"]);
    expect(hiddenAreas(hidden)).toEqual(["open"]);

    const shown = setAreaVisible(hidden, "open", true, RAIL);
    expect(isAreaVisible(shown, "open")).toBe(true);
    expect(shown.visibleCount).toBe(5);
  });

  it("refuses to hide a pinned id", () => {
    const v = sanitizeAreaOrder(undefined, LEFT_TABS);
    expect(setAreaVisible(v, "files", false, LEFT_TABS)).toBe(v);
  });

  it("is a no-op when the entry is already in the requested state", () => {
    const v = sanitizeAreaOrder(undefined, RAIL);
    expect(setAreaVisible(v, "new", true, RAIL)).toBe(v);
  });

  it("respects the lower bound of the mobile bar", () => {
    const v = sanitizeAreaOrder({ order: ["notes", "today", "tags", "bookmarks", "calendar"], visibleCount: 3 }, MOBILE_BAR);
    const next = setAreaVisible(v, "tags", false, MOBILE_BAR);
    expect(next.visibleCount).toBe(3);
  });
});

describe("setVisibleCount", () => {
  it("clamps to the bounds", () => {
    const v = sanitizeAreaOrder(undefined, MOBILE_BAR);
    expect(setVisibleCount(v, 9, MOBILE_BAR).visibleCount).toBe(5);
    expect(setVisibleCount(v, 0, MOBILE_BAR).visibleCount).toBe(3);
  });
});

describe("applyAreaOrder", () => {
  it("sorts what exists and drops the hidden", () => {
    const v = sanitizeAreaOrder({ order: ["tasks", "new", "open", "daily", "graph"], visibleCount: 2 }, RAIL);
    const items = [{ key: "new" }, { key: "tasks" }, { key: "daily" }];
    expect(applyAreaOrder(items, v, (i) => i.key)).toEqual([{ key: "tasks" }, { key: "new" }]);
  });

  it("keeps the slot of an entry that is currently absent", () => {
    // "calendar" is gated on a connected service and simply not in the list today.
    const spec: AreaOrderSpec = { known: ["new", "calendar", "open"], defaultVisibleCount: 3 };
    const v = sanitizeAreaOrder({ order: ["new", "calendar", "open"], visibleCount: 3 }, spec);
    expect(applyAreaOrder([{ key: "open" }, { key: "new" }], v, (i) => i.key)).toEqual([{ key: "new" }, { key: "open" }]);
  });
});

describe("resolveAreaOrder (inheritance)", () => {
  const globalDefault = { order: ["graph", "new", "open", "daily", "tasks"], visibleCount: 3 };

  it("follows the global default while the vault has no value of its own", () => {
    const v = resolveAreaOrder(undefined, globalDefault, RAIL);
    expect(v.order[0]).toBe("graph");
    expect(v.visibleCount).toBe(3);
  });

  it("lets a vault value win once it exists", () => {
    const v = resolveAreaOrder({ order: ["tasks"], visibleCount: 1 }, globalDefault, RAIL);
    expect(v.order[0]).toBe("tasks");
    expect(v.visibleCount).toBe(1);
  });

  it("falls back to the factory order when neither exists", () => {
    expect(resolveAreaOrder(undefined, undefined, RAIL).order).toEqual(RAIL.known);
  });

  it("treats a malformed vault value as 'no value of its own'", () => {
    expect(resolveAreaOrder({ nonsense: true }, globalDefault, RAIL).order[0]).toBe("graph");
  });
});

describe("sameAreaOrder", () => {
  it("compares order and line", () => {
    const a = sanitizeAreaOrder({ order: ["new", "open"], visibleCount: 1 }, RAIL);
    const b = sanitizeAreaOrder({ order: ["new", "open"], visibleCount: 1 }, RAIL);
    const c = sanitizeAreaOrder({ order: ["new", "open"], visibleCount: 2 }, RAIL);
    expect(sameAreaOrder(a, b)).toBe(true);
    expect(sameAreaOrder(a, c)).toBe(false);
  });
});
