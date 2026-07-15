import { describe, it, expect } from "vitest";
import { findMatchesInText, replaceAllInText, buildSearchRegex } from "../src/vault/findReplace.ts";

describe("findMatchesInText", () => {
  const text = "alpha beta\nAlpha gamma\nbeta beta";
  it("finds all case-insensitive matches with 1-based line numbers and line context", () => {
    const m = findMatchesInText(text, "alpha");
    expect(m.map((x) => x.line)).toEqual([1, 2]);
    expect(m[1].lineText).toBe("Alpha gamma");
  });
  it("matchCase restricts to the exact case", () => {
    expect(findMatchesInText(text, "Alpha", { matchCase: true }).map((x) => x.line)).toEqual([2]);
  });
  it("wholeWord does not match substrings", () => {
    expect(findMatchesInText("category cat cats", "cat", { wholeWord: true })).toHaveLength(1);
  });
  it("regex mode matches patterns", () => {
    expect(findMatchesInText("a1 b2 c3", "\\w\\d", { regex: true })).toHaveLength(3);
  });
  it("skips zero-width matches without looping forever", () => {
    expect(findMatchesInText("abc", "x*", { regex: true })).toEqual([]);
  });
});

describe("replaceAllInText", () => {
  it("replaces literally and counts", () => {
    expect(replaceAllInText("cat cat dog", "cat", "fox")).toEqual({ content: "fox fox dog", count: 2 });
  });
  it("keeps a literal $ in the replacement literal", () => {
    expect(replaceAllInText("price X", "X", "$5").content).toBe("price $5");
  });
  it("regex mode supports $1 backreferences", () => {
    expect(replaceAllInText("2026-07", "(\\d{4})-(\\d{2})", "$2/$1", { regex: true }).content).toBe("07/2026");
  });
  it("returns unchanged when nothing matches", () => {
    expect(replaceAllInText("abc", "zzz", "!")).toEqual({ content: "abc", count: 0 });
  });
  it("an invalid regex is a no-op", () => {
    expect(buildSearchRegex("(", { regex: true })).toBeNull();
    expect(replaceAllInText("abc", "(", "!", { regex: true })).toEqual({ content: "abc", count: 0 });
  });
});
