import { describe, expect, it } from "vitest";
import { GraphService, markdownLinkTarget, VaultIndexer, VaultQueryService } from "@plainva/core";
import {
  applyLinkUpdates,
  brokenLinkLabel,
  brokenLinkNotePath,
  createBrokenLinkTarget,
  linkDiskProbe,
  parseInlineMarkdown,
  planLinkOpen,
  planLinkUpdates,
  opensOutside,
  removeLinksTo,
  setPlatformServices,
  type LinkOpenDeps,
  type LinkOpenOutcome,
} from "@plainva/ui";
import { MARKDOWN_LINK_CASES, markdownCaseVault, type MarkdownLinkCase, type MarkdownLinkExpectation } from "../../../../packages/core/test/helpers/markdownLinkCases";
import { MemoryVaultAdapter } from "../../../../packages/core/test/helpers/memoryVault";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { shippedSources, sourceFile } from "../test-sourceTree";

/**
 * One rule for where a Markdown link leads — the surfaces above the core
 * (finding 2026-10-09, recorded 2026-10-12).
 *
 * The core answers where a link leads, what the graph draws and what the
 * backlinks list (`packages/core/test/markdown-link-one-rule.test.ts`); the
 * phone runs its own resolver against the same cases. What is left is what
 * both shells do with the answer: what a click does (`planLinkOpen`), what a
 * rename rewrites, where the clean-up creates a missing note and what
 * "remove text links" removes. Each used to read a Markdown link in a way of
 * its own — eight click surfaces, hardly two alike.
 */

setPlatformServices({
  loadSettings: async () => ({}) as never,
  credentials: {} as never,
  openExternal: async () => {},
  flushPendingSave: async () => {},
});

async function vaultOf(files: Record<string, string>, opts: { index?: boolean } = {}) {
  const db = await realSqlite();
  const adapter = new MemoryVaultAdapter(1_000);
  for (const [path, text] of Object.entries(files)) await adapter.writeTextFile(path, text);
  const indexer = new VaultIndexer(adapter, db);
  if (opts.index !== false) await indexer.indexVaultFull();
  const query = new VaultQueryService(db);
  // What each shell hands `planLinkOpen`: its index and its disk.
  const deps: LinkOpenDeps = {
    resolveWiki: (target, from) => query.resolveNotePath(target, from),
    resolveMarkdown: (target, from) => query.resolveMarkdownLink(target, from),
    ...linkDiskProbe(adapter),
  };
  return { db, adapter, indexer, query, graph: new GraphService(db), deps };
}

/** An outcome reduced to what a case states. */
function done(outcome: LinkOpenOutcome) {
  switch (outcome.action) {
    case "open": return { action: "open", path: outcome.path, anchor: outcome.anchor ?? undefined };
    case "folder": return { action: "folder", path: outcome.path };
    case "create": return { action: "create", path: outcome.path };
    default: return { action: outcome.action };
  }
}
function wanted(link: MarkdownLinkExpectation) {
  if (link.leadsTo !== null) return { action: "open", path: link.leadsTo, anchor: link.anchor };
  if (link.folder !== undefined) return { action: "folder", path: link.folder };
  if (link.creates !== undefined) return { action: "create", path: link.creates };
  return { action: "notFound" };
}

describe.each(MARKDOWN_LINK_CASES)("case $id: $shows", (linkCase: MarkdownLinkCase) => {
  it("a click opens the file, shows the folder, offers the note or says that nothing is there", async () => {
    const vault = await vaultOf(markdownCaseVault(linkCase));
    for (const link of linkCase.links) {
      const outcome = await planLinkOpen({ text: link.href, kind: "markdown", sourcePath: link.from }, vault.deps);
      expect({ link, does: done(outcome) }).toEqual({ link, does: wanted(link) });
    }
    await vault.db.close();
  });
});

describe("what a click does where the index knows nothing", () => {
  it("a file at the path the link names is opened from disk, and nobody guesses a name", async () => {
    const vault = await vaultOf(
      {
        "Projekte/Plan.md": "x\n",
        "Projekte/Ablage/Brief.md": "x\n",
        "Ablage/Wurzel.md": "x\n",
        "Archiv/Fern.md": "x\n",
        "Projekte/Liste/index.md": "x\n",
        "Projekte/Leer/Notiz.md": "x\n",
        ".plainva/drafts/Entwurf.md": "internal\n",
      },
      { index: false },
    );
    const click = async (href: string) => done(await planLinkOpen({ text: href, kind: "markdown", sourcePath: "Projekte/Plan.md" }, vault.deps));
    expect(await click("Ablage/Brief.md")).toEqual({ action: "open", path: "Projekte/Ablage/Brief.md" });
    expect(await click("Ablage/Brief")).toEqual({ action: "open", path: "Projekte/Ablage/Brief.md" });
    expect(await click("Ablage/Wurzel.md")).toEqual({ action: "open", path: "Ablage/Wurzel.md" });
    expect(await click("../Archiv/Fern.md#Teil")).toEqual({ action: "open", path: "Archiv/Fern.md", anchor: "#Teil" });
    expect(await click("Liste/")).toEqual({ action: "open", path: "Projekte/Liste/index.md" });
    expect(await click("Leer/")).toEqual({ action: "folder", path: "Projekte/Leer" });
    // A FOLDER at the place of a file is no file to open.
    expect(await click("Leer")).toEqual({ action: "create", path: "Projekte/Leer.md" });
    // "A file anywhere that is called so" is the index's to say: the disk is asked about paths.
    expect(await click("Fern.md")).toEqual({ action: "create", path: "Projekte/Fern.md" });
    expect(await click("Nirgends/Fern.md")).toEqual({ action: "notFound" });
    // The app's own folders are no link targets.
    expect(await click("../.plainva/drafts/Entwurf.md")).toEqual({ action: "notFound" });
    await vault.db.close();
  });
});

describe("what a link's text may hold", () => {
  it("angle brackets, a title and an anchor are read as the parser reads them", async () => {
    const vault = await vaultOf({ "Projekte/Plan.md": "x\n", "Projekte/Mein Brief.md": "## Absatz\n" });
    const click = async (text: string) => done(await planLinkOpen({ text, kind: "markdown", sourcePath: "Projekte/Plan.md" }, vault.deps));
    for (const text of ["Mein%20Brief.md", "<Mein Brief.md>", 'Mein%20Brief.md "Der Brief"', "Mein Brief.md", "  Mein%20Brief.md  "]) {
      expect({ text, does: await click(text) }).toEqual({ text, does: { action: "open", path: "Projekte/Mein Brief.md" } });
    }
    expect(await click("Mein%20Brief.md#Absatz")).toEqual({ action: "open", path: "Projekte/Mein Brief.md", anchor: "#Absatz" });
    // A place in this note, and a target for the system.
    expect(await planLinkOpen({ text: "#absatz", kind: "markdown", sourcePath: "Projekte/Plan.md" }, vault.deps)).toEqual({ action: "anchor", anchor: "#absatz" });
    expect(await planLinkOpen({ text: "mailto:jemand@example.org", kind: "markdown", sourcePath: "Projekte/Plan.md" }, vault.deps)).toEqual({ action: "external", url: "mailto:jemand@example.org" });
    // Another app's scheme is no address the system is handed (review 2026-10-22).
    expect(await planLinkOpen({ text: "obsidian://open?vault=x", kind: "markdown", sourcePath: "Projekte/Plan.md" }, vault.deps)).toEqual({ action: "notFound", target: "obsidian://open?vault=x" });
    await vault.db.close();
  });

  it("a table cell and a journal entry hand on the destination as it is written, and the URL it names", () => {
    const links = parseInlineMarkdown('[a](<Mein Brief.md>) [b](Brief.md "Der Brief") [c](https://example.org/x "T")').filter((node) => node.kind === "link");
    expect(links).toEqual([
      { kind: "link", href: "Mein Brief.md", written: "<Mein Brief.md>", label: "a", external: false },
      { kind: "link", href: "Brief.md", written: 'Brief.md "Der Brief"', label: "b", external: false },
      { kind: "link", href: "https://example.org/x", written: 'https://example.org/x "T"', label: "c", external: true },
    ]);
  });
});

describe("a wiki link through the same opener", () => {
  it("opens the note the rule names, offers one that is not there, and names a place in this note", async () => {
    const vault = await vaultOf({ "Projekte/Plan.md": "x\n", "Archiv/Brief.md": "## Absatz\n" });
    // A note the index has not taken in yet.
    await vault.adapter.writeTextFile("Projekte/Unsichtbar.md", "x\n");
    const click = (text: string, anchor?: string) => planLinkOpen({ text, kind: "wiki", sourcePath: "Projekte/Plan.md", anchor }, vault.deps);
    expect(await click("Brief")).toEqual({ action: "open", path: "Archiv/Brief.md", anchor: null });
    expect(await click("Brief#Absatz")).toEqual({ action: "open", path: "Archiv/Brief.md", anchor: "#Absatz" });
    expect(await click("Brief", "#Absatz")).toEqual({ action: "open", path: "Archiv/Brief.md", anchor: "#Absatz" });
    expect(await click("#Absatz")).toEqual({ action: "anchor", anchor: "#Absatz" });
    expect(await click("Neu")).toEqual({ action: "create", target: "Neu", path: "Projekte/Neu.md", title: "Neu" });
    expect(await click("Ablage/Neu")).toEqual({ action: "create", target: "Ablage/Neu", path: "Ablage/Neu.md", title: "Neu" });
    // There on disk: opened, not created a second time.
    expect(await click("Unsichtbar")).toEqual({ action: "open", path: "Projekte/Unsichtbar.md", anchor: null });
    // A path out of the vault names no place for a note.
    expect(await click("../../Draussen")).toEqual({ action: "notFound", target: "../../Draussen" });
    await vault.db.close();
  });
});

describe("a rename", () => {
  /** The vault after `from` was renamed to `to` through the shared plan, as both shells run it. */
  async function renamed(files: Record<string, string>, from: string, to: string) {
    const vault = await vaultOf(files);
    const { plan, failed } = await planLinkUpdates(vault.query, from, to);
    await vault.adapter.renameItem(from, to);
    const applied = await applyLinkUpdates(vault.adapter, plan);
    const after: Record<string, string> = {};
    for (const entry of await vault.adapter.listDir("", true)) if (!entry.isDirectory) after[entry.path] = await vault.adapter.readTextFile(entry.path);
    await vault.db.close();
    return { plan, failed: failed || applied.failed, renamedLinks: applied.renamedLinks, after };
  }
  /** Where the one Markdown link of `note` leads in a vault. */
  async function leads(files: Record<string, string>, note: string) {
    const vault = await vaultOf(files);
    const href = /\]\(([^)]*)\)/.exec(files[note])![1];
    const answer = await vault.query.resolveMarkdownLink(markdownLinkTarget(href).target, note);
    await vault.db.close();
    return answer;
  }

  it("changes only the name at the end of a Markdown link's path", async () => {
    const result = await renamed({ "Projekte/Plan.md": "* [x](Ablage/Brief.md) und *mehr*\n", "Projekte/Ablage/Brief.md": "x\n" }, "Projekte/Ablage/Brief.md", "Projekte/Ablage/Neu.md");
    // The vault path stood here: `Projekte/Ablage/Neu.md`, which reads `Projekte/Projekte/…` from the note.
    expect(result.after["Projekte/Plan.md"]).toBe("* [x](Ablage/Neu.md) und *mehr*\n");
    expect(await leads(result.after, "Projekte/Plan.md")).toEqual({ kind: "file", path: "Projekte/Ablage/Neu.md" });
    expect(result.failed).toBe(false);
  });

  it("leaves the entry of a listing alone when another note of that name is renamed", async () => {
    const files = { "Projekte/index.md": "* [Brief](Brief.md)\n", "Projekte/Brief.md": "x\n", "Brief.md": "x\n" };
    // The note at the ROOT: the listing's entry names the note beside it.
    const root = await renamed(files, "Brief.md", "Alt.md");
    expect(root.plan.sources).toEqual([]);
    expect(root.after["Projekte/index.md"]).toBe("* [Brief](Brief.md)\n");
    // The note BESIDE the listing: its entry follows.
    const beside = await renamed(files, "Projekte/Brief.md", "Projekte/Neu.md");
    expect(beside.after["Projekte/index.md"]).toBe("* [Brief](Neu.md)\n");
    expect(await leads(beside.after, "Projekte/index.md")).toEqual({ kind: "file", path: "Projekte/Neu.md" });
  });

  it("rewrites a wiki link and a Markdown link of one text each for the file it leads to", async () => {
    const files = { "Projekte/Plan.md": "[[Brief.md]] and [x](Brief.md)\n", "Projekte/Brief.md": "x\n", "Brief.md": "x\n" };
    const root = await renamed(files, "Brief.md", "Alt.md");
    expect(root.after["Projekte/Plan.md"]).toBe("[[Alt.md]] and [x](Brief.md)\n");
    expect(root.plan.sources).toEqual([{ path: "Projekte/Plan.md", body: [{ raw: "Brief.md", target: "Alt.md", kind: "wiki" }], frontmatter: [] }]);
    const beside = await renamed(files, "Projekte/Brief.md", "Projekte/Neu.md");
    expect(beside.after["Projekte/Plan.md"]).toBe("[[Brief.md]] and [x](Neu.md)\n");
  });

  it("keeps a link by the bare file name bare, and writes a path where the new name would lead elsewhere", async () => {
    const bare = await renamed({ "Projekte/Plan.md": "[x](Brief.md)\n", "Archiv/Brief.md": "x\n" }, "Archiv/Brief.md", "Archiv/Neu.md");
    expect(bare.after["Projekte/Plan.md"]).toBe("[x](Neu.md)\n");
    expect(await leads(bare.after, "Projekte/Plan.md")).toEqual({ kind: "file", path: "Archiv/Neu.md" });
    // A note called like the new name lies beside the linking note: the bare name would lead there.
    const taken = await renamed({ "Projekte/Plan.md": "[x](Brief.md)\n", "Archiv/Brief.md": "x\n", "Projekte/Neu.md": "x\n" }, "Archiv/Brief.md", "Archiv/Neu.md");
    expect(taken.after["Projekte/Plan.md"]).toBe("[x](../Archiv/Neu.md)\n");
    expect(await leads(taken.after, "Projekte/Plan.md")).toEqual({ kind: "file", path: "Archiv/Neu.md" });
  });

  it("follows every form a path is written in: from the root, explicit, without extension, to a folder", async () => {
    const files = {
      "Start.md": "[x](Projekte/Ablage/Brief.md)\n",
      "Projekte/Hoch.md": "[x](../Projekte/Ablage/Brief.md#Teil)\n",
      "Projekte/Ohne.md": "[x](Ablage/Brief)\n",
      "Projekte/Kodiert.md": "[x](Ablage/Mein%20Brief.md)\n",
      "Projekte/Ablage/Brief.md": "## Teil\n",
      "Projekte/Ablage/Mein Brief.md": "x\n",
    };
    const result = await renamed(files, "Projekte/Ablage/Brief.md", "Projekte/Ablage/Neuer Brief.md");
    expect(result.after["Start.md"]).toBe("[x](Projekte/Ablage/Neuer%20Brief.md)\n");
    expect(result.after["Projekte/Hoch.md"]).toBe("[x](../Projekte/Ablage/Neuer%20Brief.md#Teil)\n");
    expect(result.after["Projekte/Ohne.md"]).toBe("[x](Ablage/Neuer%20Brief)\n");
    // A link to another note of the folder is nobody's business.
    expect(result.after["Projekte/Kodiert.md"]).toBe("[x](Ablage/Mein%20Brief.md)\n");
    expect(result.renamedLinks).toBe(3);
    // A link to a FOLDER names the folder: a rename of its index.md leaves it,
    // and it shows the folder then (review 2026-10-22: `Ablage/` became a link
    // to the file, `..` the bare name of the note).
    const folder = await renamed({ "Projekte/Plan.md": "[x](Ablage/)\n", "Projekte/Ablage/Teil.md": "[up](..)\n", "Projekte/index.md": "x\n", "Projekte/Ablage/index.md": "x\n" }, "Projekte/Ablage/index.md", "Projekte/Ablage/Inhalt.md");
    expect(folder.after["Projekte/Plan.md"]).toBe("[x](Ablage/)\n");
    expect(await leads(folder.after, "Projekte/Plan.md")).toEqual({ kind: "folder", path: "Projekte/Ablage", index: null });
    const parent = await renamed({ "Projekte/Ablage/Teil.md": "[up](..)\n", "Projekte/index.md": "x\n" }, "Projekte/index.md", "Projekte/Inhalt.md");
    expect(parent.after["Projekte/Ablage/Teil.md"]).toBe("[up](..)\n");
    expect(parent.plan.sources).toEqual([]);
  });

  it("does not take a file queued for deletion for the one a link reaches", async () => {
    const vault = await vaultOf({ "Projekte/Plan.md": "[x](Brief.md)\n", "Archiv/Brief.md": "x\n", "Projekte/Brief.md": "x\n" });
    // Gone from the disk, its row waits for the sync to delete it in the cloud.
    await vault.adapter.deleteItem("Projekte/Brief.md");
    await vault.db.execute("UPDATE files SET is_deleted = 1 WHERE path = ?", ["Projekte/Brief.md"]);
    expect((await vault.query.getBacklinks("Archiv/Brief.md")).map((row) => row.source_path)).toEqual(["Projekte/Plan.md"]);
    const { plan } = await planLinkUpdates(vault.query, "Archiv/Brief.md", "Archiv/Neu.md");
    await vault.adapter.renameItem("Archiv/Brief.md", "Archiv/Neu.md");
    await applyLinkUpdates(vault.adapter, plan);
    expect(await vault.adapter.readTextFile("Projekte/Plan.md")).toBe("[x](Neu.md)\n");
    await vault.db.close();
  });

  it("a plan written before links carried their kind still means every link of the text", async () => {
    const adapter = new MemoryVaultAdapter(1_000);
    await adapter.writeTextFile("Plan.md", "[[Brief]] and [x](Brief)\n");
    const applied = await applyLinkUpdates(adapter, { oldPath: "Brief.md", newPath: "Neu.md", sources: [{ path: "Plan.md", body: [{ raw: "Brief", target: "Neu" }], frontmatter: [] }] });
    expect(await adapter.readTextFile("Plan.md")).toBe("[[Neu]] and [x](Neu)\n");
    expect(applied.renamedLinks).toBe(2);
  });
});

describe("the clean-up", () => {
  it("creates the note of a broken Markdown link where the link then finds it", async () => {
    const vault = await vaultOf({
      "Projekte/Plan.md": "[a](Ablage/Neu.md)\n",
      "Projekte/Hoch.md": "[b](../Eingang/Zettel)\n",
      "Projekte/Bild.md": "[c](img/shot.png)\n",
      "Projekte/Ordner.md": "[d](Nirgends/)\n",
      "Projekte/Wiki.md": "[[Ablage/Wiki]] and ![[Fehlt]]\n",
    });
    const broken = (await vault.graph.loadGraph()).broken;
    const of = (source: string) => broken.filter((link) => link.sourcePath === source);
    expect(of("Projekte/Plan.md").map(brokenLinkLabel)).toEqual(["[…](Ablage/Neu.md)"]);
    expect(of("Projekte/Wiki.md").map(brokenLinkLabel).sort()).toEqual(["![[Fehlt]]", "[[Ablage/Wiki]]"]);
    // The wiki link's place stood here for a Markdown link too: `Ablage/Neu.md` from the root.
    expect(brokenLinkNotePath(of("Projekte/Plan.md")[0])).toEqual({ path: "Projekte/Ablage/Neu.md", title: "Neu" });
    expect(brokenLinkNotePath(of("Projekte/Hoch.md")[0])).toEqual({ path: "Eingang/Zettel.md", title: "Zettel" });
    // A picture and a folder name no note: there is none to create (`img/shot.png.md` was).
    expect(brokenLinkNotePath(of("Projekte/Bild.md")[0])).toBeNull();
    expect(brokenLinkNotePath(of("Projekte/Ordner.md")[0])).toBeNull();
    // A wiki link keeps its place: at the path it names.
    expect(brokenLinkNotePath(of("Projekte/Wiki.md").find((link) => link.kind === "wikilink")!)).toEqual({ path: "Ablage/Wiki.md", title: "Wiki" });

    expect(await createBrokenLinkTarget(vault.adapter, vault.query, of("Projekte/Plan.md")[0], "Note")).toBe("Projekte/Ablage/Neu.md");
    expect(await createBrokenLinkTarget(vault.adapter, vault.query, of("Projekte/Bild.md")[0], "Note")).toBeNull();
    await vault.indexer.indexVaultFull();
    expect(await vault.query.resolveMarkdownLink("Ablage/Neu.md", "Projekte/Plan.md")).toEqual({ kind: "file", path: "Projekte/Ablage/Neu.md" });
    expect((await vault.graph.loadGraph()).broken.filter((link) => link.sourcePath === "Projekte/Plan.md")).toEqual([]);
    await vault.db.close();
  });

  it("a caller that knows only a link's text is a wiki link's", () => {
    expect(brokenLinkNotePath({ sourcePath: "Projekte/Plan.md", targetRaw: "Ablage/Brief#Kopf" })).toEqual({ path: "Ablage/Brief.md", title: "Brief" });
    expect(brokenLinkLabel({ sourcePath: "Projekte/Plan.md", targetRaw: "Brief" })).toBe("[[Brief]]");
  });
});

describe("removing the text links behind an edge", () => {
  it("removes wiki links, embeds and Markdown links of the note's text, and nothing in its properties or its code", async () => {
    const note = [
      "---",
      'project: "[[Ziel]]"',
      "related:",
      '  - "[[Ziel|gezeigt]]"',
      "---",
      "",
      "See [[Ziel]] and [[Ziel|the target]], ![[Ziel]] and [by path](Ziel.md) and [far](../Ziel.md#Teil).",
      "",
      "A `[[Ziel]]` in a code span stays, and [[Andere]] is another note's.",
      "",
      "```",
      "[[Ziel]] in a code block stays",
      "```",
      "",
    ].join("\n");
    const vault = await vaultOf({ "Projekte/Plan.md": note, "Ziel.md": "## Teil\n", "Andere.md": "x\n" });
    expect(await removeLinksTo(vault.adapter as never, vault.query, "Projekte/Plan.md", "Ziel.md")).toBe(5);
    expect(await vault.adapter.readTextFile("Projekte/Plan.md")).toBe(
      note.replace("See [[Ziel]] and [[Ziel|the target]], ![[Ziel]] and [by path](Ziel.md) and [far](../Ziel.md#Teil).", "See Ziel and the target, Ziel and by path and far."),
    );
    // Nothing left to remove: nothing is written, nothing counted.
    expect(await removeLinksTo(vault.adapter as never, vault.query, "Projekte/Plan.md", "Ziel.md")).toBe(0);
    await vault.db.close();
  });

  it("removes the Markdown link that leads there, not one of the same text that leads elsewhere", async () => {
    const vault = await vaultOf({ "Projekte/Plan.md": "[[Brief.md]] and [x](Brief.md)\n", "Projekte/Brief.md": "x\n", "Brief.md": "x\n" });
    expect(await removeLinksTo(vault.adapter as never, vault.query, "Projekte/Plan.md", "Projekte/Brief.md")).toBe(1);
    expect(await vault.adapter.readTextFile("Projekte/Plan.md")).toBe("[[Brief.md]] and x\n");
    await vault.db.close();
  });
});

describe("what an independent review of the change found (2026-10-22)", () => {
  it("hands only a web, mail or phone address to the system; any other scheme leads nowhere", async () => {
    const vault = await vaultOf({ "Plan.md": "x\n" });
    const click = (text: string) => planLinkOpen({ text, kind: "markdown", sourcePath: "Plan.md" }, vault.deps);
    for (const url of ["https://plainva.com/a?b=1", "mailto:hello@example.com", "tel:+4930123"]) expect(await click(url)).toEqual({ action: "external", url });
    // The phone hands what is not a web address to `window.open`; a synced
    // note or a guest's comment must never reach it with these.
    for (const url of ["javascript:alert(1)", "intent://x#Intent;end", "obsidian://open?vault=v", "file:///C:/x.md"]) {
      expect(await click(url)).toEqual({ action: "notFound", target: url });
    }
    await vault.db.close();
  });

  it("creates the note a Markdown link names with every character of its name, where the clean-up creates it too", async () => {
    const vault = await vaultOf({ "Projekte/Plan.md": "x\n" });
    const click = (text: string) => planLinkOpen({ text, kind: "markdown", sourcePath: "Projekte/Plan.md" }, vault.deps);
    // Read as a wiki target the name was cut at the `#`: `Draft.md`, `C.md`.
    expect(await click("Draft%20%231.md")).toEqual({ action: "create", target: "Draft #1.md", path: "Projekte/Draft #1.md", title: "Draft #1" });
    expect(await click("C%23%20Notes")).toEqual({ action: "create", target: "C# Notes", path: "Projekte/C# Notes.md", title: "C# Notes" });
    expect(brokenLinkNotePath({ sourcePath: "Projekte/Plan.md", targetRaw: "Draft #1.md", kind: "markdown-link" })).toEqual({ path: "Projekte/Draft #1.md", title: "Draft #1" });
    await vault.db.close();
  });

  it("reads the URL the reading view's parser already read as it stands", async () => {
    const vault = await vaultOf({ "Projekte/Plan.md": "x\n", "Projekte/Projekt 'Alpha'.md": "x\n", "Projekte/Projekt.md": "x\n" });
    // `[x](<Projekt 'Alpha'>)`: the parser hands the reading view `Projekt 'Alpha'`.
    const parsed = await planLinkOpen({ text: "Projekt 'Alpha'", kind: "markdown", sourcePath: "Projekte/Plan.md", parsed: true }, vault.deps);
    expect(done(parsed)).toEqual({ action: "open", path: "Projekte/Projekt 'Alpha'.md", anchor: undefined });
    // Read once more as written, the quoted end is a title: another note.
    const twice = await planLinkOpen({ text: "Projekt 'Alpha'", kind: "markdown", sourcePath: "Projekte/Plan.md" }, vault.deps);
    expect(done(twice)).toEqual({ action: "open", path: "Projekte/Projekt.md", anchor: undefined });
    await vault.db.close();
    // The reading view says so for every Markdown link it hands on.
    expect(sourceFile("apps/desktop/src/components/MarkdownReader.tsx")).toMatch(/parsed: kind === 'markdown'/);
  });

  it("both shells create the note at the place the opener names, not where a wiki target's reading would put it", () => {
    expect(sourceFile("apps/desktop/src/services/openLink.ts")).toMatch(/path: outcome\.path, title: outcome\.title/);
    expect(sourceFile("apps/desktop/src/AppShell.tsx")).toMatch(/d\.path && d\.title \? \{ path: d\.path, title: d\.title \} : wikiTargetToPath\(d\.target, d\.hostPath\)/);
    expect(sourceFile("apps/desktop/src/hooks/useAuxBridge.tsx")).toMatch(/d\.path && d\.title \? \{ path: d\.path, title: d\.title \} : undefined/);
    expect(sourceFile("apps/mobile/src/services/openLink.ts")).toMatch(/vaultOps\.createNoteAt\(vault, outcome\.path, outcome\.title\)/);
  });

  it("leaves an embed's name where its size stood, and takes a link in a Markdown link's label along", async () => {
    const vault = await vaultOf({
      "Plan.md": "![[photo.png|300]], ![[photo.png|a photo]] and [see [[Ziel]] here](Ziel.md)\n",
      "photo.png": "png",
      "Ziel.md": "x\n",
    });
    expect(await removeLinksTo(vault.adapter as never, vault.query, "Plan.md", "photo.png")).toBe(2);
    // `|300` is a size: the embed became "300".
    expect(await vault.adapter.readTextFile("Plan.md")).toBe("photo.png, a photo and [see [[Ziel]] here](Ziel.md)\n");
    // The outer link goes first and leaves its label; the link in it is the next pass's.
    expect(await removeLinksTo(vault.adapter as never, vault.query, "Plan.md", "Ziel.md")).toBe(2);
    expect(await vault.adapter.readTextFile("Plan.md")).toBe("photo.png, a photo and see Ziel here\n");
    await vault.db.close();
  });
});

describe("what a second review found (2026-10-22)", () => {
  it("keeps a table cell whole when a link in it goes: the bar of a cell is written `\\|`", async () => {
    const note = [
      "| A | B |",
      "| --- | --- |",
      "| ![[photo.png\\|300]] | [[Ziel\\|shown \\| text]] |",
      "|![[photo.png\\|300]]|b|",
      "",
    ].join("\n");
    const vault = await vaultOf({ "Plan.md": note, "photo.png": "png", "Ziel.md": "x\n" });
    expect(await removeLinksTo(vault.adapter as never, vault.query, "Plan.md", "photo.png")).toBe(2);
    expect(await removeLinksTo(vault.adapter as never, vault.query, "Plan.md", "Ziel.md")).toBe(1);
    // `photo.png\` stood in the first cell, and the compact row lost its second column.
    expect(await vault.adapter.readTextFile("Plan.md")).toBe(["| A | B |", "| --- | --- |", "| photo.png | shown \\| text |", "|photo.png|b|", ""].join("\n"));
    await vault.db.close();
  });

  it("writes the path to a folder's overview a rename makes, never a bare index.md", async () => {
    const files = { "Notizen/Start.md": "[Plan](Übersicht.md)\n", "Projekte/Liste.md": "[Plan](Übersicht.md)\n", "Projekte/Übersicht.md": "x\n" };
    const vault = await vaultOf(files);
    const { plan } = await planLinkUpdates(vault.query, "Projekte/Übersicht.md", "Projekte/index.md");
    await vault.adapter.renameItem("Projekte/Übersicht.md", "Projekte/index.md");
    await applyLinkUpdates(vault.adapter, plan);
    // `[Plan](index.md)` found the only overview - until Notizen/ got one.
    expect(await vault.adapter.readTextFile("Notizen/Start.md")).toBe("[Plan](../Projekte/index.md)\n");
    // From its own folder, the bare name is that folder's overview.
    expect(await vault.adapter.readTextFile("Projekte/Liste.md")).toBe("[Plan](index.md)\n");
    await vault.db.close();
  });

  it("creates a note with `.md` as the indexer reads it, whatever case the link wrote", async () => {
    const vault = await vaultOf({ "Projekte/Plan.md": "x\n" });
    // `Neu.MD` would be indexed as an attachment: no title, no links.
    expect(await planLinkOpen({ text: "Neu.MD", kind: "markdown", sourcePath: "Projekte/Plan.md" }, vault.deps)).toEqual({ action: "create", target: "Neu.MD", path: "Projekte/Neu.md", title: "Neu" });
    await vault.db.close();
  });

  it("reads a character reference in a destination as the parser and the index read it", async () => {
    const vault = await vaultOf({ "Projekte/Plan.md": "[x](Tom&amp;Jerry.md)\n", "Projekte/Tom&Jerry.md": "x\n" });
    // The index: a link to Tom&Jerry.md.
    expect((await vault.query.getBacklinks("Projekte/Tom&Jerry.md")).map((row) => row.source_path)).toEqual(["Projekte/Plan.md"]);
    // A click from the editor, a cell or the journal reads the same file, and offers no second note.
    expect(done(await planLinkOpen({ text: "Tom&amp;Jerry.md", kind: "markdown", sourcePath: "Projekte/Plan.md" }, vault.deps))).toEqual({ action: "open", path: "Projekte/Tom&Jerry.md", anchor: undefined });
    expect(parseInlineMarkdown("[x](Tom&amp;Jerry.md)")).toEqual([{ kind: "link", href: "Tom&Jerry.md", written: "Tom&amp;Jerry.md", label: "x", external: false }]);
    await vault.db.close();
  });

  it("hands a mail or phone address from the reading view to the one opener, as the editor does", () => {
    expect(["https://a.example", "http://a.example", "mailto:a@b.c", "tel:+491"].map(opensOutside)).toEqual([true, true, true, true]);
    expect(["javascript:alert(1)", "obsidian://x", "intent://x", "file:///x", "Brief.md", "C:/x.md"].map(opensOutside)).toEqual([false, false, false, false, false, false]);
    expect(sourceFile("apps/desktop/src/components/MarkdownReader.tsx")).toMatch(/!\/\^\[a-z\]\[a-z0-9\+\.-\]\*:\/i\.test\(href\) \|\| opensOutside\(href\)/);
  });
});

describe("the way a link is written reaches the one opener", () => {
  const shipped = shippedSources();

  it("no surface resolves a Markdown link by a reading of its own", () => {
    // The helpers of the old readings: the reading view's, the editor's test for "is this a path", the phone's candidates.
    const offenders = shipped.filter(({ text }) => /\b(planRelativeLinkOpen|isVaultPathLink|relativeLinkCandidates|resolveRelativeTarget)\b/.test(text)).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("no handler takes the kind of a link and drops it", () => {
    // `_kind?: "wiki" | "markdown"` was how the desktop's journal said it.
    const offenders = shipped.filter(({ text }) => /_kind\??:\s*"wiki"\s*\|\s*"markdown"/.test(text)).map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("every surface that shows a link hands it to its shell's opener", () => {
    for (const rel of [
      "apps/desktop/src/components/Editor.tsx",
      "apps/desktop/src/components/MarkdownReader.tsx",
      "apps/desktop/src/components/journal/JournalView.tsx",
      "apps/desktop/src/components/journal/JournalSidebarSection.tsx",
      "apps/desktop/src/components/base/useBaseCells.tsx",
      "apps/mobile/src/EditorHost.tsx",
      "apps/mobile/src/screens/NoteScreen.tsx",
      "apps/mobile/src/screens/JournalScreen.tsx",
      "apps/mobile/src/components/TodayJournalSection.tsx",
    ]) {
      expect({ rel, opens: /\bopenLink\(/.test(sourceFile(rel)) }).toEqual({ rel, opens: true });
    }
    // Both openers ask the one decision, and nothing else decides.
    for (const rel of ["apps/desktop/src/services/openLink.ts", "apps/mobile/src/services/openLink.ts"]) {
      expect({ rel, plans: /\bplanLinkOpen\(link, \{/.test(sourceFile(rel)) }).toEqual({ rel, plans: true });
    }
    // A table cell says how its link is written, like running text.
    expect(sourceFile("packages/ui/src/components/editorSession.ts")).toMatch(/onOpenNote: \(target, newTab, kind\) => deps\.current\.openWikiTarget\(target, newTab, kind === "wiki" \? "wiki" : "markdown"\)/);
  });

  it("the graph, the backlinks and a rename resolve a link row by the way it is written", () => {
    expect(sourceFile("packages/core/src/vault/GraphService.ts")).toMatch(/resolveMarkdownLinkIndexed\(source, targetPath, corpusIndex\)/);
    expect(sourceFile("packages/core/src/vault/VaultQueryService.ts")).toMatch(/resolveLinkRow\(link\.source_path, link\.target_path, link\.link_type, corpus\)/);
    expect(sourceFile("packages/ui/src/lib/renameNote.ts")).toMatch(/resolveLinkRow\(link\.source_path, link\.target_path, link\.property_key \? null : link\.link_type, byName\)/);
    expect(sourceFile("packages/ui/src/services/graphActions.ts")).toMatch(/resolveLinkRow\(sourcePath, link\.target, link\.type, corpus\)/);
  });
});
