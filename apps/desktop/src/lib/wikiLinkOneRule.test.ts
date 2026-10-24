import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { linkTargetName, resolveLinkTarget, VaultIndexer, VaultQueryService } from "@plainva/core";
import { buildWikiTargetSet, isWikiTargetResolved, resolveNoteEmbed, searchLinkTargets, wikiLinkCompletionSource, wikiLinkTextFor, wikiTargetPath, wikiTargetToPath } from "@plainva/ui";
import { LINK_CASES, type LinkCase } from "../../../../packages/core/test/helpers/linkCases";
import { MemoryVaultAdapter } from "../../../../packages/core/test/helpers/memoryVault";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { shippedSources } from "../test-sourceTree";

/**
 * One rule for where a wiki link leads — the surfaces above the core
 * (finding 2026-10-08).
 *
 * The core answers what a click opens, what the graph draws and what the
 * backlinks list (`packages/core/test/link-one-rule.test.ts`); the phone runs
 * its own tap against the same cases. What is left are the shared pieces both
 * shells put on the screen: which link is drawn as "not created yet", what an
 * embed shows, and what the `[[` completion writes. Each used to carry a copy
 * of the desktop's old lookup — a note's title or its whole path — so a link
 * could be drawn as missing and still be an edge in the graph.
 */

async function indexed(files: Record<string, string>) {
  const db = await realSqlite();
  const vault = new MemoryVaultAdapter(1_000);
  for (const [path, text] of Object.entries(files)) await vault.writeTextFile(path, text);
  await new VaultIndexer(vault, db).indexVaultFull();
  const query = new VaultQueryService(db);
  // The set both shells push into the editor: every indexed file with its title (useWikiResolver, EditorHost).
  const rows: { title: string; path: string }[] = [];
  (await query.getDocumentTitles()).forEach((entry, path) => rows.push({ title: entry.title, path }));
  return { db, vault, query, drawn: buildWikiTargetSet(rows) };
}

describe.each(LINK_CASES)("case $id: $shows", (linkCase: LinkCase) => {
  it("a link is drawn as not created yet exactly where a click would create the note", async () => {
    const vault = await indexed(linkCase.files);
    for (const link of linkCase.links) {
      const opens = await vault.query.resolveNotePath(link.target, link.from);
      expect({ link, opens, drawnAsExisting: isWikiTargetResolved(link.target, vault.drawn, link.from) }).toEqual({ link, opens: link.leadsTo, drawnAsExisting: link.leadsTo !== null });
    }
    await vault.db.close();
  });

  it("an embed shows the file the link opens", async () => {
    const vault = await indexed(linkCase.files);
    for (const link of linkCase.links) {
      // An embed of a note or a database; a picture or a PDF goes the image's own way.
      if (link.leadsTo !== null && !/\.(md|base)$/.test(link.leadsTo)) continue;
      // The desktop's port, as MarkdownReader passes it.
      const embed = await resolveNoteEmbed(link.target, link.from, { resolve: (name, from) => vault.query.resolveNotePath(name, from) });
      expect({ link, embed }).toEqual({ link, embed: link.leadsTo === null ? { status: "missing" } : { status: "found", path: link.leadsTo, anchor: null } });
    }
    await vault.db.close();
  });
});

describe("what the `[[` completion writes", () => {
  /** The target of the one link a pick writes. */
  const targetOf = (insert: string) => /^\[\[([^\]|#]+)/.exec(insert)![1];

  it("leads back to the note that was picked — also for a titled note and for two notes of one name", async () => {
    const vault = await indexed({
      "Start.md": "\n",
      "Projekte/Brief.md": "---\ntitle: Angebotsbrief\n---\n",
      "Archiv/Brief.md": "An old letter.\n",
      "Kunden/Notiz.md": "---\ntitle: Angebot\n---\n",
      "Vorlagen/Angebot.md": "The note that is called so.\n",
      "Vorlagen/Einzeln.md": "One of its name.\n",
    });
    for (const term of ["Brief", "Angebot", "Einzeln", "Notiz"]) {
      const hits = (await searchLinkTargets(vault.query, term)).filter((hit) => hit.kind === "note");
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        // `detail` is the path the row stands for.
        expect({ term, insert: hit.insert, opens: await vault.query.resolveNotePath(targetOf(hit.insert), "Start.md") }).toEqual({ term, insert: hit.insert, opens: hit.detail });
      }
    }
    await vault.db.close();
  });

  it("writes the bare name where one note carries it, and shows a title of its own as the link's text", async () => {
    const vault = await indexed({
      "Start.md": "\n",
      "Projekte/Brief.md": "---\ntitle: Angebotsbrief\n---\n",
      "Vorlagen/Einzeln.md": "One of its name.\n",
    });
    const insertFor = async (term: string) => (await searchLinkTargets(vault.query, term)).map((hit) => hit.insert);
    expect(await insertFor("Einzeln")).toEqual(["[[Einzeln]]"]);
    expect(await insertFor("Angebotsbrief")).toEqual(["[[Brief|Angebotsbrief]]"]);
    await vault.db.close();
  });
});

describe("the headings offered after `[[Note#`", () => {
  const ctx = (doc: string) => new CompletionContext(EditorState.create({ doc }), doc.length, false);

  it("are those of the note the link leads to — found by the link rule, and what was typed stays", async () => {
    const vault = await indexed({
      "Start.md": "\n",
      "Projekte/Brief.md": "---\ntitle: Angebotsbrief\n---\n\n## Anrede\n\n## Preis\n",
      "Projekte/Hafenkante/Plan.md": "## Ablauf\n",
    });
    const source = wikiLinkCompletionSource({
      getQueryService: () => vault.query,
      readNote: (path) => vault.vault.readTextFile(path),
      hostPath: () => "Start.md",
    });
    // By the file's name, by the title of its properties, by the end of its path: one note each time.
    for (const typed of ["Brief", "angebotsbrief", "Hafenkante/Plan"]) {
      const result = await source(ctx(`[[${typed}#`));
      expect({ typed, offered: result?.options.map((option) => option.label) }).toEqual({
        typed,
        offered: typed === "Hafenkante/Plan" ? ["Ablauf"] : ["Anrede", "Preis"],
      });
      // The pick writes the name that was typed — it is one that leads there.
      let written = "";
      const view = { state: EditorState.create({ doc: `[[${typed}#` }), dispatch(spec: { changes: { insert: string } }) { written = spec.changes.insert; } };
      (result!.options[0].apply as (v: unknown, c: unknown, from: number, to: number) => void)(view, result!.options[0], 0, typed.length + 3);
      expect(written).toBe(`[[${typed}#${result!.options[0].label}]]`);
    }
    expect(await source(ctx("[[Nirgends#"))).toBeNull();
    await vault.db.close();
  });
});

describe("a note created from a link", () => {
  it("lands where the link then finds it", () => {
    // What a click on a link that leads nowhere creates (`wikiTargetToPath`),
    // and what the rule answers once that file exists.
    const from = "Projekte/Hafenkante/Plan.md";
    for (const target of ["Neu", "Ablage/Neu", "./Neu", "../Neu", "../../Neu", "/Eingang/Neu", "Neu.md", "Neu#Abschnitt|gezeigt"]) {
      const created = wikiTargetToPath(target, from);
      expect({ target, created: created.path }).toEqual({ target, created: expect.stringMatching(/Neu\.md$/) });
      expect({ target, leadsTo: resolveLinkTarget(from, linkTargetName(target), [from, created.path]) }).toEqual({ target, leadsTo: created.path });
    }
    expect(wikiTargetToPath("./Neu", from).path).toBe("Projekte/Hafenkante/Neu.md");
    expect(wikiTargetToPath("../Neu", from).path).toBe("Projekte/Neu.md");
    expect(wikiTargetToPath("/Eingang/Neu", from).path).toBe("Eingang/Neu.md");
    // A target that climbs out of the vault names no place: nothing is created.
    expect(wikiTargetToPath("../../../Neu", from)).toEqual({ path: "", title: "" });
  });
});

describe("a relation picker", () => {
  it("knows a linked note under every name the rule follows, and writes the name every writer writes", async () => {
    const vault = await indexed({
      "Start.md": "\n",
      "Projekte/Brief.md": "---\ntitle: Angebotsbrief\n---\n",
      "Archiv/Brief.md": "An old letter.\n",
      "Vorlagen/Einzeln.md": "One of its name.\n",
    });
    // A stored value may name its note by file name, path or title — one note each time.
    for (const stored of ["Projekte/Brief", "Angebotsbrief", "angebotsbrief", "Projekte/Brief.md"]) {
      expect({ stored, means: wikiTargetPath(stored, vault.drawn, "Start.md") }).toEqual({ stored, means: "Projekte/Brief.md" });
    }
    expect(wikiTargetPath("Nirgends", vault.drawn, "Start.md")).toBeNull();
    const notes = (await vault.query.listNotes()).map((note) => note.path);
    expect(wikiLinkTextFor("Vorlagen/Einzeln.md", "Einzeln", notes)).toBe("[[Einzeln]]");
    // Two notes of one name: the path, and what the note is called as the link's text.
    expect(wikiLinkTextFor("Projekte/Brief.md", "Angebotsbrief", notes)).toBe("[[Projekte/Brief|Angebotsbrief]]");
    expect(wikiLinkTextFor("Archiv/Brief.md", "Brief", notes)).toBe("[[Archiv/Brief|Brief]]");
    // A title that cannot be a link's text is left out rather than breaking the link.
    expect(wikiLinkTextFor("Vorlagen/Einzeln.md", "A | B", notes)).toBe("[[Einzeln]]");
    await vault.db.close();
  });
});

describe("the lookup lives in one place", () => {
  it("no shipped file compares a link with the index's title column in SQL", () => {
    // The fingerprint of the old lookup (`title = ? COLLATE NOCASE OR path = ? …`), copied
    // into five files before it was replaced by `VaultQueryService.resolveNotePath`.
    const offenders = shippedSources()
      .filter(({ text }) => /(?<![\w.])title\s*=\s*\?\s*COLLATE\s+NOCASE/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
