import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { atMentionCompletionSource } from "./AtMentionPlugin";

function ctx(doc: string, pos = doc.length) {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, false);
}

const mockQS = (rows: any[]) => ({ getQueryService: () => ({ db: { query: async () => rows } }) });

describe("atMentionCompletionSource", () => {
  it("offers the four date entries for a bare @", async () => {
    const src = atMentionCompletionSource(mockQS([]));
    const res = await src(ctx("@"));
    expect(res).not.toBeNull();
    const dateOpts = res!.options.filter((o) => o.type === "date");
    expect(dateOpts.length).toBe(4); // today / tomorrow / yesterday / pick
    const fixed = dateOpts.filter((o) => typeof o.apply === "string");
    expect(fixed.length).toBe(3);
    expect(fixed[0].apply).toMatch(/^@\d{4}-\d{2}-\d{2}$/); // dynamic @date token
  });

  it("maps note rows to [[wikilink]] completions", async () => {
    const src = atMentionCompletionSource(mockQS([{ path: "Folder/My Note.md", title: "My Note" }]));
    const res = await src(ctx("@my"));
    const note = res!.options.find((o) => o.type === "wikilink");
    expect(note).toBeTruthy();
    expect(note!.apply).toBe("[[My Note]]");
    expect(res!.from).toBe(0); // replaces from the @
  });

  it("falls back to the basename when a note has no title", async () => {
    const src = atMentionCompletionSource(mockQS([{ path: "Notes/Idea.md", title: "" }]));
    const res = await src(ctx("@idea"));
    const note = res!.options.find((o) => o.type === "wikilink");
    expect(note!.apply).toBe("[[Idea]]");
  });

  it("does not trigger inside an email address", async () => {
    const src = atMentionCompletionSource(mockQS([]));
    expect(await src(ctx("foo@bar"))).toBeNull();
  });

  it("returns null when there is no @ before the cursor", async () => {
    const src = atMentionCompletionSource(mockQS([]));
    expect(await src(ctx("hello world"))).toBeNull();
  });

  it("triggers after whitespace", async () => {
    const src = atMentionCompletionSource(mockQS([]));
    const res = await src(ctx("see @"));
    expect(res).not.toBeNull();
  });
});
