import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { forceFullParse } from "../test-parse";
import { isListMarkerLine, listIndentStyle, listDepthAt, listMarkerPrefixLength, listItemAt, bulletGlyphForDepth } from "@plainva/ui";

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

  it("falls back to an em hanging indent before the first measurement, half a step in from body", () => {
    expect(listIndentStyle(1, true)).toBe("padding-left:2.25em;text-indent:-1em;");
    expect(listIndentStyle(2, true)).toBe("padding-left:3.75em;text-indent:-1em;");
  });

  it("gives continuation lines only the block padding", () => {
    expect(listIndentStyle(1, false)).toBe("padding-left:2.25em;");
    expect(listIndentStyle(3, false)).toBe("padding-left:5.25em;");
  });

  it("uses the MEASURED prefix as the hanging indent and never lets it leave the line box", () => {
    // The marker line pulls its first row back by exactly its rendered prefix...
    expect(listIndentStyle(1, true, { own: 21.3, item: 21.3 })).toBe("padding-left:max(2.25em,25.5px);text-indent:-21.5px;");
    // ...a continuation line is padded to the same edge and hangs by its OWN
    // leading whitespace, so its text lands under the item text...
    expect(listIndentStyle(1, false, { own: 9, item: 21.3 })).toBe("padding-left:max(2.25em,25.5px);text-indent:-9px;");
    expect(listIndentStyle(1, false, { own: 0, item: 21.3 })).toBe("padding-left:max(2.25em,25.5px);");
    // ...and a wide prefix (two tabs + `10.`) still gets a gutter in front of it.
    expect(listIndentStyle(3, true, { own: 120, item: 120 })).toBe("padding-left:max(5.25em,124px);text-indent:-120px;");
  });
});

describe("listMarkerPrefixLength", () => {
  it("counts leading whitespace, the marker and its space — and a task box", () => {
    expect(listMarkerPrefixLength("- item")).toBe(2);
    expect(listMarkerPrefixLength("		* item")).toBe(4);
    expect(listMarkerPrefixLength("    10. item")).toBe(8);
    expect(listMarkerPrefixLength("- [ ] task")).toBe(6);
    expect(listMarkerPrefixLength("- [x] done")).toBe(6);
    expect(listMarkerPrefixLength("plain")).toBeNull();
  });
});

describe("bulletGlyphForDepth", () => {
  it("cycles disc, circle, square by level", () => {
    expect(bulletGlyphForDepth(1)).toBe("•");
    expect(bulletGlyphForDepth(2)).toBe("◦");
    expect(bulletGlyphForDepth(3)).toBe("▪");
    expect(bulletGlyphForDepth(4)).toBe("•");
    expect(bulletGlyphForDepth(0)).toBe("•");
  });
});

describe("listDepthAt", () => {
  const stateFor = (doc: string) => {
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
    // Lezer parses markdown asynchronously; under full-suite parallel load the
    // background parse can trail the deeper list lines, so listDepthAt would read
    // an incomplete tree and report 0. Force a complete parse up front to keep the
    // depth assertions deterministic (mirrors editorSession.test.ts).
    forceFullParse(state);
    return state;
  };
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
