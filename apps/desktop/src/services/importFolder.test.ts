import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readFolderAsFiles } from "./importArchive";

/**
 * Issue #61.2: "no matter which type of export from joplin it says there's no
 * .md".
 *
 * Every markdown-family importer offers a folder picker (`pickModes` contains
 * `folder`), but nothing ever walked one. A picked directory reached the wizard
 * as a single selected "file", `readTextFile` was called on a directory path and
 * threw, and the catch meant for an unreadable file swallowed it — so `analyze`
 * saw an empty payload and warned "No notes found in the selection." for every
 * folder import, of every source.
 */

const dirs: Record<string, Array<{ name: string; isDirectory: boolean; isFile: boolean }>> = {};
const texts: Record<string, string> = {};
const stats: Record<string, { size: number; mtime: Date | null }> = {};

/**
 * The walk takes its three fs functions as a parameter, so a test states the
 * tree instead of patching the module graph. An earlier version of this file
 * mocked `@tauri-apps/plugin-fs`; it passed in isolation and failed in the full
 * suite, because the shell's fs arrives through a dynamic import and another
 * test file had already pulled the module in — the walk then saw the real fs.
 */
const fakeFs = () => ({
  readDir: async (path: string) => {
    const entries = dirs[path];
    if (!entries) throw new Error(`no such dir: ${path}`);
    return entries;
  },
  readTextFile: async (path: string) => {
    if (!(path in texts)) throw new Error(`not decodable: ${path}`);
    return texts[path];
  },
  stat: async (path: string) => stats[path] ?? { size: 0, mtime: null },
});

const dir = (...names: Array<[string, "dir" | "file"]>) =>
  names.map(([name, kind]) => ({ name, isDirectory: kind === "dir", isFile: kind === "file" }));

beforeEach(() => {
  for (const key of Object.keys(dirs)) delete dirs[key];
  for (const key of Object.keys(texts)) delete texts[key];
  for (const key of Object.keys(stats)) delete stats[key];
});

describe("readFolderAsFiles", () => {
  it("walks a Joplin markdown export into notes plus attachment references", async () => {
    // The reporter's layout: notebooks as folders, resources beside them.
    dirs["/exp"] = dir(["Notizen", "dir"], ["_resources", "dir"], ["README.md", "file"]);
    dirs["/exp/Notizen"] = dir(["Reuniao.md", "file"]);
    dirs["/exp/_resources"] = dir(["6 de mar. 15.10.mp3", "file"]);
    texts["/exp/README.md"] = "# Export";
    texts["/exp/Notizen/Reuniao.md"] = "# Reuniao\n\n[attachment](../_resources/6 de mar. 15.10.mp3)\n";
    stats["/exp/Notizen/Reuniao.md"] = { size: 64, mtime: new Date("2026-03-06T15:10:00Z") };

    const result = await readFolderAsFiles("/exp", fakeFs());

    const byPath = new Map(result.files.map((f) => [f.relativePath, f]));
    expect([...byPath.keys()].sort()).toEqual([
      "Notizen/Reuniao.md",
      "README.md",
      "_resources/6 de mar. 15.10.mp3",
    ].sort());

    // The note is decoded text with its own date — that is what the importer
    // needs to see to count a note at all.
    const note = byPath.get("Notizen/Reuniao.md")!;
    expect(note.isText).toBe(true);
    expect(note.content).toContain("# Reuniao");
    expect(note.mtimeMs).toBe(Date.parse("2026-03-06T15:10:00Z"));

    // The attachment stays bytes on disk, referenced by where it already lies —
    // the same contract the archive path produces, so the writer can copy it.
    const mp3 = byPath.get("_resources/6 de mar. 15.10.mp3")!;
    expect(mp3.isText).toBe(false);
    expect(mp3.content).toBe("");
    expect(mp3.sourcePath).toBe("/exp/_resources/6 de mar. 15.10.mp3");
  });

  it("skips the folders no import should carry", async () => {
    dirs["/v"] = dir([".git", "dir"], ["node_modules", "dir"], [".obsidian", "dir"], ["Note.md", "file"]);
    dirs["/v/.git"] = dir(["config", "file"]);
    dirs["/v/node_modules"] = dir(["pkg", "dir"]);
    dirs["/v/.obsidian"] = dir(["app.json", "file"]);
    texts["/v/Note.md"] = "# Note";

    const result = await readFolderAsFiles("/v", fakeFs());
    expect(result.files.map((f) => f.relativePath)).toEqual(["Note.md"]);
  });

  it("reports an unreadable subfolder instead of failing the whole walk", async () => {
    dirs["/v"] = dir(["Good", "dir"], ["Locked", "dir"]);
    dirs["/v/Good"] = dir(["A.md", "file"]);
    texts["/v/Good/A.md"] = "# A";
    // "/v/Locked" is absent from `dirs` → readDir throws.

    const result = await readFolderAsFiles("/v", fakeFs());
    expect(result.files.map((f) => f.relativePath)).toEqual(["Good/A.md"]);
    expect(result.skipped).toEqual([{ relativePath: "Locked", reason: "unreadable" }]);
  });

  it("passes a text-named file on as bytes when it cannot be decoded", async () => {
    dirs["/v"] = dir(["broken.md", "file"]);
    // present in `dirs` but not in `texts` → readTextFile throws
    const result = await readFolderAsFiles("/v", fakeFs());
    expect(result.files[0].isText).toBe(false);
    expect(result.files[0].sourcePath).toBe("/v/broken.md");
  });

  it("ignores a trailing separator on the picked path", async () => {
    dirs["/v"] = dir(["A.md", "file"]);
    texts["/v/A.md"] = "# A";
    await expect(readFolderAsFiles("/v/", fakeFs())).resolves.toMatchObject({
      files: [expect.objectContaining({ relativePath: "A.md" })],
    });
  });
});

/**
 * The wizard must actually ASK. `readFolderAsFiles` being correct is worthless
 * while the payload builder still ignores `folderPath` — which is exactly the
 * state #61 reported: the guard checked the variable, the UI displayed it, and
 * nothing read it. A source scan is the honest test here: the payload builder
 * sits inside a modal behind two native dialogs, so a mocked component test
 * would be asserting against its own mocks.
 */
describe("the import wizard reads a picked folder", () => {
  it("walks folderPath before falling through to the file loop", () => {
    const src = readFileSync(
      join(__dirname, "..", "components", "import", "ImportWizardModal.tsx"),
      "utf8",
    );
    expect(src).toContain("readFolderAsFiles");
    // The folder branch must come BEFORE the `for (const f of files)` loop and
    // return, otherwise the picked directory reaches readTextFile again.
    const branch = src.indexOf("if (folderPath) {");
    const loop = src.indexOf("for (const f of files) {");
    expect(branch).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(branch);
    expect(src.slice(branch, loop)).toContain("readFolderAsFiles(folderPath)");
  });
});
