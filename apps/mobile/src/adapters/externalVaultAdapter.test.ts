// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { VaultFileExistsError, VaultFileNotFoundError, VaultIndexer, parseJournal } from "@plainva/core";
import { parseBaseConfig, parseHeadings } from "@plainva/ui";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { ExternalVaultAdapter } from "./ExternalVaultAdapter";
import { fakeVaultFolder as fakePlugin } from "./fakeVaultFolder";

/**
 * The external-folder adapter against a fake of the native plugin (external
 * vault folder plan, P4; the fake is `fakeVaultFolder.ts`). The fake keeps a flat
 * map of paths — enough to pin the contract the chains above rely on: shared
 * errors, dot-children filtered, base64 on the bridge only, and the access
 * state the vault detail shows.
 */
const text = (a: Uint8Array | string) => (typeof a === "string" ? a : new TextDecoder().decode(a));

describe("ExternalVaultAdapter", () => {
  it("lists a folder without its dot-children and reads what it wrote", async () => {
    const files = new Map<string, string | Uint8Array>([
      ["Welcome.md", "# Hi"],
      [".obsidian/app.json", "{}"],
      [".stfolder", ""],
      ["Projects/Plan.md", "plan"],
    ]);
    const { plugin, dirs } = fakePlugin(files);
    dirs.add(".obsidian");
    dirs.add("Projects");
    const a = new ExternalVaultAdapter(plugin, "h1");
    await a.initialize();
    expect(a.accessState).toEqual({ state: "ok", label: "Notes" });
    const top = await a.listDir("");
    expect(top.map((f) => f.path).sort()).toEqual(["Projects", "Welcome.md"]);
    const all = await a.listDir("", true);
    expect(all.map((f) => f.path).sort()).toEqual(["Projects", "Projects/Plan.md", "Welcome.md"]);
    await a.writeTextFile("Notes/Ünïcode.md", "ä ö ü — 日本");
    expect(await a.readTextFile("Notes/Ünïcode.md")).toBe("ä ö ü — 日本");
    const bytes = new Uint8Array([0, 255, 128, 7]);
    await a.writeBinaryFile("img.bin", bytes);
    expect([...(await a.readBinaryFile("img.bin"))]).toEqual([0, 255, 128, 7]);
    expect(text(files.get("Notes/Ünïcode.md")!)).toBe("ä ö ü — 日本");
  });

  it("hands out a file's text with its byte order mark, and writes it back byte for byte", async () => {
    // What a user's folder holds: a note and a table that start with a mark
    // (Excel wants one), with the line ends of the machine they came from.
    const MARK_BYTES = [0xef, 0xbb, 0xbf];
    const withMark = (body: string) => new Uint8Array([...MARK_BYTES, ...new TextEncoder().encode(body)]);
    const files = new Map<string, string | Uint8Array>([
      ["Note.md", withMark("# Title\r\n\r\none\r\n")],
      ["Data.csv", withMark("id;name\r\n1;Ada\r\n")],
      ["Plain.md", "no mark\n"],
    ]);
    const { plugin } = fakePlugin(files);
    const a = new ExternalVaultAdapter(plugin, "h1");
    for (const path of ["Note.md", "Data.csv", "Plain.md"]) {
      const before = [...(files.get(path) instanceof Uint8Array ? files.get(path) as Uint8Array : new TextEncoder().encode(files.get(path) as string))];
      const read = await a.readTextFile(path);
      // The mark is the text's first character, as with the container adapter
      // and on the desktop. The decoder used to drop it here: the editor saw a
      // file without a mark, and its first save wrote one without.
      expect(read.charCodeAt(0) === 0xfeff, path).toBe(before[0] === 0xef);
      await a.writeTextFile(path, read);
      expect([...(files.get(path) as Uint8Array)], path).toEqual(before);
    }
  });

  it("gives what reads through it the same answers for a file with a mark as for the file without", async () => {
    // The mark arrives as the text's first character since 2026-10-09. Until
    // then it was dropped on the way, so nothing that reads a file in a picked
    // folder had ever met one: the index, the properties, a database file,
    // the outline of the note's sheet, the journal.
    const MARK_BYTES = [0xef, 0xbb, 0xbf];
    const note = (eol: string) => [
      "---", "title: Plan", "type: Note", "status: open", "tags: [alpha]", "related: \"[[Other]]\"", "---",
      "# Heading", "", "Text with [[Target#Part|a link]] and #inline.", "", "- [ ] first", "- [x] second", "",
      "## Journal", "", "- 09:15 an entry", "",
    ].join(eol);
    const content: Record<string, string> = {
      "Plan.md": note("\n"),
      "Windows/Plan.md": note("\r\n"),
      "Bare.md": "# Bare\n\n- [ ] a task #tagged\n[[Plan]]\n",
      "Tasks.base": "filters:\n  and:\n    - file.inFolder(\"Windows\")\nviews:\n  - type: table\n    name: All\n    order:\n      - file.name\n      - status\n",
    };
    const folder = (marked: boolean) => new Map<string, string | Uint8Array>(Object.entries(content).map(([path, text]) =>
      [path, marked ? new Uint8Array([...MARK_BYTES, ...new TextEncoder().encode(text)]) : text]));

    const read = async (marked: boolean) => {
      const adapter = new ExternalVaultAdapter(fakePlugin(folder(marked)).plugin, "h1");
      const db = await realSqlite();
      try {
        await new VaultIndexer(adapter, db).indexVaultFull("test");
        const rows = (sql: string) => db.query<Record<string, unknown>>(sql);
        const index = {
          files: await rows("SELECT path, title, mode FROM files ORDER BY path"),
          properties: await rows("SELECT f.path, p.key, p.value, p.type FROM properties p JOIN files f ON f.id = p.file_id ORDER BY f.path, p.key"),
          tags: await rows("SELECT f.path, t.tag FROM tags t JOIN files f ON f.id = t.file_id ORDER BY f.path, t.tag"),
          links: await rows("SELECT f.path, l.target_raw, l.link_type, l.anchor, l.property_key, l.line_number FROM links l JOIN files f ON f.id = l.source_id ORDER BY f.path, l.target_raw"),
        };
        const texts = Object.fromEntries(await Promise.all(Object.keys(content).map(async (path) => [path, await adapter.readTextFile(path)] as const)));
        // The mark is there: this compares readers, not a decoder that hides it.
        for (const path of Object.keys(content)) expect(texts[path].charCodeAt(0) === 0xfeff, path).toBe(marked);
        return {
          index,
          base: parseBaseConfig(texts["Tasks.base"]),
          outline: Object.fromEntries(Object.keys(content).filter((p) => p.endsWith(".md")).map((p) => [p, parseHeadings(texts[p]).map((h) => [h.level, h.text, h.line])])),
          journal: Object.fromEntries(Object.keys(content).filter((p) => p.endsWith(".md")).map((p) => [p, parseJournal(texts[p]).entries.map((e) => [e.line, e.time, e.text])])),
        };
      } finally { await db.close(); }
    };

    const plain = await read(false), marked = await read(true);
    // What is compared is not empty.
    expect(plain.index.files.map((f) => f.path)).toEqual(["Bare.md", "Plan.md", "Tasks.base", "Windows/Plan.md"]);
    expect(plain.index.properties.length).toBeGreaterThan(6);
    expect(plain.index.links.length).toBeGreaterThan(4);
    expect(plain.outline["Plan.md"]).toEqual([[1, "Heading", 8], [2, "Journal", 15]]);
    expect(plain.journal["Windows/Plan.md"]).toEqual([[16, "09:15", "an entry"]]);
    expect(plain.base.views).toHaveLength(1);
    // The outline led one line above each heading, and the journal read no entry.
    expect(marked).toEqual(plain);
  });

  it("speaks the shared adapter errors", async () => {
    const files = new Map<string, string | Uint8Array>([["a.md", "a"], ["b.md", "b"]]);
    const { plugin } = fakePlugin(files);
    const a = new ExternalVaultAdapter(plugin, "h1");
    await expect(a.readTextFile("missing.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    await expect(a.getFileInfo("missing.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    await expect(a.deleteItem("missing.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    await expect(a.renameItem("a.md", "b.md")).rejects.toBeInstanceOf(VaultFileExistsError);
    await expect(a.renameItem("missing.md", "c.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    await a.renameItem("a.md", "Sub/a.md");
    expect(await a.exists("a.md")).toBe(false);
    expect(await a.exists("Sub/a.md")).toBe(true);
    const info = await a.getFileInfo("Sub/a.md");
    expect(info).toMatchObject({ path: "Sub/a.md", name: "a.md", isDirectory: false, size: 1 });
  });

  it("reports an expired grant instead of failing, and releases on dispose", async () => {
    const { plugin, calls } = fakePlugin(new Map(), { state: "expired", label: "Old" });
    const a = new ExternalVaultAdapter(plugin, "h1");
    await a.initialize();
    expect(a.accessState).toEqual({ state: "expired", label: "Old" });
    await a.dispose();
    expect(calls).toEqual(["resolve", "release"]);
    expect(a.sandboxRoot).toBeUndefined();
  });

  it("normalizes paths the way the container adapter does", async () => {
    const files = new Map<string, string | Uint8Array>();
    const { plugin } = fakePlugin(files);
    const a = new ExternalVaultAdapter(plugin, "h1");
    await a.writeTextFile("/Folder\\Note.md/", "x");
    expect([...files.keys()]).toEqual(["Folder/Note.md"]);
    await a.createDir("/New/");
    expect(await a.exists("New")).toBe(true);
  });
});

describe("external-folder backup inventory", () => {
  it("includes hidden configuration without exposing it in the normal tree", async () => {
    const files = new Map<string, string | Uint8Array>([
      [".obsidian/app.json", "{}"], ["deep/.obsidian/theme.json", "theme"],
      ["deep/.git/config", "excluded"], ["Note.md", "body"], [".hidden.md", "hidden"],
    ]);
    const { plugin, dirs, calls } = fakePlugin(files);
    for (const path of [".obsidian", "deep", "deep/.obsidian", "deep/.git"]) dirs.add(path);
    const adapter = new ExternalVaultAdapter(plugin, "folder");
    const backup = await adapter.listDirForBackup([".plainva", ".git", ".trash", "node_modules"]);
    expect(backup.filter((e) => !e.isDirectory).map((e) => e.path).sort()).toEqual([
      ".hidden.md", ".obsidian/app.json", "Note.md", "deep/.obsidian/theme.json",
    ].sort());
    expect(calls).not.toContain("list:deep/.git");
    expect((await adapter.listDir("", true)).filter((e) => !e.isDirectory).map((e) => e.path)).toEqual(["Note.md"]);
  });

  it("rejects an inaccessible selected folder instead of returning a partial inventory", async () => {
    const { plugin, dirs } = fakePlugin(new Map([["Note.md", "body"]]));
    dirs.add("blocked");
    const list = plugin.list.bind(plugin);
    plugin.list = async (args) => {
      if (args.path === "blocked") throw new Error("folder access denied");
      return list(args);
    };
    await expect(new ExternalVaultAdapter(plugin, "folder").listDirForBackup([])).rejects.toThrow("folder access denied");
  });
});
