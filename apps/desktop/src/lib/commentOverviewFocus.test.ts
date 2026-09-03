// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { COMMENT_OVERVIEW_FOCUS_EVENT, requestCommentOverviewFocus, resetCommentOverviewFocusForTest, takeCommentOverviewFocus } from "@plainva/ui";

/**
 * A gathered notification opens the overview on what it announced (C30). The
 * request is parked like the single-comment jump: made before the surface
 * exists on a cold start, taken once by whoever renders next.
 */
describe("comment overview focus", () => {
  afterEach(() => resetCommentOverviewFocusForTest());

  it("parks the announced ids until the overview takes them, once", () => {
    expect(takeCommentOverviewFocus()).toBeNull();
    requestCommentOverviewFocus(["c1", "c2", "c1"]);
    const set = takeCommentOverviewFocus();
    expect(set && [...set].sort()).toEqual(["c1", "c2"]);
    expect(takeCommentOverviewFocus()).toBeNull();
  });

  it("treats an empty request as no narrowing and tells a mounted overview", () => {
    const heard: unknown[] = [];
    const listener = (e: Event) => heard.push((e as CustomEvent).detail);
    window.addEventListener(COMMENT_OVERVIEW_FOCUS_EVENT, listener);
    try {
      requestCommentOverviewFocus([]);
      expect(takeCommentOverviewFocus()).toBeNull();
      requestCommentOverviewFocus(["x"]);
      expect(heard).toHaveLength(2);
      expect(heard[0]).toBeNull();
      expect([...(heard[1] as Set<string>)]).toEqual(["x"]);
    } finally {
      window.removeEventListener(COMMENT_OVERVIEW_FOCUS_EVENT, listener);
    }
  });
});
