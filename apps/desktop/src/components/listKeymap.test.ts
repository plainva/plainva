import { describe, it, expect } from "vitest";
import { parseListLine, continueList } from "@plainva/ui";

describe("parseListLine", () => {
  it("parses unordered items", () => {
    expect(parseListLine("- hello")).toMatchObject({ marker: "-", ordered: false, task: false, content: "hello" });
    expect(parseListLine("  * nested")).toMatchObject({ indent: "  ", marker: "*", ordered: false, content: "nested" });
  });

  it("parses task items", () => {
    expect(parseListLine("- [ ] todo")).toMatchObject({ task: true, checked: false, content: "todo" });
    expect(parseListLine("- [x] done")).toMatchObject({ task: true, checked: true, content: "done" });
  });

  it("parses ordered items with . and )", () => {
    expect(parseListLine("3. third")).toMatchObject({ ordered: true, marker: "3.", num: 3, content: "third" });
    expect(parseListLine("10) tenth")).toMatchObject({ ordered: true, marker: "10)", num: 10, content: "tenth" });
  });

  it("returns null for non-list lines", () => {
    expect(parseListLine("plain text")).toBeNull();
    expect(parseListLine("# heading")).toBeNull();
    expect(parseListLine("")).toBeNull();
  });
});

describe("continueList", () => {
  it("continues an unordered item", () => {
    expect(continueList(parseListLine("- a")!)).toEqual({ exit: false, insert: "\n- " });
  });

  it("continues a nested item keeping the indent", () => {
    expect(continueList(parseListLine("  - a")!)).toEqual({ exit: false, insert: "\n  - " });
  });

  it("continues a task item with an unchecked box", () => {
    expect(continueList(parseListLine("- [x] done")!)).toEqual({ exit: false, insert: "\n- [ ] " });
  });

  it("increments an ordered item and keeps the separator", () => {
    expect(continueList(parseListLine("3. third")!)).toEqual({ exit: false, insert: "\n4. " });
    expect(continueList(parseListLine("3) third")!)).toEqual({ exit: false, insert: "\n4) " });
  });

  it("exits the list on an empty item", () => {
    expect(continueList(parseListLine("- ")!)).toEqual({ exit: true, insert: "" });
    expect(continueList(parseListLine("2. ")!)).toEqual({ exit: true, insert: "" });
  });
});
