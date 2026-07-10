import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { isListMarkerLine, listIndentStyle, listDepthAt } from "@plainva/ui";

describe("isListMarkerLine", () => {
  it("recognizes bullet and ordered markers, nested or not", () => {
    expect(isListMarkerLine("- item")).toBe(true);
    expect(isListMarkerLine("* item")).toBe(true);
    expect(isListMarkerLine("+ item")).toBe(true);
    expect(isListMarkerLine("  - nested")).toBe(true);
    expect(isListMarkerLine("1. item")).toBe(true);
    expect(isListMarkerLine("    10) item")).toBe(true);
  });

  it("rejects plain text and marks without a following space", () => {
    expect(isListMarkerLine("just text")).toBe(false);
    expect(isListMarkerLine("-nospace")).toBe(false);
    expect(isListMarkerLine("# Heading")).toBe(false);
    expect(isListMarkerLine("")).toBe(false);
  });
});

describe("listIndentStyle", () => {
  it("returns null when not inside a list", () => {
    expect(listIndentStyle(0, true)).toBeNull();
    expect(listIndentStyle(-1, false)).toBeNull();
  });

  it("gives marker lines a hanging indent (negative text-indent), one level in from body", () => {
    expect(listIndentStyle(1, true)).toBe("padding-left:3em;text-indent:-1.5em;");
    expect(listIndentStyle(2, true)).toBe("padding-left:4.5em;text-indent:-1.5em;");
  });

  it("gives continuation lines only the block padding", () => {
    expect(listIndentStyle(1, false)).toBe("padding-left:3em;");
    expect(listIndentStyle(3, false)).toBe("padding-left:6em;");
  });
});

describe("listDepthAt", () => {
  const stateFor = (doc: string) => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  // First non-whitespace position of a 1-based line number.
  const firstNonWs = (state: EditorState, lineNo: number) => {
    const line = state.doc.line(lineNo);
    return line.from + (line.text.length - line.text.trimStart().length);
  };

  it("reports nesting depth from real list structure", () => {
    const state = stateFor("- a\n  - b\n    - c\n- d\n");
    expect(listDepthAt(state, firstNonWs(state, 1))).toBe(1); // - a
    expect(listDepthAt(state, firstNonWs(state, 2))).toBe(2); //   - b
    expect(listDepthAt(state, firstNonWs(state, 3))).toBe(3); //     - c
    expect(listDepthAt(state, firstNonWs(state, 4))).toBe(1); // - d
  });

  it("does not treat list-looking lines inside a code fence as a list", () => {
    const state = stateFor("- real\n\n```\n- fake\n```\n");
    expect(listDepthAt(state, firstNonWs(state, 1))).toBe(1); // - real
    expect(listDepthAt(state, firstNonWs(state, 4))).toBe(0); // - fake (in fence)
  });

  it("reports depth 0 for ordinary paragraphs", () => {
    const state = stateFor("just a paragraph\n");
    expect(listDepthAt(state, firstNonWs(state, 1))).toBe(0);
  });
});
