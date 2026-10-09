import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { isInternalPath, linkTargetName, resolveLinkTarget, VaultIndexer, VaultQueryService } from "@plainva/core";
import { relativeLinkCandidates } from "@plainva/ui";
import { LINK_CASES, type LinkCase } from "../../../../packages/core/test/helpers/linkCases";
import { MemoryVaultAdapter } from "../../../../packages/core/test/helpers/memoryVault";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import type { MobileVault } from "./vaultService";

/**
 * Where a tap on a link leads on the phone (finding 2026-10-08).
 *
 * The phone used to follow a wiki link by a rule of its own — a path from the
 * note, a path from the vault's root, then the first note of that FILE NAME in
 * the directory listing — while the desktop asked the index for a note's title.
 * So `[[Brief]]` opened a note on the phone that the desktop offered to create
 * a second time, and `[[Angebotsbrief]]` did the reverse.
 *
 * This runs the phone's OWN method, read from its source (the module pulls in
 * the native plugins and cannot be imported here; `saveRecovery.test.ts` reads
 * its methods the same way), against the cases the core and the desktop
 * answer: `packages/core/test/helpers/linkCases.ts`.
 */

const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const file = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
let method = "";
function visit(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(file) === "resolveWikiTarget") method = node.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
if (!method) throw new Error("vaultOps.resolveWikiTarget is missing from vaultService.ts");
const compiled = ts.transpileModule(`const vaultOps = {${method}};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

type Resolve = (v: MobileVault, target: string, hostPath?: string, kind?: "wiki" | "markdown") => Promise<string | null>;
/** Everything the method reaches for outside itself — the shared pieces, nothing of the phone's own. */
const deps = { relativeLinkCandidates, resolveLinkTarget, linkTargetName, isInternalPath };
const resolveWikiTarget: Resolve = (new Function(...Object.keys(deps), `${compiled}\nreturn vaultOps;`)(...Object.values(deps)) as { resolveWikiTarget: Resolve }).resolveWikiTarget;

/** A vault as the phone holds it: the files, and the index the shared indexer built over them. */
async function phoneVault(files: Record<string, string>, opts: { index?: boolean } = {}) {
  const db = await realSqlite();
  const adapter = new MemoryVaultAdapter(1_000);
  for (const [path, text] of Object.entries(files)) await adapter.writeTextFile(path, text);
  const indexer = new VaultIndexer(adapter, db);
  if (opts.index !== false) await indexer.indexVaultFull();
  const vault = { vaultId: "fixture", files: adapter, db, queryService: opts.index === false ? null : new VaultQueryService(db) } as unknown as MobileVault;
  return { vault, adapter, db };
}

describe.each(LINK_CASES)("case $id: $shows", (linkCase: LinkCase) => {
  it("a tap opens the file the desktop opens", async () => {
    const { vault, db } = await phoneVault(linkCase.files);
    const answers = [];
    for (const link of linkCase.links) answers.push({ ...link, leadsTo: await resolveWikiTarget(vault, link.target, link.from, "wiki") });
    expect(answers).toEqual(linkCase.links);
    await db.close();
  });

  it("without an index the same rule reads the files on disk — a title is all it cannot know", async () => {
    const { vault, db } = await phoneVault(linkCase.files, { index: false });
    for (const link of linkCase.links) {
      const byTitleOnly = linkCase.id === "b";
      expect({ link, leadsTo: await resolveWikiTarget(vault, link.target, link.from, "wiki") }).toEqual({ link, leadsTo: byTitleOnly ? null : link.leadsTo });
    }
    await db.close();
  });
});

describe("what the phone adds around the rule", () => {
  it("a note the index has not seen yet is found on disk instead of being created a second time", async () => {
    const { vault, adapter, db } = await phoneVault({ "Start.md": "[[Neu]]\n" });
    await adapter.writeTextFile("Eingang/Neu.md", "Just written; the index follows a save by one pass.\n");
    expect(await resolveWikiTarget(vault, "Neu", "Start.md", "wiki")).toBe("Eingang/Neu.md");
    await db.close();
  });

  it("the app's own folders are no link targets", async () => {
    const { vault, db } = await phoneVault({ "Start.md": "[[Entwurf]]\n", ".plainva/drafts/Entwurf.md": "internal\n", ".trash/Entwurf.md": "deleted\n" });
    expect(await resolveWikiTarget(vault, "Entwurf", "Start.md", "wiki")).toBeNull();
    await db.close();
  });

  it("a Markdown link names a path: it is read from the note first, a wiki link of the same text is a name", async () => {
    const { vault, db } = await phoneVault({
      "Brief.md": "The letter at the root.\n",
      "Projekte/Brief.md": "The letter of the project.\n",
      "Projekte/Plan.md": "[the letter](Brief.md) and [[Brief]]\n",
    });
    expect(await resolveWikiTarget(vault, "Brief.md", "Projekte/Plan.md", "markdown")).toBe("Projekte/Brief.md");
    expect(await resolveWikiTarget(vault, "Brief", "Projekte/Plan.md", "wiki")).toBe("Brief.md");
    await db.close();
  });

  it("a Markdown link whose path leads nowhere leads nowhere — also where a file elsewhere ends alike", async () => {
    // "A file anywhere in the vault that ends so" is a wiki link's reading. The
    // rule must not lend it to a Markdown link: the desktop reads such a link
    // as a path and says "not found", and so did the phone before the rule.
    const { vault, db } = await phoneVault({
      "Projekte/Plan.md": "[the plan](Ablage/Plan.md), [a shot](img/shot.png), [the letter](Brief.md), [[Ablage/Plan]] and [the letter](Brief)\n",
      "Archiv/Ablage/Plan.md": "An old plan.\n",
      "Archiv/img/shot.png": "PNG\n",
      "Archiv/Brief.md": "An old letter.\n",
    });
    expect(await resolveWikiTarget(vault, "Ablage/Plan.md", "Projekte/Plan.md", "markdown")).toBeNull();
    expect(await resolveWikiTarget(vault, "img/shot.png", "Projekte/Plan.md", "markdown")).toBeNull();
    expect(await resolveWikiTarget(vault, "Brief.md", "Projekte/Plan.md", "markdown")).toBeNull();
    // The wiki link of the same text is a name, and finds the file by the end of its path.
    expect(await resolveWikiTarget(vault, "Ablage/Plan", "Projekte/Plan.md", "wiki")).toBe("Archiv/Ablage/Plan.md");
    // A bare name in a Markdown link has no path to read: it is found by name, as it always was.
    expect(await resolveWikiTarget(vault, "Brief", "Projekte/Plan.md", "markdown")).toBe("Archiv/Brief.md");
    await db.close();
  });

  it("an anchor or an alias left on the target does not change where it leads", async () => {
    const { vault, db } = await phoneVault({ "Start.md": "[[Brief#Absatz|der Brief]]\n", "Projekte/Brief.md": "## Absatz\n" });
    expect(await resolveWikiTarget(vault, "Brief#Absatz", "Start.md", "wiki")).toBe("Projekte/Brief.md");
    expect(await resolveWikiTarget(vault, "Brief|der Brief", "Start.md", "wiki")).toBe("Projekte/Brief.md");
    expect(await resolveWikiTarget(vault, "  ", "Start.md", "wiki")).toBeNull();
    await db.close();
  });
});
