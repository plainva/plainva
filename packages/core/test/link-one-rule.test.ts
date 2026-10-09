import { describe, expect, it } from "vitest";
import { GraphService } from "../src/vault/GraphService.js";
import { buildLinkTargetIndex, resolveLinkTargetIndexed, wikiTargetChooser, wikiTargetForPath } from "../src/vault/LinkResolver.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { LINK_CASES, type LinkCase } from "./helpers/linkCases.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * One rule for where a wiki link leads (finding 2026-10-08).
 *
 * Each case of `helpers/linkCases.ts` is indexed by the real indexer into a
 * real SQLite index, and every surface the core answers for is asked the same
 * question: what a click opens (`resolveNotePath` — the editor, the reading
 * view, a database cell, the journal and a relation chip of both shells ask
 * it), what the graph draws, what the backlinks list, and the rule itself over
 * the index's own rows. Before the fix the first of these looked for a note's
 * title or its whole path and the others for the end of a path, so a note with
 * a title of its own was a dead link in the editor and an edge in the graph.
 */

async function indexed(files: Record<string, string>, order: "as-written" | "reversed" = "as-written") {
  const db = await realSqlite();
  const vault = new MemoryVaultAdapter(1_000);
  const entries = Object.entries(files);
  for (const [path, text] of order === "reversed" ? entries.reverse() : entries) await vault.writeTextFile(path, text);
  await new VaultIndexer(vault, db).indexVaultFull();
  return { db, query: new VaultQueryService(db), graph: new GraphService(db) };
}

/** The rows the shells hand the rule: every indexed file with the title the index holds for it. */
async function indexRows(vault: Awaited<ReturnType<typeof indexed>>) {
  return vault.db.query<{ path: string; title: string | null }>("SELECT path, title FROM files ORDER BY path");
}

describe.each(LINK_CASES)("case $id: $shows", (linkCase: LinkCase) => {
  it("a click opens the same file in every note", async () => {
    const vault = await indexed(linkCase.files);
    const answers = [];
    for (const link of linkCase.links) answers.push({ ...link, leadsTo: await vault.query.resolveNotePath(link.target, link.from) });
    expect(answers).toEqual(linkCase.links);
    await vault.db.close();
  });

  it("the rule gives that answer over the index's own rows, in whatever order they come", async () => {
    for (const order of ["as-written", "reversed"] as const) {
      const vault = await indexed(linkCase.files, order);
      const rows = await indexRows(vault);
      for (const corpus of [rows, [...rows].reverse()]) {
        const index = buildLinkTargetIndex(corpus);
        const answers = linkCase.links.map((link) => ({ ...link, leadsTo: resolveLinkTargetIndexed(link.from, link.target, index) }));
        expect(answers).toEqual(linkCase.links);
      }
      await vault.db.close();
    }
  });

  it("the graph draws the link to that file, or lists it as broken", async () => {
    const vault = await indexed(linkCase.files);
    const graph = await vault.graph.loadGraph({ includeAttachments: true });
    for (const link of linkCase.links) {
      const edge = graph.edges.find((e) => e.source === link.from && e.target === link.leadsTo);
      const broken = graph.broken.find((b) => b.sourcePath === link.from && b.targetRaw === link.target);
      // A database is a link target the graph never draws: it resolves, and is neither an edge nor broken.
      const drawn = link.leadsTo !== null && !link.leadsTo.endsWith(".base");
      expect({ link, edge: !!edge, broken: !!broken }).toEqual({ link, edge: drawn, broken: link.leadsTo === null });
    }
    await vault.db.close();
  });

  it("the backlinks of that file name the linking note", async () => {
    const vault = await indexed(linkCase.files);
    for (const link of linkCase.links) {
      // An attachment has no backlinks list; a database and a note do.
      if (link.leadsTo === null || !/\.(md|base)$/.test(link.leadsTo)) continue;
      const backlinks = await vault.query.getBacklinks(link.leadsTo);
      expect({ link, listed: backlinks.some((b) => b.source_path === link.from && b.target_path === link.target) }).toEqual({ link, listed: true });
    }
    await vault.db.close();
  });
});

describe("what the rule keeps apart", () => {
  it("a link reads the same from every note unless two files share the name", async () => {
    const vault = await indexed({
      "Start.md": "[[Brief]]\n",
      "Projekte/Plan.md": "[[Brief]]\n",
      "Archiv/Alt/Notiz.md": "[[Brief]]\n",
      "Projekte/Brief.md": "---\ntitle: Angebotsbrief\n---\n",
    });
    for (const from of ["Start.md", "Projekte/Plan.md", "Archiv/Alt/Notiz.md"]) {
      expect(await vault.query.resolveNotePath("Brief", from)).toBe("Projekte/Brief.md");
      expect(await vault.query.resolveNotePath("Angebotsbrief", from)).toBe("Projekte/Brief.md");
    }
    // Asked without a note to stand in — a database cell, a search — the answer is the same.
    expect(await vault.query.resolveNotePath("Brief")).toBe("Projekte/Brief.md");
    await vault.db.close();
  });

  it("a note queued for deletion is no link target any more", async () => {
    const vault = await indexed({ "Start.md": "[[Brief]]\n", "Projekte/Brief.md": "Text\n" });
    expect(await vault.query.resolveNotePath("Brief", "Start.md")).toBe("Projekte/Brief.md");
    await vault.db.execute("UPDATE files SET is_deleted = 1 WHERE path = ?", ["Projekte/Brief.md"]);
    expect(await vault.query.resolveNotePath("Brief", "Start.md")).toBeNull();
    // Nor is it drawn as existing: both shells draw their links from this map.
    expect((await vault.query.getDocumentTitles()).has("Projekte/Brief.md")).toBe(false);
    await vault.db.close();
  });

  it("a file that is no note is found in another spelling only once no note answers", () => {
    const index = buildLinkTargetIndex(["Bilder/foto.png", "bilder/Foto.PNG.md", "Notizen/foto.png.md"]);
    // Spelled exactly like the file: the file.
    expect(resolveLinkTargetIndexed("Start.md", "Bilder/foto.png", index)).toBe("Bilder/foto.png");
    // Spelled otherwise, the note at that path comes first …
    expect(resolveLinkTargetIndexed("Start.md", "bilder/foto.PNG", index)).toBe("bilder/Foto.PNG.md");
    // … and where there is none, the file in its other spelling.
    expect(resolveLinkTargetIndexed("Start.md", "BILDER/FOTO.PNG", buildLinkTargetIndex(["Bilder/foto.png"]))).toBe("Bilder/foto.png");
    // By name alone: a note called so before a file called so.
    expect(resolveLinkTargetIndexed("Start.md", "foto.png", index)).toBe("Notizen/foto.png.md");
  });
});

describe("what the rule costs", () => {
  it("names a list of picks like one pick at a time", () => {
    const paths = ["Brief.md", "Projekte/Brief.md", "Projekte/Plan.md", "Archiv/plan.md", "Übersicht.md", "x/übersicht.md", "Einzeln.md", "Daten/Aufgaben.base"];
    const targetFor = wikiTargetChooser(paths);
    for (const path of [...paths, "Neu/Einzeln.md", "Neu/Ganz Neu.md"]) expect({ path, target: targetFor(path) }).toEqual({ path, target: wikiTargetForPath(path, paths) });
    // A list that names a path twice still knows it as one file.
    expect(wikiTargetChooser(["Einzeln.md", "Einzeln.md"])("Einzeln.md")).toBe("Einzeln");
  });

  it("answers the questions of one turn with one read, and never with a read older than the question", async () => {
    // A hand-held index: its rows can change while a read is under way.
    const rows = [{ path: "Start.md", title: "Start", mode: "obsidian" }];
    const reads: Array<() => void> = [];
    const db = {
      query: (_sql: string) => new Promise((resolve) => { const snapshot = [...rows]; reads.push(() => resolve(snapshot)); }),
    };
    const query = new VaultQueryService(db as never);
    const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

    // A note full of embeds: every embed asks in the same turn.
    const together = [query.resolveNotePath("Start"), query.resolveNotePath("Neu"), query.findByFileName("Start.md")];
    await turn();
    expect(reads).toHaveLength(1);

    // The indexer takes a new note in while that read is under way — and the
    // editor asks about it right away. Its answer must come from a read begun
    // after the note was there, not from the one already on its way.
    rows.push({ path: "Neu.md", title: "Neu", mode: "obsidian" });
    const after = query.resolveNotePath("Neu");
    await turn();
    expect(reads).toHaveLength(2);
    reads.forEach((answer) => answer());
    expect(await Promise.all(together)).toEqual(["Start.md", null, "Start.md"]);
    expect(await after).toBe("Neu.md");
  });
});
