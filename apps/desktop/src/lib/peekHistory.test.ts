import { describe, it, expect } from "vitest";
import { peekInit, peekCurrent, canPeekBack, canPeekForward, peekBack, peekForward, peekPush } from "./peekHistory";

describe("peekHistory", () => {
  it("initializes with a single entry at the cursor", () => {
    const h = peekInit("a.md");
    expect(peekCurrent(h)).toBe("a.md");
    expect(canPeekBack(h)).toBe(false);
    expect(canPeekForward(h)).toBe(false);
  });

  it("pushes new entries and enables back", () => {
    let h = peekInit("a.md");
    h = peekPush(h, "b.md");
    expect(peekCurrent(h)).toBe("b.md");
    expect(canPeekBack(h)).toBe(true);
    expect(canPeekForward(h)).toBe(false);
  });

  it("back/forward move the cursor across the stack", () => {
    let h = peekPush(peekInit("a.md"), "b.md");
    h = peekBack(h);
    expect(peekCurrent(h)).toBe("a.md");
    expect(canPeekBack(h)).toBe(false);
    expect(canPeekForward(h)).toBe(true);
    h = peekForward(h);
    expect(peekCurrent(h)).toBe("b.md");
  });

  it("back/forward are no-ops at the ends (same reference)", () => {
    const h0 = peekInit("a.md");
    expect(peekBack(h0)).toBe(h0);
    const h1 = peekPush(h0, "b.md");
    expect(peekForward(h1)).toBe(h1);
  });

  it("re-pushing the current entry is a no-op", () => {
    const h = peekPush(peekInit("a.md"), "b.md");
    expect(peekPush(h, "b.md")).toBe(h);
  });

  it("pushing after going back truncates the forward tail", () => {
    let h = peekInit("a.md");
    h = peekPush(h, "b.md");
    h = peekPush(h, "c.md"); // a -> b -> c
    h = peekBack(h); // at b
    h = peekBack(h); // at a
    h = peekPush(h, "d.md"); // a -> d (b, c dropped)
    expect(h.stack).toEqual(["a.md", "d.md"]);
    expect(peekCurrent(h)).toBe("d.md");
    expect(canPeekForward(h)).toBe(false);
  });

  it("does not dedupe a non-current entry (revisiting a path is a real push)", () => {
    let h = peekPush(peekInit("a.md"), "b.md");
    h = peekPush(h, "a.md");
    expect(h.stack).toEqual(["a.md", "b.md", "a.md"]);
    expect(peekCurrent(h)).toBe("a.md");
  });
});
