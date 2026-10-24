import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { forceFullParse } from "../test-parse";
import { visibleTagRanges } from "@plainva/ui";

/**
 * Which ranges the live editor marks as a tag pill (finding 2026-09-19). The
 * line rule is core's and has its own tests; this pins what only the editor can
 * know - the block a line sits in, the frontmatter, the text of a link.
 */
function ranges(lines: string[]): string[] {
  const state = forceFullParse(EditorState.create({ doc: lines.join("\n"), extensions: [markdown()] }));
  return visibleTagRanges(state, [{ from: 0, to: state.doc.length }]).map((tag) => `${state.sliceDoc(tag.from, tag.to)}=${tag.name}`);
}

describe("visibleTagRanges", () => {
  it("marks the tag with its #, in a paragraph, a heading, a list and a quote", () => {
    expect(ranges(["# Title #head", "", "Text #a/b here.", "", "- item #list", "", "> quote #quoted"])).toEqual(["#head=head", "#a/b=a/b", "#list=list", "#quoted=quoted"]);
  });

  it("leaves code alone - fenced, indented and inline", () => {
    expect(ranges(["```", "#fenced", "```", "", "    #indented", "", "and `#inline` but #real"])).toEqual(["#real=real"]);
  });

  it("leaves the text of a link alone: a pill there would be a click target inside a click target", () => {
    expect(ranges(["[see #inside](Other.md) and #outside"])).toEqual(["#outside=outside"]);
  });

  it("leaves the frontmatter alone", () => {
    const lines = ["---", "title: x", "note: about #yaml", "---", "body #body"];
    expect(ranges(lines)).toEqual(["#body=body"]);
  });

  // Where the frontmatter ends is the one definition's answer (finding
  // 2026-10-09): a fence with a blank behind it used to end nothing here, and
  // a `#` in the YAML below it became a pill.
  it("leaves the frontmatter alone in every form the definition reads as a block", () => {
    const MARK = String.fromCharCode(0xfeff);
    expect(ranges(["--- ", "note: about #yaml", "---\t", "body #body"])).toEqual(["#body=body"]);
    expect(ranges([`${MARK}---`, "note: about #yaml", "---", "body #body"])).toEqual(["#body=body"]);
    expect(ranges(["---", "", "---", "body #body"])).toEqual(["#body=body"]);
    // The empty block ends on its second line: a rule further down closes nothing.
    expect(ranges(["---", "---", "text #first", "", "---", "", "more #second"])).toEqual(["#first=first", "#second=second"]);
  });

  it("marks the tags of a note that only opens with a rule", () => {
    // No closing fence, no frontmatter.
    expect(ranges(["---", "", "text #first", "more #second"])).toEqual(["#first=first", "#second=second"]);
  });

  it("reads a line once although two visible ranges touch it", () => {
    const state = forceFullParse(EditorState.create({ doc: "one #a two #b", extensions: [markdown()] }));
    const tags = visibleTagRanges(state, [{ from: 0, to: 5 }, { from: 6, to: state.doc.length }]);
    expect(tags.map((tag) => tag.name)).toEqual(["a", "b"]);
  });
});
