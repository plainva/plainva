import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext, Completion } from "@codemirror/autocomplete";
import { closersToConsume, wikiLinkCompletionSource, embedCompletionSource, tagCompletionSource, emojiColonCompletionSource } from "@plainva/ui";

function ctx(doc: string, pos = doc.length) {
  return new CompletionContext(EditorState.create({ doc }), pos, false);
}
const deps = (rows: any[], tags: { tag: string; count: number }[] = []) => ({
  getQueryService: () => ({ db: { query: async () => rows }, getAllTags: async () => tags }),
});

/** Runs an option's apply function against a minimal view built on a real
 *  EditorState — exactly the (view, completion, from, to) contract CM uses. */
function applied(option: Completion, doc: string, from: number, to: number): { doc: string; caret: number } {
  let state = EditorState.create({ doc, selection: { anchor: to } });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: any) {
      state = state.update(spec).state;
    },
  };
  (option.apply as (v: any, c: Completion, f: number, t: number) => void)(view, option, from, to);
  return { doc: state.doc.toString(), caret: state.selection.main.anchor };
}

describe("wikiLinkCompletionSource", () => {
  it("searches notes after [[ and inserts [[Title]]", async () => {
    const src = wikiLinkCompletionSource(deps([{ path: "A/My Note.md", title: "My Note" }]));
    const res = await src(ctx("[[my"));
    expect(res).not.toBeNull();
    expect(res!.from).toBe(0);
    expect(applied(res!.options[0], "[[my", 0, 4).doc).toBe("[[My Note]]");
  });

  it("consumes the auto-closed ]] so picking a suggestion never doubles the closers", async () => {
    const src = wikiLinkCompletionSource(deps([{ path: "A/My Note.md", title: "My Note" }]));
    // closeBrackets turned the typed `[[` into `[[|]]`; typing the term gives `[[my]]` with the caret at 4.
    const res = await src(ctx("[[my]]", 4));
    expect(res).not.toBeNull();
    const { doc, caret } = applied(res!.options[0], "[[my]]", 0, 4);
    expect(doc).toBe("[[My Note]]");
    expect(caret).toBe("[[My Note]]".length);
  });

  it("consumes a single leftover ] and leaves following text alone", async () => {
    const src = wikiLinkCompletionSource(deps([{ path: "A/My Note.md", title: "My Note" }]));
    const res = await src(ctx("[[my] rest", 4));
    expect(applied(res!.options[0], "[[my] rest", 0, 4).doc).toBe("[[My Note]] rest");
  });

  it("returns null without a preceding [[", async () => {
    const src = wikiLinkCompletionSource(deps([{ path: "A.md", title: "A" }]));
    expect(await src(ctx("hello"))).toBeNull();
  });

  /* Issue #56: attachments are offered too, but SECOND. */

  it("offers an attachment under its own heading, with the full file name", async () => {
    const src = wikiLinkCompletionSource(
      deps([
        { path: "Notes/Report to the board.md", title: "Report to the board", is_attachment: 0 },
        { path: "Attachments/Report.pdf", title: null, is_attachment: 1 },
      ]),
    );
    const res = await src(ctx("[[rep"));
    const [note, attachment] = res!.options;

    // The note keeps the top and stays heading-less: CM renders options without
    // a section above every section.
    expect(note.section).toBeUndefined();
    expect(attachment.section).toBeTruthy();

    // The whole file name, extension included, and the PATH is inserted: an
    // attachment carries no frontmatter title, and the bare stem `Report` would
    // resolve to the note above it — the wrong file, silently.
    expect(attachment.label).toBe("Report.pdf");
    expect(applied(attachment, "[[rep", 0, 5).doc).toBe("[[Attachments/Report.pdf]]");
  });

  it("asks the index for notes first and leaves .base out", async () => {
    // The mock returns rows regardless of the query, so the ordering and the
    // exclusion only exist in the SQL — pin them here or they can be dropped
    // without a single test noticing.
    let sql = "";
    const src = wikiLinkCompletionSource({
      getQueryService: () => ({
        db: { query: async (q: string) => { sql = q; return []; } },
        getAllTags: async () => [],
      }),
    });
    await src(ctx("[[x"));
    expect(sql).toMatch(/CASE WHEN path LIKE '%\.md' THEN 0 ELSE 1 END\) AS is_attachment/);
    expect(sql).toMatch(/path NOT LIKE '%\.base'/);
    expect(sql).toMatch(/ORDER BY is_attachment/);
  });
});

describe("embedCompletionSource", () => {
  it("consumes the auto-closed ]] when picking an embed target", async () => {
    const src = embedCompletionSource(deps([{ path: "img/pic.png", title: "" }]));
    const res = await src(ctx("![[pi]]", 5));
    expect(res).not.toBeNull();
    expect(applied(res!.options[0], "![[pi]]", 0, 5).doc).toBe("![[img/pic.png]]");
  });
});

describe("closersToConsume", () => {
  it("counts up to two closing brackets directly after the caret", () => {
    expect(closersToConsume("]]")).toBe(2);
    expect(closersToConsume("] x")).toBe(1);
    expect(closersToConsume("]]] ")).toBe(2);
    expect(closersToConsume("")).toBe(0);
    expect(closersToConsume("text")).toBe(0);
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
