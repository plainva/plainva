import { describe, expect, it } from "vitest";
import { bracketLinks, nextWhere, replaceBracketLinks, wikiLinks } from "../src/linkScan.js";
import { prepareReaderSource } from "../src/noteSource.js";
import remarkObsidianPreserve from "../src/remark-obsidian-preserve.js";
import { projectPublishedMarkdown } from "../src/workspace/publishedSlices.js";
import { rewriteNotionLinks } from "../src/import/notionFileLinks.js";
import { parseTiddlyTags } from "../src/import/adapters/tiddlyAndTana.js";
import { HtmlFolderImporter } from "../src/import/adapters/htmlFolder.js";
import { RoamImporter } from "../src/import/adapters/roam.js";

/**
 * Link and token scanners read vault text in linear time (plan Befunde 24.09.,
 * E6). The patterns they replace looked for a closing bracket again from every
 * opener: a long run of `[` with nothing to close it was seconds, per scan.
 * Each hostile case below is such a run; the behaviour pins beside them were
 * taken from the old patterns, and the sites' own tests ran unchanged.
 */
const N = 100_000;
const within = (budgetMs: number, run: () => void) => {
  const start = performance.now();
  run();
  expect(performance.now() - start).toBeLessThan(budgetMs);
};

describe("linkScan", () => {
  it("nextWhere reuses a rising answer and still answers an earlier position", () => {
    const text = "ab.cd.";
    const dot = nextWhere(text.length, (i) => text[i] === ".");
    expect([dot(0), dot(1), dot(2), dot(3), dot(0), dot(6)]).toEqual([2, 2, 2, 5, 2, 6]);
  });

  it("reads `[label](destination)` the way the editor's pattern did", () => {
    const text = "[a](b) [^1] [c](d\n) ![e]() [f\n](g) [x](y)(z) [[w]](v)";
    const links = [...bracketLinks(text, { labelStops: "\n", destinationStops: "\n", destinationMin: 0 })];
    expect(links.map((m) => [m.index, m.raw, m.label, m.destination])).toEqual([
      [0, "[a](b)", "a", "b"],
      [21, "[e]()", "e", ""],
      [35, "[x](y)", "x", "y"],
    ]);
  });

  it("takes a `!` in front and a literal start of the destination", () => {
    const text = "![a](https://x.test/f.png) [b](http://x) [c](https://) [d](https://y z)";
    const links = [...bracketLinks(text, { bang: true, destinationPrefix: "https://", destinationStopsAtSpace: true, destinationMin: 1 })];
    expect(links.map((m) => [m.index, m.bang, m.destination])).toEqual([[0, "!", "https://x.test/f.png"]]);
    expect(replaceBracketLinks("[a](b) [c](d e)", { destinationStopsAtSpace: true, destinationMin: 1 }, (m) => m.label.toUpperCase())).toBe("A [c](d e)");
  });

  it("reads `[[…]]` lazily to the first `]]` of the line, or strictly without `]`", () => {
    const lazy = "[[a]b]] [[\n]] [[]] ![[c]] [[d\u2028]]";
    expect([...wikiLinks(lazy, { anyInLine: true })].map((m) => [m.index, m.raw, m.inner])).toEqual([
      [0, "[[a]b]]", "a]b"],
      [14, "[[]]", ""],
      [20, "[[c]]", "c"],
    ]);
    const strict = "[[a]] [[]] [[b\n]] ![[c|d]] [[e]f]]";
    expect([...wikiLinks(strict, { bang: true, innerStops: "\n" })].map((m) => [m.index, m.raw, m.inner])).toEqual([
      [0, "[[a]]", "a"],
      [18, "![[c|d]]", "c|d"],
    ]);
  });

  it("runs in one pass over a long run of openers", () => {
    within(1_000, () => expect([...wikiLinks("[[".repeat(N / 2), { anyInLine: true })]).toEqual([]));
    within(1_000, () => expect([...wikiLinks("[[ ".repeat(N / 3), {})]).toEqual([]));
    within(1_000, () => expect([...bracketLinks("[".repeat(N), { labelStops: "\n", destinationStops: "\n", destinationMin: 0 })]).toEqual([]));
    const roam = "[".repeat(N) + "](https://" + "x".repeat(N) + " ";
    within(1_000, () => expect([...bracketLinks(roam, { bang: true, destinationPrefix: "https://", destinationStopsAtSpace: true, destinationMin: 1 })]).toEqual([]));
  });
});

describe("the sites", () => {
  it("the reader source keeps its links, embeds and dates", () => {
    const text = "See [[A|b]] and ![[p.png]] @2026-09-24, not x@2026-09-24 or \\[[C]].";
    expect(prepareReaderSource(text, { formatDate: (iso) => `<${iso}>` }).text).toBe(
      "See [b](wiki://A) and ![img](wiki-image://p.png) <2026-09-24>, not x@2026-09-24 or \\[[C]].",
    );
    within(5_000, () => prepareReaderSource("[[".repeat(N / 2)));
  });

  it("the preserve plugin splits one text node, positions included", () => {
    const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "a [[x]] b\n![[y]] [!info] [!] c", position: { start: { line: 3, column: 5, offset: 40 } } }] }] };
    remarkObsidianPreserve()(tree);
    type Node = { type: string; value: string; position: { start: { line: number; column: number }; end: { line: number; column: number } } };
    const nodes = tree.children[0].children as unknown as Node[];
    expect(nodes.map((n) => [n.type, n.value, n.position.start.line, n.position.start.column, n.position.end.line, n.position.end.column])).toEqual([
      ["text", "a ", 3, 5, 3, 7],
      ["html", "[[x]]", 3, 7, 3, 12],
      ["text", " b\n", 3, 12, 4, 1],
      ["html", "![[y]]", 4, 1, 4, 7],
      ["text", " ", 4, 7, 4, 8],
      ["html", "[!info]", 4, 8, 4, 15],
      ["text", " [!] c", 4, 15, 4, 21],
    ]);
    const hostile = (value: string) => ({ type: "root", children: [{ type: "paragraph", children: [{ type: "text", value, position: { start: { line: 1, column: 1, offset: 0 } } }] }] });
    within(1_000, () => remarkObsidianPreserve()(hostile("[[".repeat(N / 2))));
    // Many links in one paragraph: their positions are counted once, not per link.
    within(1_000, () => remarkObsidianPreserve()(hostile("[[a]]\n".repeat(N / 6))));
  });

  it("TiddlyWiki tags, Notion and HTML-folder links, Roam uploads", async () => {
    expect(parseTiddlyTags("[[Getting Things Done]] work [[]] [[a]b]] x")).toEqual(["Getting Things Done", "work", "[[]]", "[[a]b]]", "x"]);
    within(1_000, () => parseTiddlyTags("[[ ".repeat(N / 3)));

    const notion = rewriteNotionLinks("[x](b.md) ![y](b.md#h) [z](b.md (t)) [w](c.md)", "a/p.md", "A/p.md", new Map([["a/b.md", "A/b.md"]]));
    expect(notion).toEqual({ content: "[x](b.md) ![y](b.md#h) [z](b.md (t)) [w](c.md)", rewritten: 2, unresolved: 1 });
    within(1_000, () => rewriteNotionLinks("![".repeat(N / 2), "a.md", "a.md", new Map()));

    const html = new HtmlFolderImporter() as unknown as { repointLinks(markdown: string, from: string, plan: Map<string, { path: string; title: string }>): string };
    const plan = new Map([["page.html", { path: "Page.md", title: "Page" }]]);
    expect(html.repointLinks("[Page](page.html) [other](page.html#x) [x](https://y) [t](page.html \"z\")", "index.html", plan)).toBe(
      "[[Page]] [[Page|other]] [x](https://y) [t](page.html \"z\")",
    );
    within(1_000, () => html.repointLinks("[".repeat(N), "index.html", plan));

    const roam = new RoamImporter() as unknown as { takeAttachments(text: string, writer: unknown, opts: unknown, folder: string): Promise<{ lost: number }> };
    const fetched: string[] = [];
    const httpFetch = async (url: string) => { fetched.push(url); return { ok: false }; };
    await roam.takeAttachments("![a](https://firebasestorage.googleapis.com/f.png) [b](https://example.com/x)", {}, { httpFetch }, "files");
    expect(fetched).toEqual(["https://firebasestorage.googleapis.com/f.png"]);
    const start = performance.now();
    await roam.takeAttachments("![".repeat(N / 2) + "](https://" + "x".repeat(N / 2), {}, { httpFetch }, "files");
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  it("the publication projection reads every link shape in one pass", () => {
    const project = (markdown: string) => projectPublishedMarkdown({ markdown, includedPaths: ["Shared/Note.md"] });
    expect(project("[[Private/a|shown]] ![[Private/i.png]] [[Shared/Note]] [[Private/b#h]] [[x|]]")).toEqual({
      markdown: "shown  [[Shared/Note]] b [[x|]]",
      report: { removedProperties: [], neutralizedLinks: ["Private/a", "Private/b"], removedEmbeds: ["Private/i.png"] },
    });
    expect(project("[l](<Private/with space.md> 'title') [m]( Private/m.md ) [n](Private/n.md (paren))").markdown).toBe("l m n");
    expect(project("<img alt=x SRC='Private/p.png'> <a HREF=Private/q.md>q</A> <a href=\"https://x\">out</a>")).toEqual({
      markdown: " q <a href=\"https://x\">out</a>",
      report: { removedProperties: [], neutralizedLinks: ["Private/q.md"], removedEmbeds: ["Private/p.png"] },
    });
    expect(project("[ref][r] [r] ![r][]\n\n[r]: Private/r.md").markdown).toBe("ref r \n\n");

    for (const hostile of [
      "[".repeat(N),
      "[[".repeat(N / 2),
      "[[a#".repeat(N / 4),
      "[".repeat(N / 2) + "](b" + " ".repeat(N / 2) + "x",
      "[a](b".repeat(N / 5) + " x",
      "<img ".repeat(N / 5),
      "<img " + "-src=a".repeat(N / 6),
      "<a " + "-href=a".repeat(N / 7) + ">",
      "`".repeat(N) + "\r\n",
      "```\n```\n".repeat(N / 16) + "[[Private/x]] ".repeat(N / 28),
    ]) {
      within(2_000, () => project(hostile));
    }
  });
});
