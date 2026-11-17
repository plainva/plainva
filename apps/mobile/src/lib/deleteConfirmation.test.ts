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
  /** Paths whose deletion fails on the device. */
  fail: new Set<string>(),
  /** The deletion plan the index hands, and what the cascade then reports. */
  plan: null as unknown,
  cascade: { deleted: [] as string[], errors: [] as string[] },
  said: [] as string[],
}));
vi.mock("@plainva/ui", async () => {
  // The shared batch with its one question, answered by the fixture (A12).
  const net = await vi.importActual<typeof import("../../../../packages/ui/src/lib/deletionNet")>("../../../../packages/ui/src/lib/deletionNet");
  net.registerDeletionNetQuestion(async () => { fixture.asked++; return fixture.noNet; });
  return {
    initialSelection: () => ({}), isBasePath: () => false, isLargeDeletion: () => false,
    noteDisplayName: (p: string) => p, planNeedsDialog: () => false, selectedPaths: () => [],
    deleteEachWithNet: net.deleteEachWithNet,
    toast: { error: (text: string) => void fixture.said.push(text) },
  };
});
vi.mock("../services/mobileDialogs", () => ({ mConfirm: async () => fixture.answer, mCascade: async () => null }));
vi.mock("../services/cascadeDelete", () => ({ buildMobileDeletionPlan: async () => fixture.plan, executeMobileCascade: vi.fn(async () => fixture.cascade) }));
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
const deleteWithNet = (files: { deleteItem(p: string, r?: boolean, c?: DeletionConfirmation): Promise<void> }, path: string, recursive?: boolean, confirmation?: DeletionConfirmation, ask?: () => Promise<boolean>) =>
  deleteWithSafetyNet((c) => files.deleteItem(path, recursive, c), ask ?? (async () => { fixture.asked++; return fixture.noNet; }), confirmation);
fixture.operations = new Function("noteSaver", "notifyFileOps", "window", "deleteWithNet", compiled + "\nreturn operations;")(
  { flush: async () => { fixture.order.push("flush"); }, flushAll: async () => { fixture.order.push("flush-all"); } },
  () => {}, { dispatchEvent: () => {} }, deleteWithNet,
) as Record<string, Operation>;
const vault = {
  files: { deleteItem: async (...args: unknown[]) => {
    const confirmation = args[2] as DeletionConfirmation | undefined;
    if (fixture.fail.has(String(args[0]))) throw new Error("EBUSY");
    if (fixture.refuse && !confirmation?.withoutSnapshot) throw new SnapshotBeforeDeleteError(String(args[0]), [String(args[0])], 1, "no-trash");
    fixture.order.push("delete"); fixture.deleted.push(args);
  } },
  indexer: null, syncQueue: {}, queryService: null,
} as unknown as MobileVault;
const t = ((key: string, o?: { names?: string }) => (o?.names ? `${key}: ${o.names}` : key)) as Parameters<typeof confirmDeleteFile>[3];
beforeEach(() => {
  fixture.answer = true;
  fixture.noNet = false;
  fixture.asked = 0;
  fixture.refuse = false;
  fixture.order.length = 0;
  fixture.deleted.length = 0;
  fixture.fail.clear();
  fixture.plan = null;
  fixture.cascade = { deleted: [], errors: [] };
  fixture.said.length = 0;
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
  it("a selection asks once for all the files it cannot keep, and reports only what went (A12)", async () => {
    fixture.refuse = true;
    expect(await confirmDeleteFiles(vault, ["one.md", "two.md"], t)).toEqual([]);
    expect(fixture.asked).toBe(1);
    expect(fixture.deleted).toEqual([]);
  });
  it("a \"Delete anyway\" for a selection deletes every file of it without a snapshot", async () => {
    fixture.refuse = true;
    fixture.noNet = true;
    expect(await confirmDeleteFiles(vault, ["one.md", "two.md", "three.md"], t)).toEqual(["one.md", "two.md", "three.md"]);
    expect(fixture.asked).toBe(1);
    expect(fixture.deleted.map((args) => args[0])).toEqual(["one.md", "two.md", "three.md"]);
  });
  it("a clean-up nobody watches does not ask: without a net it throws, and nothing goes", async () => {
    fixture.refuse = true;
    const remove = fixture.operations!.remove as unknown as (v: MobileVault, p: string, c: DeletionConfirmation, ask: boolean) => Promise<boolean>;
    await expect(remove(vault, "draft.md", { confirmed: true }, false)).rejects.toBeInstanceOf(SnapshotBeforeDeleteError);
    expect(fixture.asked).toBe(0);
    expect(fixture.deleted).toEqual([]);
  });
});

describe("what did not go is said, on every way (F6 of release 0.9.0)", () => {
  it("one file without an index that the device refuses", async () => {
    fixture.fail.add("note.md");
    expect(await confirmDeleteFile(vault, "note.md", "Note", t)).toBe(false);
    expect(fixture.said).toEqual(["dialogs.bulkErrorsMsg: note.md"]);
  });
  it("a selection without an index where every file fails: nothing goes, and it says which", async () => {
    fixture.fail.add("a/one.md");
    fixture.fail.add("two.md");
    expect(await confirmDeleteFiles(vault, ["a/one.md", "two.md"], t)).toEqual([]);
    expect(fixture.said).toEqual(["dialogs.bulkErrorsMsg: one.md, two.md"]);
  });
  it("one file through the deletion plan, the usual way with the index open", async () => {
    fixture.plan = {};
    fixture.cascade = { deleted: [], errors: ["note.md"] };
    expect(await confirmDeleteFile(vault, "note.md", "Note", t)).toBe(false);
    expect(fixture.said).toEqual(["dialogs.bulkErrorsMsg: note.md"]);
  });
  it("a selection through the plan: what went comes back, what did not is said", async () => {
    fixture.plan = {};
    fixture.cascade = { deleted: ["one.md"], errors: ["two.md"] };
    expect(await confirmDeleteFiles(vault, ["one.md", "two.md"], t)).toEqual(["one.md"]);
    expect(fixture.said).toEqual(["dialogs.bulkErrorsMsg: two.md"]);
    fixture.said.length = 0;
    fixture.cascade = { deleted: [], errors: ["one.md", "two.md"] };
    expect(await confirmDeleteFiles(vault, ["one.md", "two.md"], t)).toEqual([]);
    expect(fixture.said).toEqual(["dialogs.bulkErrorsMsg: one.md, two.md"]);
  });
});
