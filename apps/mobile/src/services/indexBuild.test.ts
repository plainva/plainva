// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { toastStore } from "@plainva/ui";
import { awaitWholeIndex, beginIndexBuild, endIndexBuild, getIndexBuild, isIndexBuilding, reportIndexBuild, subscribeIndexBuild } from "./indexBuild";

/**
 * The first index of a folder vault is built behind the open app (issue 143).
 * What needs the WHOLE index — a rename rewriting every link onto a note, a
 * clean-up calling a note unlinked — waits for it; everything else is told how
 * far it has come.
 */
afterEach(() => {
  endIndexBuild("v");
  endIndexBuild("other");
});

describe("the first index of a vault", () => {
  it("is reported only for the vault whose first build runs", () => {
    reportIndexBuild("v", 3, 10);
    expect(getIndexBuild()).toBeNull();
    beginIndexBuild("v");
    reportIndexBuild("other", 3, 10);
    expect(getIndexBuild()).toEqual({ vaultId: "v", done: 0, total: 0 });
    reportIndexBuild("v", 3, 10);
    expect(getIndexBuild()).toEqual({ vaultId: "v", done: 3, total: 10 });
    expect(isIndexBuilding("v")).toBe(true);
    expect(isIndexBuilding("other")).toBe(false);
    endIndexBuild("v");
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
      expect(getIndexBuild()?.done).toBe(50);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds back what needs the whole index until the build is through, and says so once", async () => {
    let finish: () => void = () => {};
    const whole = new Promise<void>((resolve) => { finish = resolve; });
    const vault = { vaultId: "v", whenIndexWhole: () => whole };
    const shown = toastStore.get().length;
    beginIndexBuild("v");
    let through = false;
    const waiting = awaitWholeIndex(vault).then(() => { through = true; });
    await Promise.resolve();
    expect(through).toBe(false);
    expect(toastStore.get().length).toBe(shown + 1);
    finish();
    endIndexBuild("v");
    await waiting;
    expect(through).toBe(true);
  });

  it("does not hold back anything in a vault whose index is there", async () => {
    const vault = { vaultId: "v", whenIndexWhole: () => new Promise<void>(() => {}) };
    await expect(awaitWholeIndex(vault)).resolves.toBeUndefined();
  });
});
