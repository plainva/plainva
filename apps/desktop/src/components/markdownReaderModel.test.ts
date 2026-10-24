import { describe, expect, it } from "vitest";
import { encodeWikiTarget, isHtmlCommentOnly, remarkBrToBreak, remarkStripHighlightMarks, remarkStripHtmlComments, remarkTagPills } from "./markdownReaderModel";

describe("encodeWikiTarget", () => {
  it("leaves no character that can break a markdown link destination", () => {
    // An unbalanced "(" swallowed the link's closing paren in read mode
    // (promoted checkbox "… (keine offenen" — maintainer find 2026-07-17).
    const encoded = encodeWikiTarget("Nataschas Sachen sind abgeholt (keine offenen");
    expect(encoded).not.toMatch(/[()!'* ]/);
    expect(decodeURIComponent(encoded)).toBe("Nataschas Sachen sind abgeholt (keine offenen");
  });

  it("round-trips every reader-relevant special character", () => {
    const target = "A (b) c! 'd' *e* äöü #x";
    expect(decodeURIComponent(encodeWikiTarget(target))).toBe(target);
    expect(encodeWikiTarget(target)).not.toMatch(/[()!'* ]/);
  });
});

describe("remarkBrToBreak", () => {
  it("turns literal <br> html nodes into hard breaks (e.g. inside table cells)", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "tableCell",
          children: [
            { type: "text", value: "oben" },
            { type: "html", value: "<br>" },
            { type: "text", value: "unten" },
            { type: "html", value: "<br />" },
            { type: "html", value: "<brotdose>" },
          ],
        },
      ],
    };
    remarkBrToBreak()(tree as never);
    const cell = tree.children[0] as { children: { type: string; value?: string }[] };
    expect(cell.children.map((c) => c.type)).toEqual(["text", "break", "text", "break", "html"]);
    expect(cell.children[1].value).toBeUndefined();
    expect(cell.children[4].value).toBe("<brotdose>");
  });
});

describe("remarkStripHtmlComments", () => {
  it("drops comment-only html nodes at any depth, keeps everything else", () => {
    const tree = {
      type: "root",
      children: [
        { type: "html", value: "<!-- plainva:index generated -->" },
        {
          type: "paragraph",
          children: [
            { type: "text", value: "Hallo " },
            { type: "html", value: "<!-- inline -->" },
            { type: "text", value: "Welt" },
          ],
        },
        { type: "code", value: "<!-- bleibt sichtbar -->" },
        { type: "html", value: "<div>echtes HTML</div>" },
      ],
    };
    remarkStripHtmlComments()(tree as never);
    expect(tree.children.map((c) => c.type)).toEqual(["paragraph", "code", "html"]);
    expect((tree.children[0] as { children: { value?: string }[] }).children.map((c) => c.value)).toEqual(["Hallo ", "Welt"]);
    expect((tree.children[1] as { value?: string }).value).toBe("<!-- bleibt sichtbar -->");
    expect((tree.children[2] as { value?: string }).value).toBe("<div>echtes HTML</div>");
  });
});

describe("isHtmlCommentOnly", () => {
  it("accepts comment-only content with surrounding whitespace", () => {
    expect(isHtmlCommentOnly("<!-- x -->")).toBe(true);
    expect(isHtmlCommentOnly("  <!-- a -->\n <!-- b -->  ")).toBe(true);
    expect(isHtmlCommentOnly("<!--multi\nline-->")).toBe(true);
  });

  it("rejects whitespace-only, unterminated and mixed content", () => {
    expect(isHtmlCommentOnly("   ")).toBe(false);
    expect(isHtmlCommentOnly("")).toBe(false);
    expect(isHtmlCommentOnly("<!-- open")).toBe(false);
    expect(isHtmlCommentOnly("<!-- a --> text")).toBe(false);
    expect(isHtmlCommentOnly("<div></div>")).toBe(false);
  });

  it("stays linear on adversarial input (no catastrophic backtracking)", () => {
    const evil = "<!--" + " ".repeat(50000); // long, never terminated
    const start = performance.now();
    expect(isHtmlCommentOnly(evil)).toBe(false);
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe("remarkStripHighlightMarks", () => {
  const run = (value: string) => {
    const tree: any = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value }] }] };
    remarkStripHighlightMarks()(tree);
    return tree.children[0].children;
  };

  it("turns ==x== into a mark-tagged node between plain text", () => {
    const out = run("a ==b== c");
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: "text", value: "a " });
    expect(out[1].type).toBe("emphasis");
    expect(out[1].data).toEqual({ hName: "mark" });
    expect(out[1].children).toEqual([{ type: "text", value: "b" }]);
    expect(out[2]).toEqual({ type: "text", value: " c" });
  });

  it("handles multiple highlights and leaves lone == alone", () => {
    const out = run("==x== und ==y==");
    expect(out.map((n: any) => n.type)).toEqual(["emphasis", "text", "emphasis"]);
    expect(run("a == b")).toEqual([{ type: "text", value: "a == b" }]);
  });

  it("leaves inlineCode nodes verbatim", () => {
    const tree: any = { type: "root", children: [{ type: "paragraph", children: [{ type: "inlineCode", value: "==raw==" }] }] };
    remarkStripHighlightMarks()(tree);
    expect(tree.children[0].children).toEqual([{ type: "inlineCode", value: "==raw==" }]);
  });
});

describe("remarkTagPills (finding 2026-09-19)", () => {
  const run = (children: any[]) => {
    const tree: any = { type: "root", children: [{ type: "paragraph", children }] };
    remarkTagPills()(tree);
    return tree.children[0].children;
  };

  it("wraps a tag in the pill the editor draws, the path in a quieter inner span", () => {
    const out = run([{ type: "text", value: "on #project/site now" }]);
    expect(out.map((n: any) => n.type)).toEqual(["text", "emphasis", "text"]);
    expect(out[1].data.hName).toBe("span");
    expect(out[1].data.hProperties.className).toEqual(["pv-tag-pill"]);
    expect(out[1].data.hProperties.dataTag).toBe("project/site");
    expect(out[1].data.hProperties.dataTagColor).toMatch(/^[1-7]$/);
    expect(out[1].children[0].data.hProperties.className).toEqual(["pv-tag-parent"]);
    expect(out[1].children[0].children).toEqual([{ type: "text", value: "#project/" }]);
    expect(out[1].children[1]).toEqual({ type: "text", value: "site" });
  });

  it("marks what the index counts - not a number, not a fragment, not code, not the text of a link", () => {
    expect(run([{ type: "text", value: "issue #42 and word#part" }])).toEqual([{ type: "text", value: "issue #42 and word#part" }]);
    expect(run([{ type: "inlineCode", value: "#code" }])).toEqual([{ type: "inlineCode", value: "#code" }]);
    const link = { type: "link", url: "wiki://x", children: [{ type: "text", value: "see #inside" }] };
    expect(run([link])[0].children).toEqual([{ type: "text", value: "see #inside" }]);
  });

  it("finds the tag inside a highlight, which starts a text node of its own", () => {
    const tree: any = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "==#marked==" }] }] };
    remarkStripHighlightMarks()(tree);
    remarkTagPills()(tree);
    const mark = tree.children[0].children[0];
    expect(mark.data).toEqual({ hName: "mark" });
    expect(mark.children[0].data.hProperties.dataTag).toBe("marked");
  });
});
