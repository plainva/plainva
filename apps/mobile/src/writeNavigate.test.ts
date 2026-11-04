import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "ios" } }));

import { backStops, initialNavState, pushEntry, type NavState } from "./navigation";
import { navMotion } from "./lib/navMotion";
import { edgeSwipeCommits } from "./lib/useEdgeSwipeBack";
import { BACK_EDGE_PX, startsInBackEdge } from "./lib/gestureConstants";

/** Wishes of 2026-10-25 and feedback of 2026-10-28 (W5, F5, F6): the pure parts. */
describe("holding Back (F6)", () => {
  const deep = (): NavState => {
    let s = initialNavState("notes");
    s = pushEntry(s, { kind: "folder", path: "Projekte" });
    s = pushEntry(s, { kind: "note", path: "Projekte/Plan.md" });
    s = pushEntry(s, { kind: "note", path: "Projekte/Protokoll.md" });
    return s;
  };
  it("lists the tab's root first, then the screens below this one, newest first", () => {
    const stops = backStops(deep());
    expect(stops.map((stop) => stop.entry?.path ?? "root")).toEqual(["root", "Projekte/Plan.md", "Projekte"]);
  });
  it("jumps by dropping everything above the chosen place", () => {
    const [root, plan] = backStops(deep());
    expect(root.next.stacks.notes).toEqual([]);
    expect(plan.next.stacks.notes.map((e) => e.path)).toEqual(["Projekte", "Projekte/Plan.md"]);
  });
  it("has nothing on a tab root, and stops at eight", () => {
    expect(backStops(initialNavState("notes"))).toEqual([]);
    let s = initialNavState("notes");
    for (let i = 0; i < 12; i += 1) s = pushEntry(s, { kind: "note", path: `N${i}.md` });
    expect(backStops(s)).toHaveLength(9); // root + eight
  });
});

describe("slides (F5) and the edge (W5)", () => {
  it("slides in on a push, back on a pop, not on a tab switch", () => {
    expect(navMotion(1, 2)).toBe("push");
    expect(navMotion(2, 1)).toBe("pop");
    expect(navMotion(1, 1)).toBe("none");
  });
  it("goes back past a third of the width or with a flick, never on a short drag", () => {
    expect(edgeSwipeCommits(140, 375, 0.1)).toBe(true);
    expect(edgeSwipeCommits(60, 375, 0.1)).toBe(false);
    expect(edgeSwipeCommits(60, 375, 0.9)).toBe(true);
    expect(edgeSwipeCommits(12, 375, 2)).toBe(false);
    expect(edgeSwipeCommits(-40, 375, 1)).toBe(false);
  });
  it("leaves the left edge to back on the phone", () => {
    expect(startsInBackEdge(BACK_EDGE_PX - 1)).toBe(true);
    expect(startsInBackEdge(BACK_EDGE_PX + 1)).toBe(false);
    expect(startsInBackEdge(30, 20)).toBe(true);
  });
});
