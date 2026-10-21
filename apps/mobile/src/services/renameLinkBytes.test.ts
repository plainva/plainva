// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
  BackupVaultAdapter,
  ConflictAwareVaultAdapter,
  QueueingVaultAdapter,
  SyncQueue,
  SyncStateRepository,
  toPathIdentity,
  VaultIndexer,
  VaultQueryService,
  type IDatabaseAdapter,
} from "@plainva/core";
import { adoptFileAsIndex, errorText, landedAtDestination, MoveBlockedError, moveItemName, notifyFileOps, renameBookmarksOnDisk, renameFileWithLinkUpdates } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import {
  fill,
  LINK_COUNT,
  LINKING_NOTES,
  MARKED,
  MARKED_NAMES,
  NEW_NAME,
  NEW_PATH,
  NOTES_WITH_A_LINK,
  OLD_PATH,
  OVERVIEW,
  UNTOUCHED_PATH,
  vaultAfterRename,
  vaultBeforeRename,
} from "../../../../packages/core/test/helpers/renameNotes";
import type { MobileVault, NoteRenameReport } from "./vaultService";

/**
 * Renaming a note on the phone changes, in every note that links to it, the
 * link target and nothing else — byte for byte (finding 2026-10-09).
 *
 * The rewrite of the linking notes is shared code, so the phone reformatted
 * them exactly as the desktop did. This runs the phone's OWN rename —
 * `vaultOps.renameReport`, read from its source, because the module pulls in
 * the native plugins and cannot be imported here (`editorTextSpace.test.ts`
 * reads its methods the same way) — over real files, a real SQLite and the
 * adapter chain the phone writes through, with the notes the desktop's twin
 * runs over (`apps/desktop/src/renameLinkBytes.test.ts`,
 * `packages/core/test/helpers/renameNotes.ts`). Only what surrounds the rename
 * on a device is replaced: the save coordinator, the draft journal, the toast.
 */

const serviceSource = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const serviceFile = ts.createSourceFile("vaultService.ts", serviceSource, ts.ScriptTarget.Latest, true);
const functions = ["flushBeforeMove", "moveStep"];
const found = { functions: [] as string[], method: "" };
(function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && functions.includes(node.name.text)) found.functions.push(node.getText(serviceFile));
  if (ts.isMethodDeclaration(node) && node.name.getText(serviceFile) === "renameReport") found.method = node.getText(serviceFile);
  ts.forEachChild(node, visit);
})(serviceFile);
if (found.functions.length !== functions.length || !found.method) throw new Error("the phone's rename moved — re-point this harness");
const compiled = ts.transpileModule(found.functions.join("\n") + "\nconst vaultOps = {" + found.method + "};\n", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

interface Phone {
  renameReport(v: MobileVault, oldPath: string, newTitle: string): Promise<NoteRenameReport>;
}

let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, vault: MobileVault, query: VaultQueryService, phone: Phone;
let flushed: string[], warnings: string[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-phone-rename-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
  // The chain a write goes through on the phone: conflict check, sync queue, version snapshot.
  const files = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(new BackupVaultAdapter(raw), new SyncQueue(db)), new SyncStateRepository(db));
  query = new VaultQueryService(db);
  const indexer = new VaultIndexer(files, db);
  // What the vault's own door for "these paths were written" does: index each as it lies there.
  const reindexPaths = async (paths: readonly string[]) => {
    for (const path of paths) await indexer.indexFile(await raw.getFileInfo(path));
  };
  vault = { vaultId: "vault-a", adapter: raw, files, db, indexer, queryService: query, reindexPaths } as unknown as MobileVault;
  flushed = [];
  warnings = [];
  const deps = {
    toPathIdentity, renameFileWithLinkUpdates, renameBookmarksOnDisk, notifyFileOps, landedAtDestination, errorText, MoveBlockedError, moveItemName,
    noteSaver: { flush: async (path: string) => { flushed.push(path); }, flushAll: async () => {} },
    relocateDrafts: async () => {},
    toast: { error: (text: string) => { warnings.push(text); }, warning: (text: string) => { warnings.push(text); }, success: () => {} },
    i18n: { t: (key: string) => key },
    window, CustomEvent, console: { error: () => {}, warn: () => {} },
  };
  phone = (new Function(...Object.keys(deps), `${compiled}\nreturn vaultOps;`)(...Object.values(deps))) as Phone;
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
const writtenAt = async (path: string) => (await stat(join(root, path))).mtimeMs;
/** Files as they lie in a vault before the app touches them, and the index over them. */
async function writeVault(files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) await raw.writeTextFile(path, text);
  await vault.indexer!.indexVaultFull();
}
const queued = () => db.query<{ operation: string; file_path: string; new_path: string | null }>("SELECT operation, file_path, new_path FROM offline_queue ORDER BY id");

describe("renaming a note on the phone", () => {
  it("changes the link targets in the notes that link to it, and no other byte", async () => {
    await writeVault(vaultBeforeRename());
    const untouchedBefore = await writtenAt(UNTOUCHED_PATH);

    const report = await phone.renameReport(vault, OLD_PATH, NEW_NAME);

    expect(report).toEqual({ newPath: NEW_PATH, renamedLinks: LINK_COUNT, changedFiles: NOTES_WITH_A_LINK.length, linkUpdateFailed: false });
    expect(warnings).toEqual([]);
    // Unsaved text of the note lands before its path moves (issue 113).
    expect(flushed).toEqual([OLD_PATH]);
    for (const [path, text] of Object.entries(vaultAfterRename())) await expectFile(path, text);
    expect(await writtenAt(UNTOUCHED_PATH)).toBe(untouchedBefore);

    // The phone brings its index up to date itself: the links lead where they led.
    const backlinks = await query.getBacklinks(NEW_PATH);
    expect([...new Set(backlinks.map((row) => row.source_path))].sort()).toEqual(NOTES_WITH_A_LINK);
    expect(backlinks.length).toBe(LINK_COUNT);
    expect(await query.getBacklinks(OLD_PATH)).toEqual([]);

    // What goes to the sync: the move, and the notes whose links changed — not a note that was not written.
    const operations = await queued();
    expect(operations.some((op) => op.operation === "rename" && op.file_path === OLD_PATH && op.new_path === NEW_PATH)).toBe(true);
    const written = new Set(operations.filter((op) => op.operation === "write").map((op) => op.file_path));
    for (const path of Object.keys(LINKING_NOTES)) expect(written.has(path), path).toBe(true);
    expect([...written].filter((path) => path === UNTOUCHED_PATH || path === "Keep.md")).toEqual([]);
  });

  it("says so when a link cannot be rewritten where it stands, and leaves that note as it is", async () => {
    // A destination is Markdown: `&amp;` in it is read as `&`, and the note
    // links to "R & D.md" without spelling it.
    const note = `${String.fromCharCode(0xfeff)}* [the lab](R%20&amp;%20D.md) is the link\r\n* *the rest* stays\r\n`;
    await writeVault({ "Lab.md": note, "R & D.md": "# R & D\n" });

    const report = await phone.renameReport(vault, "R & D.md", "Research");

    expect(report).toEqual({ newPath: "Research.md", renamedLinks: 0, changedFiles: 0, linkUpdateFailed: true });
    await expectFile("Lab.md", note);
  });

  it("follows a wiki link with a character reference to the file it names as it is written", async () => {
    // A wiki link holds a file's name, not Markdown (finding 2026-10-11): `[[R &amp; D]]` names "R &amp; D".
    const note = `${String.fromCharCode(0xfeff)}* [[R &amp; D]] is the link\r\n* *the rest* stays\r\n`;
    await writeVault({ "Lab.md": note, "R & D.md": "# R & D\n", "R &amp; D.md": "# R &amp; D\n" });

    expect(await phone.renameReport(vault, "R & D.md", "Research")).toEqual({ newPath: "Research.md", renamedLinks: 0, changedFiles: 0, linkUpdateFailed: false });
    await expectFile("Lab.md", note);

    expect(await phone.renameReport(vault, "R &amp; D.md", "Lab notes")).toEqual({ newPath: "Lab notes.md", renamedLinks: 1, changedFiles: 1, linkUpdateFailed: false });
    await expectFile("Lab.md", note.replace("[[R &amp; D]]", "[[Lab notes]]"));
  });
});

describe("renaming a note on the phone to a name Markdown reads something into, and back", () => {
  it.each(MARKED_NAMES)("%s", async (name) => {
    await writeVault({ [MARKED.path]: "# Setup\n\n## Part\n", [MARKED.linkingPath]: fill(MARKED.linking, MARKED.name) });
    const renamedPath = `Code/${name}.md`;

    expect(await phone.renameReport(vault, MARKED.path, name)).toEqual({ newPath: renamedPath, renamedLinks: MARKED.links, changedFiles: 1, linkUpdateFailed: false });
    await expectFile(MARKED.linkingPath, fill(MARKED.linking, name));

    // The phone brings its index up to date itself: the links are backlinks under that name, and the next rename finds them.
    expect((await query.getBacklinks(renamedPath)).map((row) => row.source_path)).toEqual(Array(MARKED.links).fill(MARKED.linkingPath));
    expect(await phone.renameReport(vault, renamedPath, MARKED.name)).toEqual({ newPath: MARKED.path, renamedLinks: MARKED.links, changedFiles: 1, linkUpdateFailed: false });
    await expectFile(MARKED.linkingPath, fill(MARKED.linking, MARKED.name));
  });
});

/**
 * The phone adopts an overview note as it is — it offers no preparation
 * (parity catalog: `overview-prepare-on-adopt`). The notes that link to it
 * follow by the same rewrite as after any rename; and the shared preparation
 * is held to the same bytes through the phone's chain, for the day its screen
 * offers it.
 */
describe("adopting a note as the overview of its folder on the phone", () => {
  const screen = readFileSync(resolve("src/screens/OverviewsScreen.tsx"), "utf8");

  it("leaves the adopted note as it is and changes only the target of the links to it", async () => {
    // What the Overviews screen calls.
    expect(screen).toMatch(/await adoptFileAsIndex\(\{\s*adapter: vault\.files,\s*queryService: vault\.queryService!,\s*candidatePath: candidate\.path,\s*folder: row\.folder,\s*prepare: false,\s*\}\);/);
    await writeVault({ [OVERVIEW.path]: OVERVIEW.note, ...OVERVIEW.others, [OVERVIEW.linkingPath]: OVERVIEW.linking });

    const result = await adoptFileAsIndex({ adapter: vault.files, queryService: query, candidatePath: OVERVIEW.path, folder: OVERVIEW.folder, prepare: false });

    expect(result).toMatchObject({ indexPath: OVERVIEW.indexPath, renamedLinks: 2, changedFiles: 1 });
    await expectFile(OVERVIEW.indexPath, OVERVIEW.note);
    await expectFile(OVERVIEW.linkingPath, OVERVIEW.linkingAfter);
  });

  it("prepares it, through the phone's chain, to the bytes the desktop writes", async () => {
    await writeVault({ [OVERVIEW.path]: OVERVIEW.note, ...OVERVIEW.others, [OVERVIEW.linkingPath]: OVERVIEW.linking });

    const result = await adoptFileAsIndex({ adapter: vault.files, queryService: query, candidatePath: OVERVIEW.path, folder: OVERVIEW.folder, prepare: true });

    expect(result).toMatchObject({ indexPath: OVERVIEW.indexPath, renamedLinks: 2, changedFiles: 1, preparation: OVERVIEW.preparation });
    await expectFile(OVERVIEW.indexPath, OVERVIEW.prepared);
    await expectFile(OVERVIEW.linkingPath, OVERVIEW.linkingAfter);
  });
});
