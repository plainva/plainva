import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLinkTargetIndex, parseMarkdownAst, resolveLinkTargetIndexed, VaultFileExistsError, VaultIndexer, VaultQueryService, type IDatabaseAdapter } from "@plainva/core";
import { applyLinkUpdates, planLinkUpdates } from "@plainva/ui";
import { serializeMarkdownAst } from "../../../packages/core/src/markdown-serializer";
import { LocalVaultAdapter } from "../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../packages/core/test/helpers/realSqlite";
import {
  fill,
  HUB_OVERVIEW,
  LINK_COUNT,
  LINKING_NOTES,
  MARK,
  MARKED,
  MARKED_NAMES,
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
    // A destination is Markdown: `&amp;` in it is read as `&`, and the note
    // links to "R & D.md" without spelling it.
    const note = `${MARK}* [the lab](R%20&amp;%20D.md) is the link\r\n* *the rest* stays\r\n`;
    await writeVault({ "Lab.md": note, "R & D.md": "# R & D\n" });
    expect((await query.getBacklinks("R & D.md")).map((row) => row.source_path)).toEqual(["Lab.md"]);

    const result = await renameToName({ adapter: files as never, queryService: query, oldPath: "R & D.md", newName: "Research", isFolder: false });

    expect(result).toMatchObject({ ok: true, newPath: "Research.md", renamedLinks: 0, changedFiles: 0, linkUpdateFailed: true });
    await expectFile("Lab.md", note);
  });

  it("follows a wiki link with a character reference to the file it names as it is written", async () => {
    // A wiki link holds a file's name, not Markdown (finding 2026-10-11): `[[R &amp; D]]` names "R &amp; D".
    const note = `${MARK}* [[R &amp; D]] is the link\r\n* *the rest* stays\r\n`;
    await writeVault({ "Lab.md": note, "R & D.md": "# R & D\n", "R &amp; D.md": "# R &amp; D\n" });
    expect(await query.getBacklinks("R & D.md")).toEqual([]);
    expect((await query.getBacklinks("R &amp; D.md")).map((row) => row.source_path)).toEqual(["Lab.md"]);

    const other = await renameToName({ adapter: files as never, queryService: query, oldPath: "R & D.md", newName: "Research", isFolder: false });
    expect(other).toMatchObject({ ok: true, renamedLinks: 0, changedFiles: 0, linkUpdateFailed: false });
    await expectFile("Lab.md", note);

    const named = await renameToName({ adapter: files as never, queryService: query, oldPath: "R &amp; D.md", newName: "Lab notes", isFolder: false });
    expect(named).toMatchObject({ ok: true, newPath: "Lab notes.md", renamedLinks: 1, changedFiles: 1, linkUpdateFailed: false });
    await expectFile("Lab.md", note.replace("[[R &amp; D]]", "[[Lab notes]]"));
  });
});

describe("renaming a note on the desktop to a name Markdown reads something into, and back", () => {
  it.each(MARKED_NAMES)("%s", async (name) => {
    await writeVault({ [MARKED.path]: "# Setup\n\n## Part\n", [MARKED.linkingPath]: fill(MARKED.linking, MARKED.name) });
    const toName = await renameToName({ adapter: files as never, queryService: query, oldPath: MARKED.path, newName: name, isFolder: false });
    const renamedPath = `Code/${name}.md`;
    expect(toName).toMatchObject({ ok: true, newPath: renamedPath, renamedLinks: MARKED.links, changedFiles: 1, linkUpdateFailed: false });
    await expectFile(MARKED.linkingPath, fill(MARKED.linking, name));

    // The index lists the links under that name: they are backlinks, and the next rename finds them.
    await indexer.indexVaultFull();
    const backlinks = await query.getBacklinks(renamedPath);
    expect(backlinks.map((row) => row.source_path)).toEqual(Array(MARKED.links).fill(MARKED.linkingPath));
    const back = await renameToName({ adapter: files as never, queryService: query, oldPath: renamedPath, newName: MARKED.name, isFolder: false });
    expect(back).toMatchObject({ ok: true, newPath: MARKED.path, renamedLinks: MARKED.links, changedFiles: 1, linkUpdateFailed: false });
    await expectFile(MARKED.linkingPath, fill(MARKED.linking, MARKED.name));
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
    expect(result.preparation).toEqual({ converted: 0, embeds: 0, unresolved: 0, inLabels: 0 });
    await expectFile(OVERVIEW.indexPath, plain);
  });
});

/**
 * Adopting an overview leaves no link behind that leads nowhere (finding
 * 2026-10-12). Prepared, a note's links to itself named its old file: they
 * were converted before the rename's plan was read, and the plan looked for
 * wiki links the note no longer held. A wiki link in the label of a link came
 * back as a link inside a link, and the link around it was text. A link that
 * reached the note by the title of its properties lost its way with the
 * properties block. And where the folder had an `index.md` already, the note
 * was prepared before the rename was refused.
 *
 * The vault holds an `index.md` at its root and in another folder, as an OKF
 * vault does; the phone runs over the same notes in its twin.
 */
describe("adopting an overview the vault is tied to — by its name, by its title, and by itself", () => {
  /** Every link the index lists, as `note -> the file it leads to`. */
  async function whereLinksLead(): Promise<string[]> {
    const corpus = buildLinkTargetIndex(await query.linkTargets());
    const rows = await db.query<{ source: string; target: string }>("SELECT f.path AS source, l.target_path AS target FROM links l JOIN files f ON f.id = l.source_id");
    return rows.map((row) => `${row.source} -> ${resolveLinkTargetIndexed(row.source, row.target, corpus)}`).sort();
  }
  /** The same list once the overview is called `index.md`: nothing else may have changed in it. */
  const withTheOverviewRenamed = (lines: string[]) => lines.map((line) => line.split(HUB_OVERVIEW.path).join(HUB_OVERVIEW.indexPath)).sort();

  it.each([
    ["as it is", false],
    ["prepared", true],
  ])("leaves every link of the vault leading where it led: %s", async (_how, prepare) => {
    await writeVault(HUB_OVERVIEW.before());
    const before = await whereLinksLead();
    expect(before).toHaveLength(16);
    expect(before.filter((line) => line.endsWith("-> null"))).toEqual([]);

    const result = await adoptFileAsIndex({ adapter: files, queryService: query, candidatePath: HUB_OVERVIEW.path, folder: HUB_OVERVIEW.folder, prepare });

    expect(result).toMatchObject({ indexPath: HUB_OVERVIEW.indexPath, ...(prepare ? HUB_OVERVIEW.preparedReport : HUB_OVERVIEW.adoptedReport) });
    if (!prepare) expect(result.preparation).toBeUndefined();
    expect(await files.exists(HUB_OVERVIEW.path)).toBe(false);
    // Every note is the note it was but for these links, byte for byte.
    for (const [path, text] of Object.entries(prepare ? HUB_OVERVIEW.prepared() : HUB_OVERVIEW.adopted())) await expectFile(path, text);
    // And read anew, the index finds every link where it was: the links of the
    // overview to itself, the one around a wiki link, the ones by its title.
    await indexer.indexVaultFull();
    expect(await whereLinksLead()).toEqual(withTheOverviewRenamed(before));
  });

  it("refuses before anything is written where the folder has an overview already", async () => {
    const vault = { ...HUB_OVERVIEW.before(), [HUB_OVERVIEW.indexPath]: "# Projects\n\nan overview that is there already\n" };
    await writeVault(vault);

    await expect(adoptFileAsIndex({ adapter: files, queryService: query, candidatePath: HUB_OVERVIEW.path, folder: HUB_OVERVIEW.folder, prepare: true })).rejects.toBeInstanceOf(VaultFileExistsError);

    // The note still has its properties and its wiki links, and no copy of it was put aside.
    for (const [path, text] of Object.entries(vault)) await expectFile(path, text);
    expect(await files.exists(".plainva/backups")).toBe(false);
  });
});
