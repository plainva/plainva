import { describe, expect, it } from "vitest";
import { initializeSchema } from "../src/db/Schema.js";
import { markdownDestinationUrl, markdownLinkTarget } from "../src/linkEncoding.js";
import { readNoteLinks } from "../src/linkRewrite.js";
import { GraphService } from "../src/vault/GraphService.js";
import { buildLinkTargetIndex, markdownLinkPlaces, resolveLinkRow, resolveMarkdownLinkIndexed, type MarkdownLinkAnswer } from "../src/vault/LinkResolver.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { MARKDOWN_LINK_CASES, markdownCaseVault, type MarkdownLinkCase, type MarkdownLinkExpectation } from "./helpers/markdownLinkCases.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * One rule for where a Markdown link leads (finding 2026-10-09, recorded
 * 2026-10-12).
 *
 * Each case of `helpers/markdownLinkCases.ts` is indexed by the real indexer
 * into a real SQLite index, and every surface the core answers for is asked
 * the same question: what a click opens (`resolveMarkdownLink` — the editor,
 * the reading view, a table cell, the journal and a comment of both shells ask
 * it), what the graph draws, what the backlinks list, and the rule itself over
 * the index's own rows. Before the fix the graph and the backlinks resolved a
 * Markdown link by the wiki rule and the click surfaces each by a reading of
 * their own.
 */

async function indexed(files: Record<string, string>, order: "as-written" | "reversed" = "as-written") {
  const db = await realSqlite();
  const vault = new MemoryVaultAdapter(1_000);
  const entries = Object.entries(files);
  for (const [path, text] of order === "reversed" ? entries.reverse() : entries) await vault.writeTextFile(path, text);
  const indexer = new VaultIndexer(vault, db);
  await indexer.indexVaultFull();
  return { db, vault, indexer, query: new VaultQueryService(db), graph: new GraphService(db) };
}

/** A rule's answer in the shape of a case's expectation. */
function answered(link: MarkdownLinkExpectation, answer: MarkdownLinkAnswer) {
  const leadsTo = answer === null ? null : answer.kind === "file" ? answer.path : answer.index;
  const folder = answer !== null && answer.kind === "folder" && answer.index === null ? answer.path : undefined;
  return { from: link.from, href: link.href, leadsTo, folder };
}
const expected = (link: MarkdownLinkExpectation) => ({ from: link.from, href: link.href, leadsTo: link.leadsTo, folder: link.folder });

describe.each(MARKDOWN_LINK_CASES)("case $id: $shows", (linkCase: MarkdownLinkCase) => {
  it("a click opens the same file in every note", async () => {
    const vault = await indexed(markdownCaseVault(linkCase));
    for (const link of linkCase.links) {
      const { target, anchor } = markdownLinkTarget(link.href);
      expect({ ...answered(link, await vault.query.resolveMarkdownLink(target, link.from)), anchor: anchor ?? undefined }).toEqual({ ...expected(link), anchor: link.anchor });
    }
    await vault.db.close();
  });

  it("the rule gives that answer over the index's own rows, in whatever order they come", async () => {
    for (const order of ["as-written", "reversed"] as const) {
      const vault = await indexed(markdownCaseVault(linkCase), order);
      const rows = await vault.db.query<{ path: string; title: string | null }>("SELECT path, title FROM files ORDER BY path");
      for (const corpus of [rows, [...rows].reverse()]) {
        const index = buildLinkTargetIndex(corpus);
        for (const link of linkCase.links) {
          expect(answered(link, resolveMarkdownLinkIndexed(link.from, markdownLinkTarget(link.href).target, index))).toEqual(expected(link));
        }
      }
      await vault.db.close();
    }
  });

  it("the graph draws the link to that file, or lists it as broken", async () => {
    const vault = await indexed(markdownCaseVault(linkCase));
    const graph = await vault.graph.loadGraph({ includeAttachments: true });
    for (const link of linkCase.links) {
      const edges = graph.edges.filter((edge) => edge.source === link.from).map((edge) => `${edge.kind} -> ${edge.target}`);
      const broken = graph.broken.filter((b) => b.sourcePath === link.from).map((b) => b.kind);
      // A database resolves and is never drawn; a folder without an index.md is a place, not a note.
      const drawn = link.leadsTo !== null && !link.leadsTo.endsWith(".base");
      expect({ link, edges, broken }).toEqual({
        link,
        edges: drawn ? [`markdown-link -> ${link.leadsTo}`] : [],
        broken: link.leadsTo === null && link.folder === undefined ? ["markdown-link"] : [],
      });
    }
    await vault.db.close();
  });

  it("the backlinks of that file name the linking note, and no other file's do", async () => {
    const vault = await indexed(markdownCaseVault(linkCase));
    const files = (await vault.db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((row) => row.path);
    for (const link of linkCase.links) {
      const listedAt: string[] = [];
      for (const path of files) {
        if (path === link.from) continue;
        if ((await vault.query.getBacklinks(path)).some((b) => b.source_path === link.from)) listedAt.push(path);
      }
      expect({ link, listedAt }).toEqual({ link, listedAt: link.leadsTo === null ? [] : [link.leadsTo] });
    }
    await vault.db.close();
  });
});

describe("a Markdown link and a wiki link", () => {
  it("of one text may lead to two files: the path is read from the note, the name is not", async () => {
    const vault = await indexed({
      "Brief.md": "The letter at the root.\n",
      "Projekte/Brief.md": "The letter of the project.\n",
      "Projekte/Plan.md": "[[Brief.md]] and [the letter](Brief.md)\n",
    });
    expect(await vault.query.resolveNotePath("Brief.md", "Projekte/Plan.md")).toBe("Brief.md");
    expect(await vault.query.resolveMarkdownLink("Brief.md", "Projekte/Plan.md")).toEqual({ kind: "file", path: "Projekte/Brief.md" });
    const graph = await vault.graph.loadGraph();
    expect(graph.edges.filter((edge) => edge.source === "Projekte/Plan.md").map((edge) => `${edge.kind} -> ${edge.target}`).sort()).toEqual([
      "markdown-link -> Projekte/Brief.md",
      "wikilink -> Brief.md",
    ]);
    // Each note's backlinks list the link that leads to it, and only that one.
    expect((await vault.query.getBacklinks("Brief.md")).map((b) => b.link_type)).toEqual(["wikilink"]);
    expect((await vault.query.getBacklinks("Projekte/Brief.md")).map((b) => b.link_type)).toEqual(["markdown-link"]);
    await vault.db.close();
  });

  it("a row is resolved by the way its link is written", () => {
    const index = buildLinkTargetIndex(["Brief.md", "Projekte/Brief.md", "Projekte/Ablage/index.md"]);
    expect(resolveLinkRow("Projekte/Plan.md", "Brief.md", "wikilink", index)).toBe("Brief.md");
    expect(resolveLinkRow("Projekte/Plan.md", "Brief.md", "embed", index)).toBe("Brief.md");
    expect(resolveLinkRow("Projekte/Plan.md", "Brief.md", "markdown-link", index)).toBe("Projekte/Brief.md");
    // A row of an older index, or a relation: a wiki link.
    expect(resolveLinkRow("Projekte/Plan.md", "Brief.md", null, index)).toBe("Brief.md");
    // A folder link is a link to the index.md in it.
    expect(resolveLinkRow("Projekte/Plan.md", "Ablage/", "markdown-link", index)).toBe("Projekte/Ablage/index.md");
    expect(resolveLinkRow("Projekte/Plan.md", "Ablage/", "wikilink", index)).toBeNull();
  });
});

describe("what a Markdown link names", () => {
  it("is read once: the first written # is the anchor, an encoded one belongs to the name", () => {
    expect(markdownLinkTarget("Ablage/Mein%20Brief.md#Absatz")).toEqual({ target: "Ablage/Mein Brief.md", anchor: "#Absatz" });
    expect(markdownLinkTarget("Draft%20%231.md")).toEqual({ target: "Draft #1.md", anchor: null });
    expect(markdownLinkTarget("Draft%20%231.md#Part%20two")).toEqual({ target: "Draft #1.md", anchor: "#Part two" });
    // A caret is no marker of a Markdown link: it stays in the name.
    expect(markdownLinkTarget("a^b.md")).toEqual({ target: "a^b.md", anchor: null });
    expect(markdownLinkTarget("#absatz")).toEqual({ target: "", anchor: "#absatz" });
    expect(markdownLinkTarget("Brief.md#")).toEqual({ target: "Brief.md", anchor: null });
    // A `%` that encodes nothing is a name, not a crash.
    expect(markdownLinkTarget("100%.md")).toEqual({ target: "100%.md", anchor: null });
  });

  it("the index, a rename and a click read the same target", async () => {
    const destinations = ["Draft%20%231.md", "Draft%20%231.md#Part", "a^b.md", "Ablage/Mein%20Brief.md", "<Mein Brief.md>", "Brief.md \"Titel\"", "%C3%9Cbersicht.md"];
    const text = destinations.map((destination) => `[x](${destination})`).join("\n\n");
    const vault = await indexed({ "Start.md": `${text}\n` });
    const listed = (await vault.db.query<{ target_path: string }>("SELECT target_path FROM links ORDER BY line_number")).map((row) => row.target_path);
    const rewritten = readNoteLinks(`${text}\n`).links.map((link) => link.target);
    const clicked = destinations.map((destination) => markdownLinkTarget(markdownDestinationUrl(destination)).target);
    expect(listed).toEqual(["Draft #1.md", "Draft #1.md", "a^b.md", "Ablage/Mein Brief.md", "Mein Brief.md", "Brief.md", "Übersicht.md"]);
    expect(rewritten).toEqual(listed);
    expect(clicked).toEqual(listed);
    await vault.db.close();
  });

  it("a destination as a line holds it loses its brackets, its title and its escapes, and nothing else", () => {
    expect(markdownDestinationUrl("<Mein Brief.md>")).toBe("Mein Brief.md");
    expect(markdownDestinationUrl('Brief.md "Der Brief"')).toBe("Brief.md");
    expect(markdownDestinationUrl("Brief.md 'Der Brief'")).toBe("Brief.md");
    expect(markdownDestinationUrl("Brief.md (Der Brief)")).toBe("Brief.md");
    expect(markdownDestinationUrl("Notes\\_final.md")).toBe("Notes_final.md");
    // A blank and no title: no link for the parser, but the editor draws it and has always opened it.
    expect(markdownDestinationUrl("Mein Brief.md")).toBe("Mein Brief.md");
    expect(markdownDestinationUrl("  Brief.md  ")).toBe("Brief.md");
    // A quote that closes nothing, a parenthesis in the name: part of the name.
    expect(markdownDestinationUrl('Sagt"er.md')).toBe('Sagt"er.md');
    expect(markdownDestinationUrl("Datei(alt).md")).toBe("Datei(alt).md");
  });

  it("the places a target names on disk are its paths, never a name", () => {
    expect(markdownLinkPlaces("Projekte/Plan.md", "Ablage/Brief.md")).toEqual([
      { kind: "file", path: "Projekte/Ablage/Brief.md" },
      { kind: "file", path: "Ablage/Brief.md" },
    ]);
    expect(markdownLinkPlaces("Projekte/Plan.md", "Brief")).toEqual([
      { kind: "file", path: "Projekte/Brief" },
      { kind: "file", path: "Projekte/Brief.md" },
      { kind: "file", path: "Brief" },
      { kind: "file", path: "Brief.md" },
    ]);
    expect(markdownLinkPlaces("Projekte/Plan.md", "../Ablage/Brief.md")).toEqual([{ kind: "file", path: "Ablage/Brief.md" }]);
    expect(markdownLinkPlaces("Projekte/Plan.md", "../../Draussen.md")).toEqual([]);
    expect(markdownLinkPlaces("Projekte/Plan.md", "Ablage/")).toEqual([
      { kind: "folder", path: "Projekte/Ablage" },
      { kind: "folder", path: "Ablage" },
    ]);
    expect(markdownLinkPlaces("Projekte/Plan.md", "../")).toEqual([{ kind: "folder", path: "" }]);
    expect(markdownLinkPlaces("Start.md", "Brief.md")).toEqual([{ kind: "file", path: "Brief.md" }]);
  });
});

describe("a destination as the parser reads it", () => {
  it("resolves a character reference where one stands, and reads the rest by hand", () => {
    expect(markdownDestinationUrl("Tom&amp;Jerry.md")).toBe("Tom&Jerry.md");
    expect(markdownDestinationUrl("<Tom &amp; Jerry.md>")).toBe("Tom & Jerry.md");
    expect(markdownDestinationUrl("Draft&#35;1.md")).toBe("Draft#1.md");
    expect(markdownDestinationUrl('Tom&amp;Jerry.md "Title"')).toBe("Tom&Jerry.md");
    // A `&` that begins no reference stays as it is, and is read by hand.
    expect(markdownDestinationUrl("a&b.md")).toBe("a&b.md");
    expect(markdownDestinationUrl('https://example.com/?a=1&b=2 "Title"')).toBe("https://example.com/?a=1&b=2");
    // No link for the parser (a blank): read by hand, as before.
    expect(markdownDestinationUrl("Tom &amp; Jerry.md")).toBe("Tom &amp; Jerry.md");
    expect(markdownDestinationUrl("<Mein Brief.md>")).toBe("Mein Brief.md");
  });
});

describe("index format 7", () => {
  it("re-reads the notes whose Markdown links may stand under a cut target, and no other", async () => {
    const vault = await indexed({
      "Start.md": "[the draft](Draft%20%231.md)\n",
      "Mit.md": "[a part](Andere.md#Teil)\n",
      "Ohne.md": "[plain](Andere.md) and [[Andere#Teil]]\n",
      "Draft #1.md": "Text.\n",
      "Draft.md": "Text.\n",
      "Andere.md": "## Teil\n",
    });
    const targetsOf = async (path: string) =>
      (await vault.db.query<{ target_path: string }>("SELECT l.target_path FROM links l JOIN files f ON f.id = l.source_id WHERE f.path = ? ORDER BY l.target_path", [path])).map((row) => row.target_path);
    expect(await targetsOf("Start.md")).toEqual(["Draft #1.md"]);

    // The index as version 6 left it: the link cut at the decoded `#`.
    await vault.db.execute("UPDATE links SET target_path = 'Draft', anchor = '#1.md' WHERE target_path = 'Draft #1.md'");
    await vault.db.execute("UPDATE meta SET value = '6' WHERE key = 'index_format_version'");
    // Each note gets a property: the step of version 8 reads again a note that
    // begins with a block and holds none, and this test is about the step of version 7.
    await vault.db.execute("INSERT INTO properties (file_id, key, value, type) SELECT id, 'type', 'Note', 'string' FROM files");
    expect((await vault.query.getBacklinks("Draft.md")).map((b) => b.source_path)).toEqual(["Start.md"]);

    await initializeSchema(vault.db);
    const stale = (await vault.db.query<{ path: string }>("SELECT path FROM files WHERE mtime_local = 0 ORDER BY path")).map((row) => row.path);
    // A wiki link with an anchor is not what the step is about.
    expect(stale).toEqual(["Mit.md", "Start.md"]);
    expect((await vault.db.query<{ value: string }>("SELECT value FROM meta WHERE key = 'index_format_version'"))[0].value).toBe("8");

    await vault.indexer.indexVaultFull();
    expect(await targetsOf("Start.md")).toEqual(["Draft #1.md"]);
    expect((await vault.query.getBacklinks("Draft #1.md")).map((b) => b.source_path)).toEqual(["Start.md"]);
    expect(await vault.query.getBacklinks("Draft.md")).toEqual([]);
    await vault.db.close();
  });
});
