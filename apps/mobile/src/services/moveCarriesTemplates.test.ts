// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { VaultIndexer, VaultQueryService, type IDatabaseAdapter } from "@plainva/core";
import { carryTemplateAssignments, errorText, landedAtDestination, MoveBlockedError, moveItemName, parseTemplateForTargets } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import type { MobileVault } from "./vaultService";

/**
 * A database that changes its path on the phone takes its template
 * assignments (`plainva.templateFor`) along (open-items plan 3.71 no. 4).
 *
 * The phone carried none: a template the desktop had assigned to
 * `[[Projects/Tasks.base]]` named a file that was no longer there once the
 * folder was renamed or moved on the phone. This runs the phone's own
 * `moveFolder` and `moveNote`, read from their source as
 * `renameLinkBytes.test.ts` does (the module pulls in the native plugins),
 * over real files and a real index; what surrounds a move on a device is
 * replaced.
 */

const serviceSource = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const serviceFile = ts.createSourceFile("vaultService.ts", serviceSource, ts.ScriptTarget.Latest, true);
const functions = ["flushBeforeMove", "moveStep", "reportFollowUp", "carryTemplatesAfterMove"];
const methods = ["moveFolder", "moveNote"];
const found = { functions: [] as string[], methods: [] as string[] };
(function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && functions.includes(node.name.text)) found.functions.push(node.getText(serviceFile));
  if (ts.isMethodDeclaration(node) && methods.includes(node.name.getText(serviceFile))) found.methods.push(node.getText(serviceFile));
  ts.forEachChild(node, visit);
})(serviceFile);
if (found.functions.length !== functions.length || found.methods.length !== methods.length) throw new Error("the phone's move moved — re-point this harness");
const compiled = ts.transpileModule(found.functions.join("\n") + "\nconst vaultOps = {" + found.methods.join(",\n") + "};\n", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

interface Phone {
  moveFolder(v: MobileVault, oldPath: string, newPath: string): Promise<void>;
  moveNote(v: MobileVault, path: string, targetFolder: string): Promise<string>;
}

const TEMPLATE = '---\nplainva:\n  templateFor: "[[Projects/Tasks.base]]"\n---\n# {{title}}\n';
let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, vault: MobileVault, phone: Phone, warnings: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-phone-move-templates-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
  const indexer = new VaultIndexer(raw, db);
  const query = new VaultQueryService(db);
  const reindexPaths = async (paths: readonly string[]) => {
    for (const path of paths) await indexer.indexFile(await raw.getFileInfo(path)).catch(() => {});
  };
  vault = { vaultId: "vault-a", adapter: raw, files: raw, db, indexer, queryService: query, reindexPaths } as unknown as MobileVault;
  warnings = [];
  const deps = {
    errorText, landedAtDestination, MoveBlockedError, moveItemName, carryTemplateAssignments,
    noteSaver: { flush: async () => {}, flushAll: async () => {} },
    awaitWholeIndex: async () => {},
    sweepPinboardRefs: async () => [] as string[],
    getMobileSettings: () => ({ templateFolder: "Templates" }),
    renameBookmarksOnDisk: async () => {},
    relocateDrafts: async () => {},
    notifyFileOps: () => {},
    toast: { error: (text: string) => { warnings.push(text); }, warning: (text: string) => { warnings.push(text); } },
    i18n: { t: (key: string) => key },
    window, CustomEvent, console: { error: () => {}, warn: () => {} },
  };
  phone = (new Function(...Object.keys(deps), `${compiled}\nreturn vaultOps;`)(...Object.values(deps))) as Phone;
  await raw.writeTextFile("Templates/Task.md", TEMPLATE);
  await raw.writeTextFile("Projects/Tasks.base", "views: []\n");
  await raw.writeTextFile("Projects/Note.md", "# Note\n");
  await indexer.indexVaultFull();
});
afterEach(async () => {
  await db.close();
  await rm(root, { recursive: true, force: true });
});

const assigned = async () => parseTemplateForTargets(await readFile(join(root, "Templates/Task.md"), "utf8"));

describe("a database that changes its path on the phone (3.71 no. 4)", () => {
  it("renaming or moving its folder takes the template assignment along", async () => {
    await phone.moveFolder(vault, "Projects", "Areas/Work");
    expect(await assigned()).toEqual(["Areas/Work/Tasks.base"]);
    expect(warnings).toEqual([]);
  });

  it("a moved database file takes it along too", async () => {
    await raw.createDir("Archive");
    await phone.moveNote(vault, "Projects/Tasks.base", "Archive");
    expect(await assigned()).toEqual(["Archive/Tasks.base"]);
  });

  it("a note that moves leaves the template alone", async () => {
    await raw.createDir("Archive");
    await phone.moveNote(vault, "Projects/Note.md", "Archive");
    expect(await readFile(join(root, "Templates/Task.md"), "utf8")).toBe(TEMPLATE);
  });
});
