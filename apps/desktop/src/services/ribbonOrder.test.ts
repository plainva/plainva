import { describe, it, expect } from "vitest";
import {
  applyRibbonOrder,
  DEFAULT_RIBBON_ORDER,
  moveRibbonAction,
  RIBBON_BOTTOM_IDS,
  RIBBON_TOP_IDS,
  sanitizeRibbonOrder,
} from "./ribbonOrder";

describe("sanitizeRibbonOrder", () => {
  it("falls back to the factory order for anything unusable", () => {
    expect(sanitizeRibbonOrder(undefined)).toEqual(DEFAULT_RIBBON_ORDER);
    expect(sanitizeRibbonOrder("nonsense")).toEqual(DEFAULT_RIBBON_ORDER);
    expect(sanitizeRibbonOrder({ top: "no" })).toEqual(DEFAULT_RIBBON_ORDER);
  });

  it("keeps the stored order and APPENDS actions the app has gained since", () => {
    // A user who sorted the rail in an older build must keep their order and
    // simply find the new action at the end — not have it reset.
    const stored = { top: ["palette", "new"], bottom: ["settings"] };
    const out = sanitizeRibbonOrder(stored);
    expect(out.top.slice(0, 2)).toEqual(["palette", "new"]);
    expect(out.top).toHaveLength(RIBBON_TOP_IDS.length);
    expect(new Set(out.top)).toEqual(new Set(RIBBON_TOP_IDS));
    expect(out.bottom).toEqual(["settings", "help"]);
    expect(out.bottom).toHaveLength(RIBBON_BOTTOM_IDS.length);
  });

  it("drops unknown and duplicated ids", () => {
    const out = sanitizeRibbonOrder({ top: ["new", "new", "gone", "open"], bottom: [] });
    expect(out.top.slice(0, 2)).toEqual(["new", "open"]);
    expect(out.top).toHaveLength(RIBBON_TOP_IDS.length);
    expect(out.top.includes("gone" as never)).toBe(false);
  });

  it("never loses an action — you cannot configure the rail empty (E3)", () => {
    const out = sanitizeRibbonOrder({ top: [], bottom: [] });
    expect(out.top).toEqual([...RIBBON_TOP_IDS]);
    expect(out.bottom).toEqual([...RIBBON_BOTTOM_IDS]);
  });
});

describe("moveRibbonAction", () => {
  const order = ["a", "b", "c", "d"];

  it("moves an entry to the requested slot", () => {
    expect(moveRibbonAction(order, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveRibbonAction(order, "a", 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("clamps out-of-range targets instead of dropping the entry", () => {
    expect(moveRibbonAction(order, "a", 99)).toEqual(["b", "c", "d", "a"]);
    expect(moveRibbonAction(order, "d", -5)).toEqual(["d", "a", "b", "c"]);
  });

  it("ignores an unknown id", () => {
    expect(moveRibbonAction(order, "zz", 0)).toBe(order);
  });
});

describe("applyRibbonOrder", () => {
  it("sorts the rendered actions by the stored order", () => {
    const actions = [{ key: "new" }, { key: "palette" }, { key: "open" }];
    expect(applyRibbonOrder(actions, ["palette", "open", "new"]).map((a) => a.key)).toEqual(["palette", "open", "new"]);
  });

  it("keeps a gated action's slot for the moment it appears", () => {
    // Calendar/mail only exist once a cloud service carries them. The order
    // lists them regardless, so they slot in where the user put them.
    const withoutMail = [{ key: "new" }, { key: "calendar" }];
    const withMail = [{ key: "new" }, { key: "calendar" }, { key: "mail" }];
    const order = ["calendar", "mail", "new"];
    expect(applyRibbonOrder(withoutMail, order).map((a) => a.key)).toEqual(["calendar", "new"]);
    expect(applyRibbonOrder(withMail, order).map((a) => a.key)).toEqual(["calendar", "mail", "new"]);
  });

  it("appends actions the order does not know rather than dropping them", () => {
    const actions = [{ key: "new" }, { key: "brandnew" }];
    expect(applyRibbonOrder(actions, ["new"]).map((a) => a.key)).toEqual(["new", "brandnew"]);
  });
});
