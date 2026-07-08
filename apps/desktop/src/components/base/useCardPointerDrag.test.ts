import { describe, it, expect } from "vitest";
import { hitTest } from "./useCardPointerDrag";

const el = (left: number, top: number, right: number, bottom: number): HTMLElement =>
  ({ getBoundingClientRect: () => ({ left, top, right, bottom }) }) as unknown as HTMLElement;

describe("useCardPointerDrag hitTest", () => {
  it("returns the target whose rect contains the point", () => {
    const targets = new Map<string, HTMLElement>([
      ["a", el(0, 0, 100, 200)],
      ["b", el(110, 0, 210, 200)],
    ]);
    expect(hitTest(targets, 50, 50)).toBe("a");
    expect(hitTest(targets, 150, 199)).toBe("b");
    expect(hitTest(targets, 105, 50)).toBeNull();
    expect(hitTest(targets, 50, 250)).toBeNull();
  });

  it("treats rect edges as inside", () => {
    const targets = new Map<string, HTMLElement>([["a", el(10, 10, 20, 20)]]);
    expect(hitTest(targets, 10, 10)).toBe("a");
    expect(hitTest(targets, 20, 20)).toBe("a");
  });
});
