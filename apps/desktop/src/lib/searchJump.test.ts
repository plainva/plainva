// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  consumePendingSearchJump,
  findFirstMatch,
  findTextRange,
  selectAndRevealRange,
  setPendingSearchJump,
} from "@plainva/ui";

describe("pending search jump store", () => {
  it("hands the jump out exactly once, and only for the matching path", () => {
    setPendingSearchJump({ path: "a/b.md", term: "foo" });
    expect(consumePendingSearchJump("x.md")).toBeNull();
    expect(consumePendingSearchJump(null)).toBeNull();
    expect(consumePendingSearchJump("a/b.md")).toEqual({ path: "a/b.md", term: "foo" });
    expect(consumePendingSearchJump("a/b.md")).toBeNull(); // one-shot
  });

  it("lets a newer click replace a stale parked jump", () => {
    setPendingSearchJump({ path: "a.md", term: "alt" });
    setPendingSearchJump({ path: "b.md", term: "neu" });
    expect(consumePendingSearchJump("a.md")).toBeNull();
    expect(consumePendingSearchJump("b.md")).toEqual({ path: "b.md", term: "neu" });
  });
});

describe("findFirstMatch", () => {
  it("finds the first occurrence case-insensitively", () => {
    expect(findFirstMatch("Der Projektplan im PROJEKTPLAN", "projektplan")).toEqual({ from: 4, to: 15 });
  });

  it("returns null for misses and empty terms", () => {
    expect(findFirstMatch("abc", "xyz")).toBeNull();
    expect(findFirstMatch("abc", "")).toBeNull();
  });
});

describe("findTextRange", () => {
  it("finds a term inside nested inline elements", () => {
    document.body.innerHTML = "<p>Hallo <strong>Projektplan</strong> heute</p>";
    const range = findTextRange(document.body, "projektplan");
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("Projektplan");
  });

  it("returns null when the term spans formatting boundaries (documented limit)", () => {
    document.body.innerHTML = "<p><em>Projekt</em>plan</p>";
    expect(findTextRange(document.body, "projektplan")).toBeNull();
  });

  it("returns null for empty terms and empty roots", () => {
    document.body.innerHTML = "";
    expect(findTextRange(document.body, "x")).toBeNull();
    document.body.innerHTML = "<p>x</p>";
    expect(findTextRange(document.body, "")).toBeNull();
  });
});

describe("selectAndRevealRange", () => {
  it("applies the native selection to the match (jsdom has no scrollIntoView)", () => {
    document.body.innerHTML = "<p>Hallo Projektplan heute</p>";
    const range = findTextRange(document.body, "Projektplan");
    expect(range).not.toBeNull();
    selectAndRevealRange(range!);
    const sel = window.getSelection();
    expect(sel?.rangeCount).toBe(1);
    expect(sel?.getRangeAt(0).toString()).toBe("Projektplan");
  });
});
