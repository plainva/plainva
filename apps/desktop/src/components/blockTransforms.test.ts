import { describe, it, expect } from "vitest";
import { stripMarker, turnInto, moveBlockAbove, listMarkerStyle, LIST_SEPARATOR } from "./blockTransforms";

describe("stripMarker", () => {
  it("removes heading, quote, bullet, numbered and task markers", () => {
    expect(stripMarker("## Title")).toBe("Title");
    expect(stripMarker("> quote")).toBe("quote");
    expect(stripMarker("- item")).toBe("item");
    expect(stripMarker("3. item")).toBe("item");
    expect(stripMarker("- [ ] todo")).toBe("todo");
    expect(stripMarker("  - nested")).toBe("  nested");
    expect(stripMarker("plain")).toBe("plain");
  });
});

describe("turnInto", () => {
  it("converts to a heading (first line) and strips the old marker", () => {
    expect(turnInto("- hello", "h2")).toBe("## hello");
  });
  it("converts a paragraph to a bullet / numbered / task / quote", () => {
    expect(turnInto("a\nb", "bullet")).toBe("- a\n- b");
    expect(turnInto("a\nb", "numbered")).toBe("1. a\n2. b");
    expect(turnInto("a\nb", "task")).toBe("- [ ] a\n- [ ] b");
    expect(turnInto("a\nb", "quote")).toBe("> a\n> b");
  });
  it("wraps a block in a code fence", () => {
    expect(turnInto("x\ny", "code")).toBe("```\nx\ny\n```");
  });
  it("converts back to a plain paragraph", () => {
    expect(turnInto("## Title", "paragraph")).toBe("Title");
    expect(turnInto("- [ ] todo", "paragraph")).toBe("todo");
  });
  it("re-converts without stacking markers", () => {
    expect(turnInto(turnInto("# H", "bullet"), "quote")).toBe("> H");
  });
});

describe("moveBlockAbove", () => {
  it("moves a later block above an earlier one (drag up)", () => {
    // lines: 1 A, 2 "", 3 B, 4 "", 5 C  -> move C (5) above A (1)
    expect(moveBlockAbove("A\n\nB\n\nC", 5, 5, 1)).toBe("C\n\nA\n\nB\n");
  });
  it("moves an earlier block down, keeping blank separators", () => {
    // move A (1) above C (5) -> B, A, C
    expect(moveBlockAbove("A\n\nB\n\nC", 1, 1, 5)).toBe("B\n\nA\n\nC");
  });
  it("appends when the target is past the end", () => {
    expect(moveBlockAbove("A\n\nB", 1, 1, 99)).toBe("B\n\nA\n");
  });
  it("is a no-op for an invalid source range", () => {
    expect(moveBlockAbove("A\n\nB", 5, 5, 1)).toBe("A\n\nB");
  });
});

describe("listMarkerStyle", () => {
  it("returns the bullet char or the ordered delimiter", () => {
    expect(listMarkerStyle("- a")).toBe("-");
    expect(listMarkerStyle("* a")).toBe("*");
    expect(listMarkerStyle("+ a")).toBe("+");
    expect(listMarkerStyle("  - nested")).toBe("-");
    expect(listMarkerStyle("- [ ] task")).toBe("-");
    expect(listMarkerStyle("1. a")).toBe(".");
    expect(listMarkerStyle("42) a")).toBe(")");
  });
  it("returns null for non-list lines", () => {
    expect(listMarkerStyle("text")).toBeNull();
    expect(listMarkerStyle("# heading")).toBeNull();
    expect(listMarkerStyle("> quote")).toBeNull();
    expect(listMarkerStyle("10.5 ist eine Zahl")).toBeNull();
    expect(listMarkerStyle("")).toBeNull();
  });
});

describe("moveBlockAbove with list guards (E2: invisible separator)", () => {
  it("guards below: a separator lands between the moved list and the same-style list under it", () => {
    // move "1. a" above "1. x" — without the guard CommonMark would merge them.
    expect(moveBlockAbove("1. a\n\n# H\n\n1. x", 1, 1, 5, { guardBelow: true })).toBe(
      `# H\n\n1. a\n\n${LIST_SEPARATOR}\n\n1. x`
    );
  });
  it("guards above: a separator lands between the same-style list above and the moved list", () => {
    // move "1. x" above "# H"; "1. a" sits directly above the drop position.
    expect(moveBlockAbove("1. a\n\n# H\n\n1. x", 5, 5, 3, { guardAbove: true })).toBe(
      `1. a\n\n${LIST_SEPARATOR}\n\n1. x\n\n# H\n`
    );
  });
  it("guards both sides when the moved list lands between two same-style lists", () => {
    expect(moveBlockAbove("- a\n\n- b\n\n- c", 5, 5, 3, { guardAbove: true, guardBelow: true })).toBe(
      `- a\n\n${LIST_SEPARATOR}\n\n- c\n\n${LIST_SEPARATOR}\n\n- b\n`
    );
  });
  it("does not duplicate an existing separator at the boundary", () => {
    const doc = `- a\n\n${LIST_SEPARATOR}\n\n- b\n\n- x`;
    expect(moveBlockAbove(doc, 7, 7, 5, { guardAbove: true, guardBelow: true })).toBe(
      `- a\n\n${LIST_SEPARATOR}\n\n- x\n\n${LIST_SEPARATOR}\n\n- b\n`
    );
  });
  it("keeps the classic behavior when no guards are requested (different styles)", () => {
    expect(moveBlockAbove("- a\n\n* b\n\n* c", 5, 5, 1)).toBe("* c\n\n- a\n\n* b\n");
  });
});
