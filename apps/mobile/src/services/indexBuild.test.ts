// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultQueryService } from "@plainva/core";
import { resetIndexBuildsForTests } from "@plainva/ui";
import { beginIndexBuild, indexBuildState, indexWholenessFor, isIndexBuilding, markIndexFailed, markIndexWhole, reportIndexBuild, subscribeIndexBuild } from "./indexBuild";

/**
 * The first index of a vault is built behind the open app (issue 143; every
 * vault since performance plan L3). What plans a write from the index — a
 * rename rewriting every link onto a note, a clean-up calling a note unlinked
 * — is refused until it is whole; everything else is told how far it has come.
 */
afterEach(() => resetIndexBuildsForTests());

describe("the index build of a vault", () => {
  it("is reported only for the vault whose build runs", () => {
    reportIndexBuild("v", 3, 10);
    expect(indexBuildState("v").kind).toBe("whole");
    beginIndexBuild("v");
    reportIndexBuild("other", 3, 10);
    expect(indexBuildState("v")).toEqual({ kind: "building", done: 0, total: 0 });
    reportIndexBuild("v", 3, 10);
    expect(indexBuildState("v")).toEqual({ kind: "building", done: 3, total: 10 });
    expect(isIndexBuilding("v")).toBe(true);
    expect(isIndexBuilding("other")).toBe(false);
    markIndexWhole("v");
    expect(isIndexBuilding("v")).toBe(false);
  });

  it("tells its listeners at most every 200 ms while files come in, and the last count always", async () => {
    vi.useFakeTimers();
    try {
      const heard = vi.fn();
      const off = subscribeIndexBuild(heard);
      beginIndexBuild("v");
      vi.advanceTimersByTime(300);
      heard.mockClear();
      for (let i = 1; i <= 50; i++) reportIndexBuild("v", i, 50);
      expect(heard).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(250);
      expect(heard).toHaveBeenCalledTimes(2);
      expect(indexBuildState("v")).toEqual({ kind: "building", done: 50, total: 50 });
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses what plans from the index until it is whole — after a failed build too", () => {
    const queryService = new VaultQueryService({} as never);
    queryService.setIndexWholeness(indexWholenessFor("v"));
    expect(() => queryService.requireWholeIndex()).not.toThrow();
    beginIndexBuild("v");
    expect(() => queryService.requireWholeIndex()).toThrow(/still being built/);
    markIndexFailed("v", "a folder could not be read");
    expect(() => queryService.requireWholeIndex()).toThrow(/incomplete/);
    markIndexWhole("v");
    expect(() => queryService.requireWholeIndex()).not.toThrow();
  });
});
