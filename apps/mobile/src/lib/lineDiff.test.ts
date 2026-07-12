import { describe, expect, it } from "vitest";
import { collapseContext, lineDiff, LINE_DIFF_CAP } from "@plainva/ui";

describe("lineDiff (M3E package G)", () => {
  it("marks added, removed and unchanged lines", () => {
    const a = "one\ntwo\nthree";
    const b = "one\ntwo!\nthree\nfour";
    expect(lineDiff(a, b)).toEqual([
      { type: "same", text: "one" },
      { type: "del", text: "two" },
      { type: "add", text: "two!" },
      { type: "same", text: "three" },
      { type: "add", text: "four" },
    ]);
  });

  it("treats identical inputs as all-same", () => {
    expect(lineDiff("a\nb", "a\nb")!.every((l) => l.type === "same")).toBe(true);
  });

  it("returns null above the cap", () => {
    const big = new Array(LINE_DIFF_CAP + 1).fill("x").join("\n");
    expect(lineDiff(big, "x")).toBeNull();
  });

  it("collapses long same runs to context", () => {
    const lines = lineDiff("1\n2\n3\n4\n5\n6\n7\n8\n9", "1\n2\n3\n4\n5\n6\n7\n8\nNINE")!;
    const collapsed = collapseContext(lines, 1);
    expect(collapsed[0]).toEqual({ type: "skip", count: 7 });
    expect(collapsed.slice(1)).toEqual([
      { type: "same", text: "8" },
      { type: "del", text: "9" },
      { type: "add", text: "NINE" },
    ]);
  });
});
