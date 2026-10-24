// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  BackupVaultAdapter, ConflictAwareVaultAdapter, DEFAULT_BACKUP_RETENTION, QueueingVaultAdapter, SyncQueue, SyncStateRepository, VaultFileExistsError,
  VaultFileNotFoundError, VaultIndexer, parseJournal, updateVaultText,
} from "@plainva/core";
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

/**
 * A folder the user picked is where another app writes into a vault: a second
 * editor, a file manager, a sync client. A change of a note where it lies — a
 * task's box, a property — reads the file inside the chain's gate, so it
 * starts from what that app left (finding 2026-10-12, the addendum to it).
 */
describe("a change of a note in a picked folder, through the chain boot builds over it", () => {
  it("lands after the note was saved here and then changed by another app: nothing to merge, no conflict copy", async () => {
    const files = new Map<string, string | Uint8Array>([["Note.md", "# Title\n\n- [ ] Call Ada\n"]]);
    const { plugin } = fakePlugin(files);
    const folder = new ExternalVaultAdapter(plugin, "h1");
    await folder.initialize();
    const db = await realSqlite();
    try {
      // boot(): the picked folder, above it versions, the queue and the conflict check.
      const repo = new SyncStateRepository(db, folder, "phone-a");
      const chain = new ConflictAwareVaultAdapter(
        new QueueingVaultAdapter(new BackupVaultAdapter(folder, { policy: DEFAULT_BACKUP_RETENTION }), new SyncQueue(db)), repo, undefined, repo, "external-folder",
      );
      // Saved from the editor: the chain knows this text, and no sync has taken it as a merge base.
      await chain.writeEditorText("Note.md", "# Title\n\nEdited here.\n\n- [ ] Call Ada\n", "# Title\n\n- [ ] Call Ada\n");
      // Another app writes into the folder — the map is the folder.
      files.set("Note.md", "# Title\n\nEdited here.\n\n- [ ] Call Ada\n\nA line another app added.\n");

      const update = await updateVaultText(chain, "Note.md", (note) => note.replace("- [ ] Call Ada", "- [x] Call Ada"));

      // It used to be "base version not found" and a conflict copy: the writer handed the chain the
      // whole text, and for the text the chain knew no copy was kept to merge against.
      expect(update.changed).toBe(true);
      expect(text(files.get("Note.md")!)).toBe("# Title\n\nEdited here.\n\n- [x] Call Ada\n\nA line another app added.\n");
      expect(await chain.listConflictSessions()).toEqual([]);
      expect([...files.keys()].filter((path) => path.includes(".CONFLICT"))).toEqual([]);
      // And the chain knows the file again: the next change from outside is seen as one.
      expect(chain.wasWrittenByUs("Note.md", (await repo.getSyncState("Note.md"))!.local_sha256!)).toBe(true);
    } finally { await db.close(); }
  });
});

/**
 * A walk over a picked folder follows the desktop's rules (issue #125, the
 * iPhone's half of #72). The iPhone's plugin follows a link to what it points
 * at, names a link that points nowhere instead of listing it as a file, and
 * gives every folder its identity; the walk here names what it could not
 * list, cuts a link back into a folder it is already in, and goes on.
 */
describe("a walk over a picked folder (issue #125)", () => {
  type Listed = Awaited<ReturnType<ReturnType<typeof fakePlugin>["plugin"]["list"]>>;

  it("names a link that points nowhere, and the full scan indexes the rest of the vault", async () => {
    const files = new Map<string, string | Uint8Array>([
      ["Inbox.md", "# Inbox"], ["Projects/Plan.md", "# Plan"], ["Projects/Zenn/draft.md", "# Draft"],
    ]);
    const { plugin } = fakePlugin(files);
    const list = plugin.list.bind(plugin);
    plugin.list = async (args): Promise<Listed> => {
      const listed = await list(args);
      return args.path === "Projects/Zenn" ? { ...listed, skipped: [{ name: "articles", reason: "unreadable" }] } : listed;
    };
    const adapter = new ExternalVaultAdapter(plugin, "folder");
    const listing = await adapter.listDirReport("", true);
    expect(listing.skipped).toEqual([{ path: "Projects/Zenn/articles", reason: "unreadable" }]);
    expect(listing.files.map((f) => f.path)).not.toContain("Projects/Zenn/articles");

    const db = await realSqlite();
    try {
      const report = await new VaultIndexer(adapter, db).indexVaultFull("open, empty index");
      expect(report.skipped).toEqual([{ path: "Projects/Zenn/articles", reason: "unreadable" }]);
      const indexed = (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path);
      expect(indexed).toEqual(["Inbox.md", "Projects/Plan.md", "Projects/Zenn/draft.md"]);
    } finally {
      await db.close();
    }
  });

  it("names a folder below that cannot be listed and lists the rest — the plain listing too", async () => {
    const { plugin, dirs } = fakePlugin(new Map([["Note.md", "body"], ["Open/a.md", "a"]]));
    dirs.add("Locked");
    const list = plugin.list.bind(plugin);
    plugin.list = async (args) => {
      if (args.path === "Locked") throw new Error("The folder cannot be opened");
      return list(args);
    };
    const adapter = new ExternalVaultAdapter(plugin, "folder");
    const listing = await adapter.listDirReport("", true);
    expect(listing.skipped).toEqual([{ path: "Locked", reason: "unreadable" }]);
    expect(listing.files.map((f) => f.path).sort()).toEqual(["Locked", "Note.md", "Open", "Open/a.md"]);
    expect((await adapter.listDir("", true)).map((f) => f.path).sort()).toEqual(["Locked", "Note.md", "Open", "Open/a.md"]);
    // The backup inventory must be whole: there the folder still fails it.
    await expect(adapter.listDirForBackup([])).rejects.toThrow("The folder cannot be opened");
  });

  it("cuts a link back into a folder the walk is already in, and names it a cycle", async () => {
    const { plugin } = fakePlugin(new Map([["note.md", "n"], ["a/x.md", "x"]]));
    const list = plugin.list.bind(plugin);
    // The link `a/loop` points at the vault's own folder: the plugin lists it
    // as a folder carrying the root's identity, and listing it lists the root.
    plugin.list = async (args): Promise<Listed> => {
      const at = args.path.endsWith("/loop") || args.path === "a/loop" ? "" : args.path;
      const listed = await list({ ...args, path: at });
      const entries = listed.entries.map((e) => (e.isDirectory && e.name === "a" ? { ...e, identity: "1:2" } : e));
      if (at === "a") entries.push({ name: "loop", isDirectory: true, size: 0, mtime: 0, identity: "1:1" });
      return { entries, identity: at === "" ? "1:1" : at === "a" ? "1:2" : undefined };
    };
    const listing = await new ExternalVaultAdapter(plugin, "folder").listDirReport("", true);
    expect(listing.skipped).toEqual([{ path: "a/loop", reason: "cycle" }]);
    expect(listing.files.map((f) => f.path).sort()).toEqual(["a", "a/loop", "a/x.md", "note.md"]);
  });

  it("cuts a chain deeper than any vault where the platform names no identity", async () => {
    const { plugin } = fakePlugin(new Map([["note.md", "n"]]));
    const list = plugin.list.bind(plugin);
    plugin.list = async (args): Promise<Listed> => {
      if (args.path === "") return list(args).then((l) => ({ entries: [...l.entries, { name: "d", isDirectory: true, size: 0, mtime: 0 }] }));
      return { entries: [{ name: "d", isDirectory: true, size: 0, mtime: 0 }] };
    };
    const listing = await new ExternalVaultAdapter(plugin, "folder").listDirReport("", true);
    expect(listing.skipped).toHaveLength(1);
    expect(listing.skipped[0].reason).toBe("cycle");
    expect(listing.skipped[0].path.split("/")).toHaveLength(33);
  });

  it("follows a link in the walk of the vault, and leaves it out of the backup inventory, as the desktop's backup does", async () => {
    const { plugin } = fakePlugin(new Map([["note.md", "n"], ["Shared/far.md", "far"]]));
    const list = plugin.list.bind(plugin);
    // `Shared` is a link to a folder outside the picked one: the plugin lists it as that folder, and says so.
    plugin.list = async (args): Promise<Listed> => {
      const listed = await list(args);
      return { ...listed, entries: listed.entries.map((e) => (e.name === "Shared" ? { ...e, link: true, identity: "2:9" } : e)) };
    };
    const adapter = new ExternalVaultAdapter(plugin, "folder");
    expect((await adapter.listDirReport("", true)).files.map((f) => f.path).sort()).toEqual(["Shared", "Shared/far.md", "note.md"]);
    expect((await adapter.listDirForBackup([])).map((f) => f.path).sort()).toEqual(["note.md"]);
  });

  it("keeps the backup inventory whole or failing: what it cannot pack fails it, a dead link or a socket does not", async () => {
    const files = new Map<string, string | Uint8Array>([["note.md", "n"], ["Projects/plan.md", "p"]]);
    const { plugin } = fakePlugin(files);
    const list = plugin.list.bind(plugin);
    let skipped: { name: string; reason: "unreadable"; kind: "link" | "special" | "name" | "unreadable" }[] = [
      { name: "articles", reason: "unreadable", kind: "link" },
      { name: "pipe", reason: "unreadable", kind: "special" },
    ];
    plugin.list = async (args): Promise<Listed> => {
      const listed = await list(args);
      return args.path === "Projects" ? { ...listed, skipped } : listed;
    };
    const adapter = new ExternalVaultAdapter(plugin, "folder");
    expect((await adapter.listDirForBackup([])).filter((f) => !f.isDirectory).map((f) => f.path).sort()).toEqual(["Projects/plan.md", "note.md"]);
    // The walk of the vault names all of them.
    expect((await adapter.listDirReport("", true)).skipped.map((s) => s.path)).toEqual(["Projects/articles", "Projects/pipe"]);

    skipped = [{ name: "back\\slash.md", reason: "unreadable", kind: "name" }];
    await expect(adapter.listDirForBackup([])).rejects.toThrow("Cannot back up Projects/back\\slash.md");
  });

  it("still fails when the folder asked for cannot be listed", async () => {
    const { plugin } = fakePlugin(new Map([["Note.md", "body"]]));
    plugin.list = async () => { throw new Error("folder access expired"); };
    await expect(new ExternalVaultAdapter(plugin, "folder").listDirReport("", true)).rejects.toThrow("folder access expired");
  });

  it("lists what a recursive delete removes: not what its links point at, as deep as the folder goes, and what it cannot list named", async () => {
    // The snapshot before a folder is deleted for good (BackupVaultAdapter):
    // the delete takes a link and leaves what it points at.
    const deep = Array.from({ length: 40 }, (_, i) => `d${i}`).join("/");
    const { plugin } = fakePlugin(new Map([["Del/note.md", "n"], ["Del/Shared/far.md", "far"], ["Del/Open/a.md", "a"], [`Del/${deep}/end.md`, "e"]]));
    const list = plugin.list.bind(plugin);
    plugin.list = async (args): Promise<Listed> => {
      if (args.path === "Del/Open") throw new Error("The folder cannot be opened");
      const listed = await list(args);
      // `Shared` is a link to a folder elsewhere, `gone` one that points nowhere.
      const entries = listed.entries.map((e) => (e.name === "Shared" ? { ...e, link: true, identity: "2:9" } : e));
      return args.path === "Del" ? { ...listed, entries, skipped: [{ name: "gone", reason: "unreadable", kind: "link" }] } : { ...listed, entries };
    };
    const adapter = new ExternalVaultAdapter(plugin, "folder");
    const own = await adapter.listDirReport("Del", true, { followLinks: false });
    const paths = own.files.map((f) => f.path);
    expect(paths).not.toContain("Del/Shared");
    expect(paths).not.toContain("Del/Shared/far.md");
    expect(paths).toContain("Del/note.md");
    expect(paths).toContain(`Del/${deep}/end.md`);
    expect(own.skipped).toEqual([{ path: "Del/Open", reason: "unreadable" }]);
    // The walk of the vault follows the link and cuts the chain, as before.
    const walked = await adapter.listDirReport("Del", true);
    expect(walked.files.map((f) => f.path)).toContain("Del/Shared/far.md");
    expect(walked.files.map((f) => f.path)).not.toContain(`Del/${deep}/end.md`);
    expect(walked.skipped.map((s) => s.reason).sort()).toEqual(["cycle", "unreadable", "unreadable"]);
  });

  it("lists nothing of a folder that is itself a link when asked without links: the delete takes the link alone", async () => {
    const { plugin } = fakePlugin(new Map([["note.md", "n"], ["Linked/far.md", "far"]]));
    // `Linked` is a link to a folder elsewhere: the plugin answers for what it points at, and says so.
    const stat = plugin.stat.bind(plugin);
    plugin.stat = async (args) => {
      const res = await stat(args);
      return args.path === "Linked" && res.entry ? { entry: { ...res.entry, link: true } } : res;
    };
    const adapter = new ExternalVaultAdapter(plugin, "folder");
    expect(await adapter.listDirReport("Linked", true, { followLinks: false })).toEqual({ files: [], skipped: [] });
    // The walk of the vault follows it, as before.
    expect((await adapter.listDirReport("Linked", true)).files.map((f) => f.path)).toEqual(["Linked/far.md"]);
  });

  it("packs two folders the platform gives one identity: without a link between them there is nothing to cut", async () => {
    const { plugin } = fakePlugin(new Map([["A/x.md", "x"], ["B/y.md", "y"]]));
    const list = plugin.list.bind(plugin);
    plugin.list = async (args): Promise<Listed> => {
      const listed = await list(args);
      return { ...listed, entries: listed.entries.map((e) => (e.isDirectory ? { ...e, identity: "7:7" } : e)) };
    };
    const packed = (await new ExternalVaultAdapter(plugin, "folder").listDirForBackup([])).filter((f) => !f.isDirectory).map((f) => f.path).sort();
    expect(packed).toEqual(["A/x.md", "B/y.md"]);
  });
});
