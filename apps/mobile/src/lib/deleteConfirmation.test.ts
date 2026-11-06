// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type { MobileVault } from "../services/vaultService";
import { SnapshotBeforeDeleteError, deleteWithSafetyNet, type DeletionConfirmation } from "@plainva/core";

type Confirmation = { confirmed: true };
type Operation = (v: MobileVault, path: string, confirmation?: Confirmation) => Promise<void>;
const fixture = vi.hoisted(() => ({
  answer: true,
  /** The answer to "Delete without a backup?" (D1). */
  noNet: false,
  asked: 0,
  /** Refuse every deletion without `withoutSnapshot` as one without a net. */
  refuse: false,
  order: [] as string[],
  deleted: [] as unknown[][],
  operations: null as Record<string, Operation> | null,
}));
vi.mock("@plainva/ui", () => ({
  initialSelection: () => ({}), isBasePath: () => false, isLargeDeletion: () => false,
  noteDisplayName: (p: string) => p, planNeedsDialog: () => false, selectedPaths: () => [],
}));
vi.mock("../services/mobileDialogs", () => ({ mConfirm: async () => fixture.answer, mCascade: async () => null }));
vi.mock("../services/cascadeDelete", () => ({ buildMobileDeletionPlan: async () => null, executeMobileCascade: vi.fn() }));
vi.mock("./folderDeletion", () => ({ countVaultFiles: async () => 20 }));
vi.mock("../services/vaultService", () => ({
  vaultOps: {
    remove: (...args: Parameters<Operation>) => fixture.operations!.remove(...args),
    removeFolder: (...args: Parameters<Operation>) => fixture.operations!.removeFolder(...args),
  },
}));
import { confirmDeleteFile, confirmDeleteFiles } from "./deleteFile";

// Execute the original vaultOps methods without initializing a native vault or
// its unrelated background services. The dialog functions above are imported
// unchanged; only the OS boundary and user answer are controlled here.
const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const file = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
const methods: string[] = [];
function walk(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && ["remove", "removeFolder"].includes(node.name.getText(file))) methods.push(node.getText(file));
  ts.forEachChild(node, walk);
}
walk(file);
if (methods.length !== 2) throw new Error("Could not locate the original mobile deletion methods");
const compiled = ts.transpileModule(`const operations = { ${methods.join(",")}, async removeBookmark() {} };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
// The shared `deleteWithNet` as packages/ui has it, with the phone's question answered by the fixture.
const deleteWithNet = (files: { deleteItem(p: string, r?: boolean, c?: DeletionConfirmation): Promise<void> }, path: string, recursive?: boolean, confirmation?: DeletionConfirmation) =>
  deleteWithSafetyNet((c) => files.deleteItem(path, recursive, c), async () => { fixture.asked++; return fixture.noNet; }, confirmation);
fixture.operations = new Function("noteSaver", "notifyFileOps", "window", "deleteWithNet", compiled + "\nreturn operations;")(
  { flush: async () => { fixture.order.push("flush"); }, flushAll: async () => { fixture.order.push("flush-all"); } },
  () => {}, { dispatchEvent: () => {} }, deleteWithNet,
) as Record<string, Operation>;
const vault = {
  files: { deleteItem: async (...args: unknown[]) => {
    const confirmation = args[2] as DeletionConfirmation | undefined;
    if (fixture.refuse && !confirmation?.withoutSnapshot) throw new SnapshotBeforeDeleteError(String(args[0]), [String(args[0])], 1, "no-trash");
    fixture.order.push("delete"); fixture.deleted.push(args);
  } },
  indexer: null, syncQueue: {}, queryService: null,
} as unknown as MobileVault;
const t = ((key: string) => key) as Parameters<typeof confirmDeleteFile>[3];
beforeEach(() => {
  fixture.answer = true;
  fixture.noNet = false;
  fixture.asked = 0;
  fixture.refuse = false;
  fixture.order.length = 0;
  fixture.deleted.length = 0;
});

describe("mobile confirmation reaches the actual deletion", () => {
  it("flushes and forwards a confirmed single-file deletion", async () => {
    expect(await confirmDeleteFile(vault, "note.md", "Note", t)).toBe(true);
    expect(fixture.order).toEqual(["flush", "delete"]);
    expect(fixture.deleted).toEqual([["note.md", undefined, { confirmed: true }]]);
  });
  it("does not delete or grant anything after cancellation", async () => {
    fixture.answer = false;
    expect(await confirmDeleteFile(vault, "note.md", "Note", t)).toBe(false);
    expect(fixture.order).toEqual([]);
    expect(fixture.deleted).toEqual([]);
  });
  it("forwards confirmation separately for every selected file", async () => {
    await confirmDeleteFiles(vault, ["one.md", "two.md"], t);
    expect(fixture.deleted).toEqual([
      ["one.md", undefined, { confirmed: true }], ["two.md", undefined, { confirmed: true }],
    ]);
  });
  it("flushes the vault and forwards the recursive folder confirmation", async () => {
    await fixture.operations!.removeFolder(vault, "folder", { confirmed: true });
    expect(fixture.order).toEqual(["flush-all", "delete"]);
    expect(fixture.deleted).toEqual([["folder", true, { confirmed: true }]]);
  });

  it("a deletion without a net asks; \"Cancel\" keeps the file and says so (D1)", async () => {
    fixture.refuse = true;
    expect(await confirmDeleteFile(vault, "note.md", "Note", t)).toBe(false);
    expect(fixture.asked).toBe(1);
    expect(fixture.deleted).toEqual([]);
  });
  it("\"Delete anyway\" deletes once more, without a snapshot, with the confirmation it had", async () => {
    fixture.refuse = true;
    fixture.noNet = true;
    expect(await confirmDeleteFile(vault, "note.md", "Note", t)).toBe(true);
    expect(fixture.deleted).toEqual([["note.md", undefined, { confirmed: true, withoutSnapshot: true }]]);
  });
  it("a selection asks for each file it cannot keep, and reports only what went", async () => {
    fixture.refuse = true;
    expect(await confirmDeleteFiles(vault, ["one.md", "two.md"], t)).toEqual([]);
    expect(fixture.asked).toBe(2);
  });
  it("a clean-up nobody watches does not ask: without a net it throws, and nothing goes", async () => {
    fixture.refuse = true;
    const remove = fixture.operations!.remove as unknown as (v: MobileVault, p: string, c: DeletionConfirmation, ask: boolean) => Promise<boolean>;
    await expect(remove(vault, "draft.md", { confirmed: true }, false)).rejects.toBeInstanceOf(SnapshotBeforeDeleteError);
    expect(fixture.asked).toBe(0);
    expect(fixture.deleted).toEqual([]);
  });
});
