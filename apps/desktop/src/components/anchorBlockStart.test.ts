// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { anchorAwareHtmlBlock, markdownDecorationPlugin, startsWithAnchorMarker } from "@plainva/ui";

/**
 * A comment anchor never starts an HTML block (finding 2026-09-03). A comment
 * on a whole list item puts its opening marker at the head of the item's text,
 * and CommonMark read the line as one opaque `CommentBlock`: no bullet, no
 * indent, the whole line dimmed. The parser rule keeps the marker an inline
 * `Comment`; every other HTML block - the block-drag separator above all -
 * keeps its reading.
 */
const parser = markdown({ base: markdownLanguage, extensions: [anchorAwareHtmlBlock] }).language.parser;

function names(doc: string): string[] {
  const out: string[] = [];
  parser.parse(doc).iterate({ enter: (node) => { out.push(node.name); } });
  return out;
}

describe("anchorAwareHtmlBlock", () => {
  it("names a marker at the head of a line", () => {
    expect(startsWithAnchorMarker("<!--pv#7f3a-->Vorlagen")).toBe(true);
    expect(startsWithAnchorMarker("  <!--/pv#7f3a-->")).toBe(true);
    expect(startsWithAnchorMarker("<!-- -->")).toBe(false);
    expect(startsWithAnchorMarker("<!--pv#7F3A-->")).toBe(false);
    expect(startsWithAnchorMarker("<div>")).toBe(false);
  });

  it("keeps a list item whose text begins with a marker a list item, formatting included", () => {
    const tree = names("- <!--pv#7f3a-->Vorlagen sind **wichtig** und [[Notiz]]<!--/pv#7f3a-->\n- zwei\n");
    expect(tree).toContain("BulletList");
    expect(tree.filter((n) => n === "ListMark")).toHaveLength(2);
    expect(tree).toContain("StrongEmphasis");
    expect(tree.filter((n) => n === "Comment")).toHaveLength(2);
    expect(tree).not.toContain("CommentBlock");
  });

  it("keeps a paragraph and a quoted line that begin with a marker as text", () => {
    expect(names("<!--pv#1111-->Ein Absatz mit *Betonung*<!--/pv#1111-->\n")).toEqual(expect.arrayContaining(["Paragraph", "Emphasis", "Comment"]));
    expect(names("<!--pv#1111-->Ein Absatz<!--/pv#1111-->\n")).not.toContain("CommentBlock");
    const quoted = names("> <!--pv#2222-->Zitat<!--/pv#2222-->\n");
    expect(quoted).toContain("Blockquote");
    expect(quoted).toContain("Paragraph");
    expect(quoted).not.toContain("CommentBlock");
  });

  it("leaves every other HTML block to CommonMark", () => {
    expect(names("<!-- -->\n- a\n")).toContain("CommentBlock");
    expect(names("<!-- a note\nover two lines -->\ntext\n")).toContain("CommentBlock");
    const div = names("<div>\nraw\n</div>\n\nafter\n");
    expect(div).toContain("HTMLBlock");
    expect(div).toContain("Paragraph");
    expect(names("<?php echo 1 ?>\n")).toContain("ProcessingInstructionBlock");
    // An HTML block inside a list item ends with the item.
    const nested = names("- <div>\n  inside\n- next\n");
    expect(nested).toContain("HTMLBlock");
    expect(nested.filter((n) => n === "ListItem")).toHaveLength(2);
  });

  it("the live preview no longer dims the commented item and its bullet is still a list mark", () => {
    const doc = "- <!--pv#7f3a-->Vorlagen<!--/pv#7f3a-->\n- zwei\n";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [markdown({ base: markdownLanguage, extensions: [anchorAwareHtmlBlock] }), markdownDecorationPlugin(true)],
        selection: EditorSelection.single(doc.length - 1),
      }),
      parent: document.body,
    });
    try {
      const tree = syntaxTree(view.state);
      const marks: number[] = [];
      tree.iterate({ enter: (node) => { if (node.name === "ListMark") marks.push(node.from); } });
      expect(marks).toEqual([0, doc.indexOf("- zwei")]);
      const dimmed: Array<{ from: number; to: number }> = [];
      for (const set of view.state.facet(EditorView.decorations)) {
        const resolved = typeof set === "function" ? set(view) : set;
        const it = resolved.iter();
        while (it.value) {
          const cls = (it.value as unknown as { spec?: { class?: string } }).spec?.class ?? "";
          if (cls.includes("cm-md-comment-dim")) dimmed.push({ from: it.from, to: it.to });
          it.next();
        }
      }
      expect(dimmed).toEqual([]);
    } finally {
      view.destroy();
    }
  });
});
