import { describe, expect, it } from "vitest";
import { isHtmlCommentOnly, remarkBrToBreak, remarkStripHtmlComments, resolveRelativeTarget } from "./markdownReaderModel";

describe("resolveRelativeTarget", () => {
  it("resolves same-folder and encoded links against the source file", () => {
    expect(resolveRelativeTarget("Efforts/index.md", "Efforts_MOC.md")).toEqual({ kind: "file", path: "Efforts/Efforts_MOC.md" });
    expect(resolveRelativeTarget("Efforts/index.md", "Meine%20Notiz.md")).toEqual({ kind: "file", path: "Efforts/Meine Notiz.md" });
    expect(resolveRelativeTarget("index.md", "Zettel.md")).toEqual({ kind: "file", path: "Zettel.md" });
  });

  it("resolves .. climbs, folder links and bundle-absolute paths", () => {
    expect(resolveRelativeTarget("A/B/index.md", "../x.md")).toEqual({ kind: "file", path: "A/x.md" });
    expect(resolveRelativeTarget("Efforts/index.md", "Plainva/")).toEqual({ kind: "folder", path: "Efforts/Plainva" });
    expect(resolveRelativeTarget("A/B/index.md", "../../")).toEqual({ kind: "folder", path: "" });
    expect(resolveRelativeTarget("Efforts/index.md", "/Atlas/Idee.md")).toEqual({ kind: "file", path: "Atlas/Idee.md" });
  });

  it("leaves anchors, schemes and vault-escaping paths alone", () => {
    expect(resolveRelativeTarget("a/index.md", "#heading")).toBeNull();
    expect(resolveRelativeTarget("a/index.md", "https://example.org")).toBeNull();
    expect(resolveRelativeTarget("a/index.md", "wiki://Notiz")).toBeNull();
    expect(resolveRelativeTarget("a/index.md", "mailto:x@y.z")).toBeNull();
    expect(resolveRelativeTarget("index.md", "../draussen.md")).toBeNull();
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
