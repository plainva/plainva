import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMarkdownAst, VaultIndexer, VaultQueryService, type IDatabaseAdapter } from "@plainva/core";
import { applyLinkUpdates, planLinkUpdates } from "@plainva/ui";
import { serializeMarkdownAst } from "../../../packages/core/src/markdown-serializer";
import { LocalVaultAdapter } from "../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../packages/core/test/helpers/realSqlite";
import {
  LINK_COUNT,
  LINKING_NOTES,
  MARK,
  NEW_NAME,
  NEW_PATH,
  NOTES_WITH_A_LINK,
  OLD_PATH,
  OVERVIEW,
  REFORMATTED_BY_THE_SERIALIZER,
  UNTOUCHED_PATH,
  vaultAfterRename,
  vaultBeforeRename,
} from "../../../packages/core/test/helpers/renameNotes";
import { renameToName } from "./services/fileActions";
import { adoptFileAsIndex } from "./services/indexMd";

/**
 * Renaming a note changes, in every note that links to it, the link target
 * and nothing else — byte for byte (finding 2026-10-09).
 *
 * The notes that link to a renamed one were written back from their parsed
 * tree, in the serializer's form: `- ` for whatever list marker a note uses,
 * `_emphasis_`, a table rule as `| - | - |`, a blank line behind the
 * properties, a line end at the end — and their properties block in the YAML
 * library's form. Here the desktop's own rename (`renameToName`, what the file
 * tree calls) runs over real files with the real index, and the files are read
 * back as bytes. The phone's rename runs over the same notes in
 * `apps/mobile/src/services/renameLinkBytes.test.ts`; the notes, and how they
 * say what has to come back, are in
 * `packages/core/test/helpers/renameNotes.ts`.
 */

let root: string, files: LocalVaultAdapter, db: IDatabaseAdapter, indexer: VaultIndexer, query: VaultQueryService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-rename-bytes-"));
  files = new LocalVaultAdapter(root);
  await files.initialize();
  db = await realSqlite();
  indexer = new VaultIndexer(files, db);
  query = new VaultQueryService(db);
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

async function writeVault(vault: Record<string, string>) {
  for (const [path, text] of Object.entries(vault)) await files.writeTextFile(path, text);
  await indexer.indexVaultFull();
}
const rename = () => renameToName({ adapter: files as never, queryService: query, oldPath: OLD_PATH, newName: NEW_NAME, isFolder: false });

describe("renaming a note on the desktop", () => {
  it("changes the link targets in the notes that link to it, and no other byte", async () => {
    await writeVault(vaultBeforeRename());
    const untouchedBefore = await writtenAt(UNTOUCHED_PATH);

    const result = await rename();

    expect(result).toMatchObject({ ok: true, newPath: NEW_PATH, renamedLinks: LINK_COUNT, changedFiles: NOTES_WITH_A_LINK.length, linkUpdateFailed: false });
    for (const [path, text] of Object.entries(vaultAfterRename())) await expectFile(path, text);
    // A note that only mentions the name is no note that links to it: it is not even written.
    expect(await writtenAt(UNTOUCHED_PATH)).toBe(untouchedBefore);

    // And the links lead where they led: the index, read anew, lists every one of them for the new name.
    await indexer.indexVaultFull();
    const backlinks = await query.getBacklinks(NEW_PATH);
    expect([...new Set(backlinks.map((row) => row.source_path))].sort()).toEqual(NOTES_WITH_A_LINK);
    expect(backlinks.length).toBe(LINK_COUNT);
    expect(await query.getBacklinks(OLD_PATH)).toEqual([]);
  });

  it("was a rewrite of these notes until now — they carry the forms that changed", () => {
    // The proof that the notes are worth something: written back from its
    // tree, each of these comes back another note.
    const before = vaultBeforeRename();
    for (const path of [...REFORMATTED_BY_THE_SERIALIZER, UNTOUCHED_PATH]) {
      const note = before[path];
      const serialized = serializeMarkdownAst(parseMarkdownAst(note, { preserveObsidianSyntax: true }));
      // Compared in the note's own line ends and without its mark: what is left is the reformatting.
      expect(serialized.replace(/\n/g, note.includes("\r\n") ? "\r\n" : "\n"), path).not.toBe(note.startsWith(MARK) ? note.slice(MARK.length) : note);
    }
  });

  it("finds nothing left to do when the same plan is applied again", async () => {
    await writeVault(vaultBeforeRename());
    // What a batch keeps in its journal before the first file moves (the clean-up of task names).
    const { plan } = await planLinkUpdates(query, OLD_PATH, NEW_PATH);
    await rename();
    const before = new Map<string, number>();
    for (const path of Object.keys(LINKING_NOTES)) before.set(path, await writtenAt(path));

    expect(await applyLinkUpdates(files, plan)).toEqual({ renamedLinks: 0, changedFiles: 0, changedPaths: [], failed: false });
    for (const [path, text] of Object.entries(vaultAfterRename())) await expectFile(path, text);
    for (const path of Object.keys(LINKING_NOTES)) expect(await writtenAt(path), path).toBe(before.get(path));
  });

  it("says so when a link cannot be rewritten where it stands, and leaves that note as it is", async () => {
    // `&amp;` inside the link is read as `&`: the note links to "R & D" without spelling it.
    const note = `${MARK}* [[R &amp; D]] is the link\r\n* *the rest* stays\r\n`;
    await writeVault({ "Lab.md": note, "R & D.md": "# R & D\n" });
    expect((await query.getBacklinks("R & D.md")).map((row) => row.source_path)).toEqual(["Lab.md"]);

    const result = await renameToName({ adapter: files as never, queryService: query, oldPath: "R & D.md", newName: "Research", isFolder: false });

    expect(result).toMatchObject({ ok: true, newPath: "Research.md", renamedLinks: 0, changedFiles: 0, linkUpdateFailed: true });
    await expectFile("Lab.md", note);
  });
});

describe("adopting a note as the overview of its folder, prepared for it", () => {
  it("takes the properties out and converts the links, and changes no other byte", async () => {
    await writeVault({ [OVERVIEW.path]: OVERVIEW.note, ...OVERVIEW.others, [OVERVIEW.linkingPath]: OVERVIEW.linking });

    const result = await adoptFileAsIndex({ adapter: files, queryService: query, candidatePath: OVERVIEW.path, folder: OVERVIEW.folder, prepare: true });

    expect(result).toMatchObject({ indexPath: OVERVIEW.indexPath, renamedLinks: 2, changedFiles: 1, preparation: OVERVIEW.preparation });
    await expectFile(OVERVIEW.indexPath, OVERVIEW.prepared);
    // The note that linked to the map names the overview now, and is otherwise as it was.
    await expectFile(OVERVIEW.linkingPath, OVERVIEW.linkingAfter);
    // What was there before the preparation is kept, byte for byte.
    const backups = (await files.listDir(".plainva/backups", true)).filter((entry) => !entry.isDirectory && entry.path.endsWith(`/${OVERVIEW.path}`));
    expect(backups).toHaveLength(1);
    await expectFile(backups[0].path, OVERVIEW.note);
  });

  it("writes nothing into a note that has no block and no link to convert", async () => {
    const plain = `${MARK}# Map\r\n\r\n* just *text*\r\n`;
    await writeVault({ [OVERVIEW.path]: plain });
    const result = await adoptFileAsIndex({ adapter: files, queryService: query, candidatePath: OVERVIEW.path, folder: OVERVIEW.folder, prepare: true });
    expect(result.preparation).toEqual({ converted: 0, embeds: 0, unresolved: 0 });
    await expectFile(OVERVIEW.indexPath, plain);
  });
});
