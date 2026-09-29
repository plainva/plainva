// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CompletionContext } from "@codemirror/autocomplete";
import type { IVaultAdapter, VaultQueryService } from "@plainva/core";
import { parseInlineMarkdown, removeLinksTo, setPlatformServices, wikiLinkCompletionSource, wikiLinkPlugin, wikiQueryBefore } from "@plainva/ui";
import { composeLinkPlugin } from "@plainva/ui/mail";

/**
 * Links and inline tokens in the editor, a table cell, the mail composer and
 * the graph's unlink are found in linear time (plan Befunde 24.09., E6). The
 * patterns before looked for a closing bracket again from every opener, so a
 * long run of `[` cost quadratic time. Each hostile case is such a run; what
 * the functions return is pinned by their own tests
 * (inlineMarkdown, editorTriggers, composeLinks, graphActions, editorSession),
 * which ran unchanged across the rewrite, and by the pins here.
 */
const N = 100_000;
const within = async (budgetMs: number, run: () => unknown) => {
  const start = performance.now();
  await run();
  expect(performance.now() - start).toBeLessThan(budgetMs);
};

setPlatformServices({
  loadSettings: async () => ({}) as never,
  credentials: {} as never,
  openExternal: async () => {},
  flushPendingSave: async () => {},
});

describe("inline markdown in cells and cards", () => {
  it("keeps the old token grammar, case-insensitive tags included", () => {
    expect(parseInlineMarkdown("<INPUT type=checkbox checked>")).toEqual([{ kind: "checkbox", checked: true }]);
    expect(parseInlineMarkdown("<input_ type=checkbox>")).toEqual([{ kind: "text", text: "<input_ type=checkbox>" }]);
    expect(parseInlineMarkdown("HTTPS://x.y/z).")).toEqual([{ kind: "url", href: "HTTPS://x.y/z" }, { kind: "text", text: ")." }]);
    expect(parseInlineMarkdown("a <br /> b <BR/> c <br x>")).toEqual([
      { kind: "text", text: "a " }, { kind: "br" }, { kind: "text", text: " b " }, { kind: "br" }, { kind: "text", text: " c <br x>" },
    ]);
    expect(parseInlineMarkdown("[l](<u> \"t\")")).toEqual([{ kind: "link", href: "<u>", label: "l", external: false }]);
    expect(parseInlineMarkdown("__x__y _z_")).toEqual([{ kind: "text", text: "__x__y " }, { kind: "em", children: [{ kind: "text", text: "z" }] }]);
    expect(parseInlineMarkdown("<!-- open")).toEqual([{ kind: "text", text: "<!-- open" }]);
  });

  it("reads a long run of openers in one pass", async () => {
    for (const hostile of ["[[".repeat(N / 2), "[".repeat(N), "![".repeat(N / 2), "[a](".repeat(N / 4), "<!--".repeat(N / 4), "<input ".repeat(N / 7)]) {
      await within(1_000, () => parseInlineMarkdown(hostile));
    }
    // The trailing punctuation of a bare URL is trimmed without a retry per character.
    await within(1_000, () => parseInlineMarkdown(`https://a${").".repeat(N / 2)}x`));
  });
});

describe("the `[[` completion", () => {
  const ctx = (doc: string, pos = doc.length) => new CompletionContext(EditorState.create({ doc }), pos, false);

  it("finds the query the way matchBefore did", () => {
    expect(wikiQueryBefore(ctx("[[a] [[bc"))).toEqual({ from: 5, to: 9, text: "[[bc" });
    expect(wikiQueryBefore(ctx("x[[[[y"))).toEqual({ from: 1, to: 6, text: "[[[[y" });
    expect(wikiQueryBefore(ctx("one\n[[two"))).toEqual({ from: 4, to: 9, text: "[[two" });
    expect(wikiQueryBefore(ctx("[[a]]"))).toBeNull();
    expect(wikiQueryBefore(ctx("[[a]]", 4))).toBeNull();
    // matchBefore looks back 250 characters at most, and so does this.
    expect(wikiQueryBefore(ctx(`[[${"a".repeat(300)}`))).toBeNull();
  });

  it("stays quick on a long line of openers", async () => {
    const source = wikiLinkCompletionSource({ getQueryService: () => ({ db: { query: async () => [] }, getAllTags: async () => [] }) });
    await within(1_000, () => source(ctx("[[".repeat(N / 2))));
  });
});

describe("links in the note editor and the mail composer", () => {
  // The caret sits at the end, so no link is revealed as raw syntax.
  const mount = (doc: string, extensions: Extension) => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state: EditorState.create({ doc, extensions, selection: { anchor: doc.length } }), parent });
  };

  it("decorates wiki and Markdown links as before", () => {
    const view = mount("[[A|shown]] and [b](c) and ![[img]]", wikiLinkPlugin(() => {}, true));
    const spans = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-wiki-link")];
    expect(spans.map((s) => [s.getAttribute("data-link-type"), s.getAttribute("data-link-target"), s.textContent])).toEqual([
      ["wiki", "A", "shown"],
      ["markdown", "c", "b"],
    ]);
    view.destroy();
  });

  it("leaves an image embed and a footnote marker alone in the composer", () => {
    const view = mount("Fussnote [^1] und [Website](https://plainva.com) ![Logo](https://plainva.com/l.png)", composeLinkPlugin());
    const links = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-mail-link")];
    expect(links.map((l) => [l.textContent, l.getAttribute("data-mail-link")])).toEqual([["Website", "https://plainva.com"]]);
    view.destroy();
  });
  // Both plugins scan only what the view shows (a few thousand characters in
  // jsdom), so their hostile runs are pinned where the scan lives: the core
  // test linear-link-scans runs the same two grammars over 100 000 characters.
});

describe("unlinking in the graph", () => {
  it("reads a long run of `[[` in one pass", async () => {
    const files: Record<string, string> = { "a.md": "[[".repeat(N / 2), "b.md": "[[a#".repeat(N / 4) };
    const adapter = {
      readTextFile: async (path: string) => files[path],
      writeTextFile: async (path: string, content: string) => { files[path] = content; },
    } as unknown as IVaultAdapter;
    const query = { listNotes: async () => [] } as unknown as VaultQueryService;
    await within(1_000, async () => expect(await removeLinksTo(adapter, query, "a.md", "x.md")).toBe(0));
    await within(1_000, async () => expect(await removeLinksTo(adapter, query, "b.md", "x.md")).toBe(0));
  });
});
