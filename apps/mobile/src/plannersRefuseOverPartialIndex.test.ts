// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { buildingIndexReader, isIndexNotWholeError, toPathIdentity, type IVaultAdapter, type VaultQueryService } from "@plainva/core";
import { errorText, MoveBlockedError, moveItemName, toast, wikiTargetToPath } from "@plainva/ui";
import type { MobileVault } from "./services/vaultService";

/**
 * The phone's planners refuse over an index that is not whole, and write
 * nothing (third review of 11.11., performance plan L3). The shared planners
 * and the desktop's own are in `apps/desktop/src/plannersRefuseOverPartialIndex.test.ts`.
 *
 * Each test hands the planner `buildingIndexReader` (core): every read of the
 * index rejects with `IndexNotWholeError`, `requireWholeIndex()` throws it.
 * The files are a recording adapter that notes every write method.
 */

// What the modules of the phone pull in from the device is replaced; the planners are the real ones.
const created = vi.hoisted(() => [] as string[]);
vi.mock("./services/vaultService", () => ({
  noteSaver: { flush: async () => {}, flushAll: async () => {} },
  vaultOps: {
    resolveWikiTarget: async (_v: unknown, target: string) => (target === "Known" ? "Notes/Known.md" : null),
    resolveMarkdownLink: async () => null,
    createNoteAt: async (_v: unknown, path: string) => { created.push(path); return path; },
  },
}));
vi.mock("./services/mobileSettings", () => ({
  getVaultSettings: async () => ({ templateFolder: "Templates" }),
  getMobileSettings: () => ({ askBeforeCreateLink: false }),
}));
vi.mock("./services/okfJournal", () => ({ clearOkfJournal: vi.fn(), readOkfJournal: vi.fn(), writeOkfJournal: vi.fn() }));
vi.mock("./services/mobileDialogs", () => ({ mConfirm: vi.fn(async () => true), mPrompt: vi.fn(), mSelect: vi.fn() }));

const writes: string[] = [];
const dbReads: string[] = [];
beforeEach(() => {
  writes.length = 0;
  dbReads.length = 0;
  created.length = 0;
});

function building(): VaultQueryService {
  return buildingIndexReader({
    getBacklinks: async () => [],
    listNotes: async () => [],
    linkTargets: async () => [],
    linksNamingFile: async () => [],
    resolveNotePath: async () => null,
    listBaseFilePaths: async () => [],
    queryDatabaseFiles: async () => [],
    getIncomingRelationRefs: async () => new Map(),
    getFileProperties: async () => ({}),
    db: { query: async () => { dbReads.push("query"); return []; } },
  }) as unknown as VaultQueryService;
}

function recorder(): IVaultAdapter {
  const record = (method: string) => async (...args: unknown[]) => { writes.push(`${method} ${String(args[0])}`); };
  return {
    exists: async () => false,
    readTextFile: async (path: string) => { throw new Error(`missing ${path}`); },
    readBinaryFile: async (path: string) => { throw new Error(`missing ${path}`); },
    listDir: async () => [],
    getFileInfo: async (path: string) => { throw new Error(`missing ${path}`); },
    writeTextFile: record("writeTextFile"),
    writeBinaryFile: record("writeBinaryFile"),
    renameItem: record("renameItem"),
    deleteItem: record("deleteItem"),
    createDir: record("createDir"),
    updateTextFile: record("updateTextFile"),
    writeTextFileChange: record("writeTextFileChange"),
    writeEditorText: record("writeEditorText"),
  } as unknown as IVaultAdapter;
}

/** A vault of the phone whose index is still being built. */
function buildingVault(): MobileVault {
  return { vaultId: "vault-a", files: recorder(), adapter: recorder(), belowChain: recorder(), queryService: building(), indexer: null } as unknown as MobileVault;
}

async function expectRefused(run: () => Promise<unknown> | unknown): Promise<void> {
  const refused = await Promise.resolve().then(run).then(() => null, (e: unknown) => e ?? new Error("rejected with nothing"));
  expect(refused, "it must refuse").not.toBeNull();
  expect(isIndexNotWholeError(refused), `refused with ${String(refused)}`).toBe(true);
  expect(writes).toEqual([]);
  expect(dbReads).toEqual([]);
}

describe("the phone's OKF, deletion and link planners refuse over an index that is not whole", () => {
  it("okfConversion: scanVaultOkf refuses before the list of notes is read", async () => {
    const { scanVaultOkf } = await import("./services/okfConversion");
    await expectRefused(() => scanVaultOkf(buildingVault()));
  });

  it("okfMigration: scanVaultOkfVersion refuses before the candidates are read", async () => {
    const { scanVaultOkfVersion } = await import("./services/okfMigration");
    await expectRefused(() => scanVaultOkfVersion(buildingVault()));
  });

  it("cascadeDelete: buildMobileDeletionPlan refuses for a note and for a database, before anything is read", async () => {
    const { buildMobileDeletionPlan } = await import("./services/cascadeDelete");
    const vault = buildingVault();
    await expectRefused(() => buildMobileDeletionPlan(vault, ["Note.md"]));
    await expectRefused(() => buildMobileDeletionPlan(vault, ["Tasks.base"]));
  });

  it("openLink: a note is not created for a link, a note that exists opens", async () => {
    const { openLink } = await import("./services/openLink");
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => undefined as never);
    const opened: string[] = [];
    const vault = buildingVault();
    for (const link of [
      { kind: "wiki" as const, text: "Brand New", sourcePath: "a.md" },
      { kind: "markdown" as const, text: "Brand%20New.md", sourcePath: "a.md" },
    ]) {
      await openLink(link, { vault, onOpenNote: (path) => opened.push(path) });
    }
    expect(created).toEqual([]);
    expect(opened).toEqual([]);
    expect(warning).toHaveBeenCalledTimes(2);
    expect(writes).toEqual([]);

    await openLink({ kind: "wiki", text: "Known", sourcePath: "a.md" }, { vault, onOpenNote: (path) => opened.push(path) });
    expect(opened).toEqual(["Notes/Known.md"]);
    expect(created).toEqual([]);
    warning.mockRestore();
  });
});

/**
 * The phone's vault operations (`vaultOps` in services/vaultService.ts) pull
 * in the native plugins and cannot be imported in a test, so — as
 * `renameLinkBytes.test.ts` does — the methods are read from the source and
 * run with what surrounds them stubbed. The four that call
 * `requireWholeIndex()` are named below; the harness fails when one moved.
 */
const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const sourceFile = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
const helperNames = ["flushBeforeMove", "moveStep"];
const methodNames = ["renameReport", "moveFolder", "moveNote", "createNoteFromWikiTarget"];
const found = { helpers: [] as string[], methods: [] as string[] };
(function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && helperNames.includes(node.name.text)) found.helpers.push(node.getText(sourceFile));
  if (ts.isMethodDeclaration(node) && methodNames.includes(node.name.getText(sourceFile))) found.methods.push(node.getText(sourceFile));
  ts.forEachChild(node, visit);
})(sourceFile);
if (found.helpers.length !== helperNames.length || found.methods.length !== methodNames.length) throw new Error("the phone's vault operations moved — re-point this harness");
const compiled = ts.transpileModule(`${found.helpers.join("\n")}\nconst vaultOps = {${found.methods.join(",\n")}};\n`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

interface Operations {
  renameReport(v: MobileVault, oldPath: string, newTitle: string): Promise<unknown>;
  moveFolder(v: MobileVault, oldPath: string, newPath: string): Promise<void>;
  moveNote(v: MobileVault, path: string, targetFolder: string): Promise<string>;
  createNoteFromWikiTarget(v: MobileVault, target: string, hostPath?: string): Promise<string | null>;
}

function operations(): { ops: Operations; flushed: string[]; notes: string[] } {
  const flushed: string[] = [];
  const notes: string[] = [];
  const deps = {
    toPathIdentity, errorText, MoveBlockedError, moveItemName, wikiTargetToPath,
    noteSaver: { flush: async (path: string) => { flushed.push(path); }, flushAll: async () => { flushed.push("*"); } },
    toast: { error: (text: string) => { notes.push(text); }, warning: (text: string) => { notes.push(text); }, success: () => {} },
    i18n: { t: (key: string) => key },
    console: { error: () => {}, warn: () => {} },
  };
  const ops = new Function(...Object.keys(deps), `${compiled}\nreturn vaultOps;`)(...Object.values(deps)) as Operations;
  return { ops, flushed, notes };
}

describe("the phone's vault operations refuse over an index that is not whole, before anything moves", () => {
  it.each<[string, (ops: Operations, v: MobileVault) => Promise<unknown>]>([
    ["vaultOps.renameReport (rename a note)", (ops, v) => ops.renameReport(v, "Old.md", "New")],
    ["vaultOps.moveFolder (rename or move a folder)", (ops, v) => ops.moveFolder(v, "Old", "New")],
    ["vaultOps.moveNote (move to a folder)", (ops, v) => ops.moveNote(v, "Old.md", "Sub")],
    ["vaultOps.createNoteFromWikiTarget (a note for a link)", (ops, v) => ops.createNoteFromWikiTarget(v, "Brand New", "a.md")],
  ])("%s", async (_name, run) => {
    const { ops, notes } = operations();
    const vault = buildingVault();
    await expectRefused(() => run(ops, vault));
    expect(notes).toEqual([]);
  });
});
