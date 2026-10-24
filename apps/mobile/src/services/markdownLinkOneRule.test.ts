import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { buildLinkTargetIndex, isInternalPath, linkTargetName, markdownLinkTarget, resolveLinkTarget, resolveMarkdownLinkIndexed, VaultIndexer, VaultQueryService, type MarkdownLinkAnswer } from "@plainva/core";
import { MARKDOWN_LINK_CASES, markdownCaseVault, type MarkdownLinkCase, type MarkdownLinkExpectation } from "../../../../packages/core/test/helpers/markdownLinkCases";
import { MemoryVaultAdapter } from "../../../../packages/core/test/helpers/memoryVault";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import type { MobileVault } from "./vaultService";

/**
 * Where a tap on a Markdown link leads on the phone (finding 2026-10-09,
 * recorded 2026-10-12).
 *
 * The phone used to try the linking note's folder and the vault's root on
 * disk and stop there: `[Letter](Letter.md)` for a note in a third folder led
 * nowhere, and the tap went on to create a second `Letter.md` beside the
 * linking note, where the desktop's editor opened the real one. It filled in
 * `.base`, folded a path that climbed out of the vault back into it, and
 * handed a folder on as if it were a note.
 *
 * This runs the phone's OWN methods, read from their source (the module pulls
 * in the native plugins and cannot be imported here; `wikiLinkOneRule.test.ts`
 * reads them the same way), against the cases the core and the desktop
 * answer: `packages/core/test/helpers/markdownLinkCases.ts`.
 */

const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const file = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
const methods: string[] = [];
function visit(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && ["resolveMarkdownLink", "resolveWikiTarget"].includes(node.name.getText(file))) methods.push(node.getText(file));
  ts.forEachChild(node, visit);
}
visit(file);
if (methods.length !== 2) throw new Error("vaultOps.resolveMarkdownLink or vaultOps.resolveWikiTarget is missing from vaultService.ts");
const compiled = ts.transpileModule(`const vaultOps = {${methods.join(",\n")}};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

interface PhoneLinkRule {
  resolveMarkdownLink: (v: MobileVault, target: string, hostPath?: string) => Promise<MarkdownLinkAnswer>;
  resolveWikiTarget: (v: MobileVault, target: string, hostPath?: string, kind?: "wiki" | "markdown") => Promise<string | null>;
}
/** Everything the methods reach for outside themselves — the shared pieces, nothing of the phone's own. */
const deps = { buildLinkTargetIndex, isInternalPath, linkTargetName, markdownLinkTarget, resolveLinkTarget, resolveMarkdownLinkIndexed };
const phone = new Function(...Object.keys(deps), `${compiled}\nreturn vaultOps;`)(...Object.values(deps)) as PhoneLinkRule;

/** A vault as the phone holds it: the files, and the index the shared indexer built over them. */
async function phoneVault(files: Record<string, string>, opts: { index?: boolean } = {}) {
  const db = await realSqlite();
  const adapter = new MemoryVaultAdapter(1_000);
  for (const [path, text] of Object.entries(files)) await adapter.writeTextFile(path, text);
  if (opts.index !== false) await new VaultIndexer(adapter, db).indexVaultFull();
  const vault = { vaultId: "fixture", files: adapter, db, queryService: opts.index === false ? null : new VaultQueryService(db) } as unknown as MobileVault;
  return { vault, adapter, db };
}

function answered(link: MarkdownLinkExpectation, answer: MarkdownLinkAnswer) {
  const leadsTo = answer === null ? null : answer.kind === "file" ? answer.path : answer.index;
  const folder = answer !== null && answer.kind === "folder" && answer.index === null ? answer.path : undefined;
  return { from: link.from, href: link.href, leadsTo, folder };
}
const expected = (link: MarkdownLinkExpectation) => ({ from: link.from, href: link.href, leadsTo: link.leadsTo, folder: link.folder });

describe.each(MARKDOWN_LINK_CASES)("case $id: $shows", (linkCase: MarkdownLinkCase) => {
  it("a tap leads where a click on the desktop leads", async () => {
    const { vault, db } = await phoneVault(markdownCaseVault(linkCase));
    for (const link of linkCase.links) {
      const target = markdownLinkTarget(link.href).target;
      expect(answered(link, await phone.resolveMarkdownLink(vault, target, link.from))).toEqual(expected(link));
      // The older entrance, which the AI harness calls: the file a Markdown link leads to.
      expect({ link, leadsTo: await phone.resolveWikiTarget(vault, link.href, link.from, "markdown") }).toEqual({ link, leadsTo: link.leadsTo });
    }
    await db.close();
  });

  it("without an index the same rule reads the files on disk — a title is all it cannot know", async () => {
    const { vault, db } = await phoneVault(markdownCaseVault(linkCase), { index: false });
    for (const link of linkCase.links) {
      const byTitleOnly = linkCase.id === "title";
      const target = markdownLinkTarget(link.href).target;
      expect(answered(link, await phone.resolveMarkdownLink(vault, target, link.from))).toEqual(byTitleOnly ? { ...expected(link), leadsTo: null } : expected(link));
    }
    await db.close();
  });
});

describe("what the phone adds around the rule", () => {
  it("a file the index has not seen yet is found on disk instead of being reported missing", async () => {
    const { vault, adapter, db } = await phoneVault({ "Projekte/Plan.md": "[x](Ablage/Neu.md)\n" });
    await adapter.writeTextFile("Projekte/Ablage/Neu.md", "Just written; the index follows a save by one pass.\n");
    expect(await phone.resolveMarkdownLink(vault, "Ablage/Neu.md", "Projekte/Plan.md")).toEqual({ kind: "file", path: "Projekte/Ablage/Neu.md" });
    await db.close();
  });

  it("the app's own folders are no link targets", async () => {
    const { vault, db } = await phoneVault({ "Start.md": "[x](Entwurf.md)\n", ".plainva/drafts/Entwurf.md": "internal\n", ".trash/Entwurf.md": "deleted\n" });
    expect(await phone.resolveMarkdownLink(vault, "Entwurf.md", "Start.md")).toBeNull();
    expect(await phone.resolveMarkdownLink(vault, ".plainva/drafts/Entwurf.md", "Start.md")).toBeNull();
    await db.close();
  });

  // A caller that cannot say how its link is written gets what it always got
  // (two reviews, 2026-10-22): a name without a folder and without `.md` or
  // `.base` is the wiki rule's; any other target is read from the note first.
  it("a caller that cannot say how the link is written: a plain name by the wiki rule, anything else from the note first", async () => {
    const { vault, db } = await phoneVault({
      "Brief.md": "The letter at the root.\n",
      "Projekte/Brief.md": "The letter of the project.\n",
      "Projekte/Plan.md": "x\n",
      "Projekte/Sub/Akte.md": "x\n",
      "Sub/Akte.md": "x\n",
      "Archiv/Angebot.md": "---\ntitle: Das Angebot\n---\n",
    });
    // A plain name names the note at the root, as a wiki link does …
    expect(await phone.resolveWikiTarget(vault, "Brief", "Projekte/Plan.md")).toBe("Brief.md");
    expect(await phone.resolveWikiTarget(vault, "Brief.md", "Projekte/Plan.md", "wiki")).toBe("Brief.md");
    // … a name with `.md` is read from the note, as main read it and as a Markdown link is.
    expect(await phone.resolveWikiTarget(vault, "Brief.md", "Projekte/Plan.md")).toBe("Projekte/Brief.md");
    expect(await phone.resolveWikiTarget(vault, "Brief.md|der Brief", "Projekte/Plan.md")).toBe("Projekte/Brief.md");
    expect(await phone.resolveWikiTarget(vault, "Brief.md", "Projekte/Plan.md", "markdown")).toBe("Projekte/Brief.md");
    // A path is read from the note first.
    expect(await phone.resolveWikiTarget(vault, "Sub/Akte.md", "Projekte/Plan.md")).toBe("Projekte/Sub/Akte.md");
    expect(await phone.resolveWikiTarget(vault, "Sub/Akte", "Projekte/Plan.md", "wiki")).toBe("Sub/Akte.md");
    // An alias behind a bar is a wiki link's.
    expect(await phone.resolveWikiTarget(vault, "Angebot|das Angebot", "Projekte/Plan.md")).toBe("Archiv/Angebot.md");
    expect(await phone.resolveWikiTarget(vault, "Angebot|das Angebot", "Projekte/Plan.md", "markdown")).toBeNull();
    await db.close();
  });
});
