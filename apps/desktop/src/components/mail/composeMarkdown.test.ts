import { describe, it, expect } from "vitest";
import {
  toggleWrap,
  toggleLinePrefix,
  insertBlock,
  insertLink,
  applyComposeCommand,
  detectSlash,
  filterCommands,
  COMPOSE_COMMANDS,
} from "./composeMarkdown";

describe("composeMarkdown", () => {
  it("wraps a selection and places the caret inside the markers", () => {
    const r = toggleWrap("hello world", 6, 11, "**");
    expect(r.value).toBe("hello **world**");
    expect(r.value.slice(r.selStart, r.selEnd)).toBe("world");
  });

  it("unwraps a selection that already carries the marker inside", () => {
    const r = toggleWrap("hello **world**", 6, 15, "**");
    expect(r.value).toBe("hello world");
    expect(r.value.slice(r.selStart, r.selEnd)).toBe("world");
  });

  it("unwraps when the markers sit just outside the selection", () => {
    const r = toggleWrap("hello **world**", 8, 13, "**");
    expect(r.value).toBe("hello world");
  });

  it("wraps an empty selection with an empty placeholder between markers", () => {
    const r = toggleWrap("ab", 1, 1, "*");
    expect(r.value).toBe("a**b"); // a + * + '' + * + b
    expect(r.selStart).toBe(2);
    expect(r.selEnd).toBe(2);
  });

  it("adds and removes a line prefix across the touched lines", () => {
    const add = toggleLinePrefix("one\ntwo", 0, 7, "- ");
    expect(add.value).toBe("- one\n- two");
    const remove = toggleLinePrefix(add.value, 0, add.value.length, "- ");
    expect(remove.value).toBe("one\ntwo");
  });

  it("replaces an existing heading level (headings are exclusive)", () => {
    const r = toggleLinePrefix("# Title", 0, 7, "## ");
    expect(r.value).toBe("## Title");
  });

  it("inserts a block on its own line, padded", () => {
    const r = insertBlock("text", 4, 4, "---");
    expect(r.value).toBe("text\n---");
  });

  it("inserts a link and selects the url placeholder", () => {
    const r = insertLink("see here", 4, 8);
    expect(r.value).toBe("see [here](url)");
    expect(r.value.slice(r.selStart, r.selEnd)).toBe("url");
  });

  it("dispatches every command id without throwing", () => {
    for (const cmd of COMPOSE_COMMANDS) {
      const r = applyComposeCommand(cmd.id, "sample text", 0, 6);
      expect(typeof r.value).toBe("string");
      expect(r.value.length).toBeGreaterThan(0);
    }
  });

  describe("detectSlash", () => {
    it("triggers at line start", () => {
      expect(detectSlash("/", 1)).toEqual({ from: 0, query: "" });
      expect(detectSlash("/bo", 3)).toEqual({ from: 0, query: "bo" });
    });
    it("triggers after a space or newline", () => {
      expect(detectSlash("a /h", 4)).toEqual({ from: 2, query: "h" });
      expect(detectSlash("line\n/q", 7)).toEqual({ from: 5, query: "q" });
    });
    it("does NOT trigger mid-word (e.g. a URL path)", () => {
      expect(detectSlash("http://x", 8)).toBeNull();
    });
  });

  it("filters commands by keyword", () => {
    expect(filterCommands("bold").some((c) => c.id === "bold")).toBe(true);
    expect(filterCommands("liste").some((c) => c.id === "numbered")).toBe(true);
    expect(filterCommands("zzz")).toHaveLength(0);
    expect(filterCommands("")).toHaveLength(COMPOSE_COMMANDS.length);
  });
});
