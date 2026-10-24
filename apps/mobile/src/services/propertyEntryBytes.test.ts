// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
  BackupVaultAdapter,
  ConflictAwareVaultAdapter,
  QueueingVaultAdapter,
  SyncQueue,
  SyncStateRepository,
  VaultIndexer,
  updateVaultText,
  type IDatabaseAdapter,
} from "@plainva/core";
import { bulkSetProperty, writeNoteProperty, type BulkSetResult } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { BLOCK, LAST_ENTRY, SHAPES, noteOf, withLine, withLinesBehind, withoutLines } from "../../../../packages/core/test/helpers/propertyBlock";
import type { MobileVault } from "./vaultService";

/**
 * A property written on the phone changes ONE entry of its note's block, and
 * no other byte (finding 2026-10-11).
 *
 * The writer is shared code, so the phone rewrote a note's whole block exactly
 * as the desktop did: a cell edited in a database, **Set value…** across a
 * selection — and the block of `packages/core/test/helpers/propertyBlock.ts`
 * came back with `plz: 01067` as `1067`, a phone number without its plus, its
 * long line folded and its lists re-indented, in notes nobody had opened.
 *
 * This runs the phone's OWN writers — `commitCellValue` and `commitBulkValue`
 * with the note files they hand the shared writer, and the `read`, `save` and
 * `update` of its vault service, read from their sources because the modules
 * pull in the native plugins and cannot be imported here
 * (`vaultChainWrites.test.ts` reads them the same way) — over real files, a
 * real SQLite and the adapter chain the phone writes through. The files are
 * read back as bytes. The desktop's cell runs over the same block in
 * `apps/desktop/src/components/base/useBaseCells.entryBytes.test.tsx`.
 */

const sourceOf = (file: string) => ts.createSourceFile(file, readFileSync(resolve(file), "utf8"), ts.ScriptTarget.Latest, true);
function all<T extends ts.Node>(root: ts.Node, is: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  (function visit(node: ts.Node) {
    if (is(node)) found.push(node);
    ts.forEachChild(node, visit);
  })(root);
  return found;
}
const serviceFile = sourceOf("src/services/vaultService.ts");
const fileMethods = all(serviceFile, ts.isMethodDeclaration).filter((m) => ["read", "save", "update"].includes(m.name.getText(serviceFile)));
const baseOpsFile = sourceOf("src/services/baseOps.ts");
const writerNames = ["noteFiles", "commitCellValue", "commitBulkValue"];
const writerFunctions = all(baseOpsFile, ts.isFunctionDeclaration).filter((f) => writerNames.includes(f.name?.text ?? ""));
if (fileMethods.length !== 3 || writerFunctions.length !== writerNames.length) throw new Error("the phone's property writers moved — re-point this harness");
const compiled = ts.transpileModule(
  `const vaultOps = {${fileMethods.map((m) => m.getText(serviceFile)).join(",\n")}};\n` +
    writerFunctions.map((f) => f.getText(baseOpsFile).replace(/^export /, "")).join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

interface Phone {
  commitCellValue(v: MobileVault, path: string, col: string, value: unknown): Promise<void>;
  commitBulkValue(v: MobileVault, paths: readonly string[], col: string, value: unknown): Promise<BulkSetResult>;
}

const PATH = "Projects/Note.md";
const OTHER = "Archive/Other.md";

let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, vault: MobileVault, phone: Phone;
let flushed: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-phone-entry-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
  // The chain a write goes through on the phone: conflict check, sync queue, version snapshot.
  const files = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(new BackupVaultAdapter(raw), new SyncQueue(db)), new SyncStateRepository(db));
  const indexer = new VaultIndexer(files, db);
  const reindexPaths = async (paths: readonly string[]) => {
    for (const path of paths) await indexer.indexPath(path).catch(() => {});
  };
  vault = { vaultId: "vault-a", adapter: raw, files, db, indexer, reindexPaths } as unknown as MobileVault;
  flushed = [];
  const deps = {
    updateVaultText, writeNoteProperty, bulkSetProperty,
    noteSaver: { flush: async (path: string) => { flushed.push(path); } },
    syncSoon: () => {},
  };
  phone = new Function(...Object.keys(deps), `${compiled}\nreturn { commitCellValue, commitBulkValue };`)(...Object.values(deps)) as Phone;
});
afterEach(async () => {
  await db.close();
  await rm(root, { recursive: true, force: true });
});

const utf8 = (text: string) => [...Buffer.from(text, "utf8")];
/** The file as text, a mark included, then byte for byte. */
async function expectFile(path: string, text: string) {
  const onDisk = await readFile(join(root, path));
  expect(onDisk.toString("utf8"), path).toBe(text);
  expect([...onDisk], path).toEqual(utf8(text));
}
/** Notes as they lie in a vault before the app touches them, and the index over them. */
async function writeVault(notes: Record<string, string>) {
  for (const [path, text] of Object.entries(notes)) await raw.writeTextFile(path, text);
  await vault.indexer!.indexVaultFull();
}
const queued = async () =>
  (await db.query<{ operation: string; file_path: string }>("SELECT operation, file_path FROM offline_queue ORDER BY id")).map((op) => `${op.operation} ${op.file_path}`);

describe.each(SHAPES)("a property written on the phone changes one entry of the block — a note with %s", (_name, shape) => {
  const note = noteOf(BLOCK, shape);
  const after = (block: readonly string[]) => noteOf(block, shape);

  it("a cell: the characters of its value, and the comment behind it stays", async () => {
    await writeVault({ [PATH]: note });

    await phone.commitCellValue(vault, PATH, "status", "done");

    await expectFile(PATH, after(withLine(BLOCK, "status: open   # the state", "status: done   # the state")));
    // Through the phone's chain: the editor's pending text first, and the change goes to the sync.
    expect(flushed).toEqual([PATH]);
    expect(await queued()).toEqual([`write ${PATH}`]);
  });

  it("a cell that is emptied: the line of its entry", async () => {
    await writeVault({ [PATH]: note });
    await phone.commitCellValue(vault, PATH, "status", "");
    await expectFile(PATH, after(withoutLines(BLOCK, "status: open   # the state")));
  });

  it("a column the note does not have yet: a line behind the last entry", async () => {
    await writeVault({ [PATH]: note });
    await phone.commitCellValue(vault, PATH, "owner", "Anna");
    await expectFile(PATH, after(withLinesBehind(BLOCK, LAST_ENTRY, "owner: Anna")));
  });

  it("one more value in a list: between its brackets", async () => {
    await writeVault({ [PATH]: note });
    await phone.commitCellValue(vault, PATH, "tags", ["a", "b", "c"]);
    await expectFile(PATH, after(withLine(BLOCK, "tags: [a, b]", "tags: [a, b, c]")));
  });

  it("a column the index names by its text: the entry that is there, not a second one beside it", async () => {
    await writeVault({ [PATH]: note });
    await phone.commitCellValue(vault, PATH, "2024", "plans");
    await expectFile(PATH, after(withLine(BLOCK, "2024: goals", "2024: plans")));
  });

  it("the value the note already holds: the note is not written", async () => {
    await writeVault({ [PATH]: note });
    await phone.commitCellValue(vault, PATH, "status", "open");
    await expectFile(PATH, note);
    expect(await queued()).toEqual([]);
  });

  it("a value set across a selection: that entry in every note, and no other byte of any", async () => {
    // A note that has the property, and one that gets it.
    const other = after(withoutLines(BLOCK, "status: open   # the state"));
    await writeVault({ [PATH]: note, [OTHER]: other });

    const result = await phone.commitBulkValue(vault, [PATH, OTHER], "status", "done");

    expect(result.failed).toEqual([]);
    expect([...result.written].sort()).toEqual([OTHER, PATH]);
    await expectFile(PATH, after(withLine(BLOCK, "status: open   # the state", "status: done   # the state")));
    await expectFile(OTHER, after(withLinesBehind(withoutLines(BLOCK, "status: open   # the state"), LAST_ENTRY, "status: done")));
  });
});
