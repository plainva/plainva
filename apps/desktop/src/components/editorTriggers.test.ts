import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { wikiLinkCompletionSource, tagCompletionSource, emojiColonCompletionSource } from "./editorTriggers";

function ctx(doc: string, pos = doc.length) {
  return new CompletionContext(EditorState.create({ doc }), pos, false);
}
const deps = (rows: any[], tags: { tag: string; count: number }[] = []) => ({
  getQueryService: () => ({ db: { query: async () => rows }, getAllTags: async () => tags }),
});

describe("wikiLinkCompletionSource", () => {
  it("searches notes after [[ and inserts [[Title]]", async () => {
    const src = wikiLinkCompletionSource(deps([{ path: "A/My Note.md", title: "My Note" }]));
    const res = await src(ctx("[[my"));
    expect(res).not.toBeNull();
    expect(res!.from).toBe(0);
    expect(res!.options[0].apply).toBe("[[My Note]]");
  });

  it("returns null without a preceding [[", async () => {
    const src = wikiLinkCompletionSource(deps([{ path: "A.md", title: "A" }]));
    expect(await src(ctx("hello"))).toBeNull();
  });
});

describe("tagCompletionSource", () => {
  it("suggests tags after #frag and inserts #tag", async () => {
    const src = tagCompletionSource(deps([], [{ tag: "work", count: 3 }, { tag: "home", count: 1 }]));
    const res = await src(ctx("#wo"));
    expect(res).not.toBeNull();
    expect(res!.options.map((o) => o.apply)).toEqual(["#work"]);
  });

  it("does not trigger on a bare # or an ATX heading", async () => {
    const src = tagCompletionSource(deps([], [{ tag: "work", count: 3 }]));
    expect(await src(ctx("#"))).toBeNull();
    expect(await src(ctx("# "))).toBeNull();
  });

  it("does not trigger inside a word", async () => {
    const src = tagCompletionSource(deps([], [{ tag: "work", count: 3 }]));
    expect(await src(ctx("a#work"))).toBeNull();
  });
});

describe("emojiColonCompletionSource", () => {
  const src = emojiColonCompletionSource();

  it("suggests emoji after :name and inserts the Unicode character (never a shortcode)", () => {
    const res = src(ctx("Nice :smile"));
    expect(res).not.toBeNull();
    expect(res!.from).toBe(5);
    expect(res!.options.length).toBeGreaterThan(0);
    const apply = res!.options[0].apply as string;
    expect(apply.includes(":")).toBe(false); // not a :shortcode:
    expect(apply.codePointAt(0)! > 127).toBe(true); // an actual emoji glyph, not ASCII
  });

  it("requires at least two name characters", () => {
    expect(src(ctx(":D"))).toBeNull();
    expect(src(ctx("hi :x"))).toBeNull();
  });

  it("does not trigger after a digit (times) or mid-word", () => {
    expect(src(ctx("10:30"))).toBeNull();
    expect(src(ctx("note:smile"))).toBeNull();
    expect(src(ctx("a:smile"))).toBeNull();
  });

  it("triggers at the start of a line", () => {
    expect(src(ctx(":smile"))).not.toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(src(ctx(":zzzzzz"))).toBeNull();
  });
});
