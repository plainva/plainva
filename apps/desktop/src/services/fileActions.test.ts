import { describe, expect, it } from "vitest";
import { applyIndexChanges, carryMirroredHeading, duplicateFile, moveItems, movableInto, reindexAfterRename, renameInitialName, renameToName, type FileActionAdapter, type RenameReindexer } from "./fileActions";

/** In-memory adapter: text files as strings, binaries as Uint8Array. */
function makeAdapter(initial: Record<string, string | Uint8Array>) {
  const files = new Map<string, string | Uint8Array>(Object.entries(initial));
  const adapter: FileActionAdapter = {
    exists: async (p) => files.has(p),
    listDir: async (p) => {
      const prefix = p.replace(/\/+$/, "") + "/";
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
        .map((path) => ({ path, isDirectory: false }));
    },
    readTextFile: async (p) => {
      const v = files.get(p);
      if (typeof v !== "string") throw new Error(`not a text file: ${p}`);
      return v;
    },
    writeTextFile: async (p, c) => void files.set(p, c),
    readBinaryFile: async (p) => {
      const v = files.get(p);
      if (!(v instanceof Uint8Array)) throw new Error(`not a binary file: ${p}`);
      return v;
    },
    writeBinaryFile: async (p, d) => void files.set(p, d),
    renameItem: async (from, to) => {
      const v = files.get(from);
      if (v === undefined) throw new Error(`missing: ${from}`);
      files.delete(from);
      files.set(to, v);
    },
  };
  return { adapter, files };
}

describe("renameInitialName", () => {
  it("hides .md for notes, keeps other extensions visible", () => {
    expect(renameInitialName("sub/Note.md", false)).toBe("Note");
    expect(renameInitialName("img/photo.png", false)).toBe("photo.png");
    expect(renameInitialName("db/Tasks.base", false)).toBe("Tasks.base");
    expect(renameInitialName("Projects", true)).toBe("Projects");
  });
});

describe("renameToName", () => {
  it("appends .md for notes typed without extension and keeps the folder", async () => {
    const { adapter, files } = makeAdapter({ "sub/Old.md": "# Old" });
    const r = await renameToName({ adapter, queryService: null, oldPath: "sub/Old.md", newName: "New", isFolder: false });
    expect(r).toEqual({ ok: true, newPath: "sub/New.md", renamedLinks: 0, changedFiles: 0, linkUpdateFailed: false, changedPaths: [] });
    expect(files.has("sub/New.md")).toBe(true);
    expect(files.has("sub/Old.md")).toBe(false);
  });

  it("does NOT append .md when renaming an attachment (old tree logic produced photo2.png.md)", async () => {
    const { adapter, files } = makeAdapter({ "img/photo.png": new Uint8Array([1]) });
    const r = await renameToName({ adapter, queryService: null, oldPath: "img/photo.png", newName: "photo2.png", isFolder: false });
    expect(r).toEqual({ ok: true, newPath: "img/photo2.png", renamedLinks: 0, changedFiles: 0, linkUpdateFailed: false, changedPaths: [] });
    expect(files.has("img/photo2.png")).toBe(true);
  });

  it("rejects empty names, path separators and unchanged names", async () => {
    const { adapter } = makeAdapter({ "Note.md": "x" });
    expect(await renameToName({ adapter, queryService: null, oldPath: "Note.md", newName: "  ", isFolder: false })).toEqual({ ok: false, reason: "invalid-name" });
    expect(await renameToName({ adapter, queryService: null, oldPath: "Note.md", newName: "a/b", isFolder: false })).toEqual({ ok: false, reason: "invalid-name" });
    expect(await renameToName({ adapter, queryService: null, oldPath: "Note.md", newName: "Note", isFolder: false })).toEqual({ ok: false, reason: "unchanged" });
  });

  it("refuses to overwrite an existing target", async () => {
    const { adapter, files } = makeAdapter({ "A.md": "a", "B.md": "b" });
    const r = await renameToName({ adapter, queryService: null, oldPath: "A.md", newName: "B", isFolder: false });
    expect(r).toEqual({ ok: false, reason: "already-exists" });
    expect(files.get("A.md")).toBe("a");
    expect(files.get("B.md")).toBe("b");
  });

  it("routes .base renames through the link updater AND sweeps templateFor assignments", async () => {
    const { adapter, files } = makeAdapter({
      "db/Tasks.base": "views: []",
      "Note.md": "Embedded: ![[Tasks.base]]",
      "Templates": "DIR",
      "Templates/Task.md": '---\nplainva:\n  templateFor:\n    - "[[Tasks.base]]"\n---\n# {{title}}\n',
      "Templates/Other.md": '---\nplainva:\n  templateFor: "[[Other.base]]"\n---\nx',
    });
    const queryService = {
      getBacklinks: async () => [
        { source_path: "Note.md", target_path: "Tasks.base", link_type: "embed", anchor: null, property_key: null },
      ],
      db: { query: async () => [...files.keys()].filter((p) => p !== "Templates").map((path) => ({ path })) },
    } as never;
    const r = await renameToName({
      adapter,
      queryService,
      oldPath: "db/Tasks.base",
      newName: "Projekte.base",
      isFolder: false,
      templateFolder: "Templates",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.newPath).toBe("db/Projekte.base");
      // Body embed retargeted (E5 — this silently broke before).
      expect(files.get("Note.md")).toContain("![[Projekte.base]]");
      // templateFor assignment swept (P4 — deliberately not in the link index).
      expect(files.get("Templates/Task.md")).toContain("[[Projekte.base]]");
      expect(files.get("Templates/Task.md")).not.toContain("Tasks.base");
      // Assignments to OTHER bases stay untouched.
      expect(files.get("Templates/Other.md")).toContain("[[Other.base]]");
      expect(r.changedPaths).toContain("Note.md");
      expect(r.changedPaths).toContain("Templates/Task.md");
      expect(r.renamedLinks).toBe(2);
      expect(r.linkUpdateFailed).toBe(false);
    }
  });

  it("skips the templateFor sweep when no template folder is provided (plain .base link update)", async () => {
    const { adapter, files } = makeAdapter({ "db/Tasks.base": "views: []" });
    const queryService = {
      getBacklinks: async () => [],
      db: { query: async () => [...files.keys()].map((path) => ({ path })) },
    } as never;
    const r = await renameToName({ adapter, queryService, oldPath: "db/Tasks.base", newName: "X.base", isFolder: false });
    expect(r.ok).toBe(true);
    expect(files.has("db/X.base")).toBe(true);
  });

  it("renames folders without touching extensions", async () => {
    const { adapter, files } = makeAdapter({ "Projects": "DIR" });
    const r = await renameToName({ adapter, queryService: null, oldPath: "Projects", newName: "Archive.md", isFolder: true });
    expect(r).toEqual({ ok: true, newPath: "Archive.md", renamedLinks: 0, changedFiles: 0, linkUpdateFailed: false, changedPaths: [] });
    expect(files.has("Archive.md")).toBe(true);
  });

  it("routes notes through the link updater when a query service is present", async () => {
    const { adapter } = makeAdapter({ "Old.md": "# Old" });
    // Minimal query service: one backlink (target_path is the RAW link target
    // as indexed — "Old" for the bare wikilink), no basename collision.
    const queryService = {
      getBacklinks: async () => [{ source_path: "Ref.md", target_path: "Old" }],
      db: { query: async () => [{ path: "Old.md" }, { path: "Ref.md" }] },
    } as never;
    const files = (adapter as unknown as { readTextFile(p: string): Promise<string> });
    // Referencing note exists for the rewrite pass.
    await adapter.writeTextFile("Ref.md", "See [[Old]].");
    const r = await renameToName({ adapter, queryService, oldPath: "Old.md", newName: "New", isFolder: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.newPath).toBe("New.md");
      expect(r.renamedLinks).toBe(1);
      expect(r.linkUpdateFailed).toBe(false);
      // serializeMarkdownAst terminates the file with a newline.
      expect(await files.readTextFile("Ref.md")).toBe("See [[New]].\n");
    }
  });

  it("renames anyway but flags linkUpdateFailed when backlink collection throws (P1.9)", async () => {
    const { adapter, files } = makeAdapter({ "Old.md": "# Old" });
    const queryService = {
      getBacklinks: async () => { throw new Error("index locked"); },
      db: { query: async () => [] },
    } as never;

    const r = await renameToName({ adapter, queryService, oldPath: "Old.md", newName: "New", isFolder: false });

    // The rename itself must go through (never block on the index)…
    expect(r.ok).toBe(true);
    expect(files.has("New.md")).toBe(true);
    // …but the caller must be able to warn that links were NOT retargeted.
    if (r.ok) expect(r.linkUpdateFailed).toBe(true);
  });
});

describe("duplicateFile", () => {
  it("copies text files and picks the next free (Kopie) name", async () => {
    const { adapter, files } = makeAdapter({ "Note.md": "# N", "Note (Kopie).md": "taken" });
    const copy = await duplicateFile(adapter, "Note.md", "Kopie");
    expect(copy).toBe("Note (Kopie 2).md");
    expect(files.get(copy)).toBe("# N");
  });

  it("copies attachments byte-wise", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { adapter, files } = makeAdapter({ "img/photo.png": bytes });
    const copy = await duplicateFile(adapter, "img/photo.png", "Kopie");
    expect(copy).toBe("img/photo (Kopie).png");
    expect(files.get(copy)).toEqual(bytes);
  });
});

describe("reindexAfterRename", () => {
  function makeReindexer() {
    const calls = { full: 0, indexed: [] as string[], removed: [] as string[] };
    const indexer: RenameReindexer = {
      indexVaultFull: async () => void calls.full++,
      indexPath: async (p) => void calls.indexed.push(p),
      removePathFromIndex: async (p) => void calls.removed.push(p),
    };
    return { indexer, calls };
  }

  it("indexes only the affected paths for a file rename (no full scan) — Issue #9", async () => {
    const { indexer, calls } = makeReindexer();
    await reindexAfterRename(indexer, {
      oldPath: "Old.md",
      newPath: "New.md",
      isFolder: false,
      changedPaths: ["Ref.md", "Other.md"],
    });
    expect(calls.full).toBe(0);
    expect(calls.removed).toEqual(["Old.md"]);
    expect(calls.indexed).toEqual(["New.md", "Ref.md", "Other.md"]);
  });

  it("de-duplicates the new path when it also appears among the changed sources", async () => {
    const { indexer, calls } = makeReindexer();
    await reindexAfterRename(indexer, {
      oldPath: "Old.md",
      newPath: "New.md",
      isFolder: false,
      changedPaths: ["New.md"], // self-reference rewrite reports the renamed file
    });
    expect(calls.indexed).toEqual(["New.md"]);
  });

  it("falls back to a full scan for a folder rename (many paths change at once)", async () => {
    const { indexer, calls } = makeReindexer();
    await reindexAfterRename(indexer, {
      oldPath: "Projects",
      newPath: "Archive",
      isFolder: true,
      changedPaths: [],
    });
    expect(calls.full).toBe(1);
    expect(calls.removed).toEqual([]);
    expect(calls.indexed).toEqual([]);
  });
});

describe("applyIndexChanges", () => {
  function makeReindexer() {
    const calls = { full: 0, indexed: [] as string[], removed: [] as string[] };
    const indexer: RenameReindexer = {
      indexVaultFull: async () => void calls.full++,
      indexPath: async (p) => void calls.indexed.push(p),
      removePathFromIndex: async (p) => void calls.removed.push(p),
    };
    return { indexer, calls };
  }

  it("de-indexes removed paths and indexes added paths (deduped), no full scan", async () => {
    const { indexer, calls } = makeReindexer();
    await applyIndexChanges(indexer, { removed: ["Old.md"], added: ["New.md", "New.md", "Ref.md"] });
    expect(calls.full).toBe(0);
    expect(calls.removed).toEqual(["Old.md"]);
    expect(calls.indexed).toEqual(["New.md", "Ref.md"]);
  });

  it("runs a full scan and ignores removed/added when needsFullScan is set", async () => {
    const { indexer, calls } = makeReindexer();
    await applyIndexChanges(indexer, { removed: ["a.md"], added: ["b.md"], needsFullScan: true });
    expect(calls.full).toBe(1);
    expect(calls.removed).toEqual([]);
    expect(calls.indexed).toEqual([]);
  });

  it("is a no-op for an empty change (e.g. creating an empty folder)", async () => {
    const { indexer, calls } = makeReindexer();
    await applyIndexChanges(indexer, { added: [] });
    expect(calls.full).toBe(0);
    expect(calls.removed).toEqual([]);
    expect(calls.indexed).toEqual([]);
  });
});

// Issue #34: a database entry starts as "# <file name>". Renaming the file
// alone would leave the note titled Task_1 in the text while the tree shows the
// new name — but a heading the user wrote must never be rewritten.
describe("carryMirroredHeading", () => {
  it("moves a heading that mirrors the old file name", () => {
    expect(carryMirroredHeading("# Task_1\n\nBody\n", "Task_1", "Fencing quote")).toBe("# Fencing quote\n\nBody\n");
  });

  it("keeps frontmatter untouched and finds the heading behind it", () => {
    const src = "---\ntype: Note\nstatus: Offen\n---\n\n# Task_1\n\nBody\n";
    expect(carryMirroredHeading(src, "Task_1", "Steuer")).toBe("---\ntype: Note\nstatus: Offen\n---\n\n# Steuer\n\nBody\n");
  });

  it("leaves a heading the user wrote alone", () => {
    expect(carryMirroredHeading("# My own title\n\nBody\n", "Task_1", "Fencing quote")).toBeNull();
  });

  it("ignores a matching heading that is not the first content line", () => {
    expect(carryMirroredHeading("Intro text\n\n# Task_1\n", "Task_1", "New")).toBeNull();
  });

  it("does nothing without a heading", () => {
    expect(carryMirroredHeading("Just a body.\n", "Task_1", "New")).toBeNull();
  });

  it("preserves the heading level and trailing spaces", () => {
    expect(carryMirroredHeading("### Task_1  \nx", "Task_1", "New")).toBe("### New  \nx");
  });
});

describe("renameToName with carryHeading", () => {
  it("renames the file and its mirrored heading in one go", async () => {
    const { adapter, files } = makeAdapter({ "Tasks/Task_1.md": "# Task_1\n\nBody\n" });
    const res = await renameToName({ adapter, queryService: null, oldPath: "Tasks/Task_1.md", newName: "Fencing quote", isFolder: false, carryHeading: true });
    expect(res.ok).toBe(true);
    expect(files.get("Tasks/Fencing quote.md")).toBe("# Fencing quote\n\nBody\n");
  });

  it("leaves the body alone without the flag", async () => {
    const { adapter, files } = makeAdapter({ "Tasks/Task_1.md": "# Task_1\n\nBody\n" });
    await renameToName({ adapter, queryService: null, oldPath: "Tasks/Task_1.md", newName: "Fencing quote", isFolder: false });
    expect(files.get("Tasks/Fencing quote.md")).toBe("# Task_1\n\nBody\n");
  });
});

describe("moveItems (Issue #77: drag & drop and \"Move to…\" share one path)", () => {
  const isFolder = (p: string) => !/\.[a-z]+$/i.test(p);

  it("refuses the impossible targets before touching the vault", () => {
    // Moving a note UP into "b" is fine; "b" itself and the empty path are not.
    expect(movableInto(["a/Note.md", "b", "b/sub/x.md", ""], "b")).toEqual(["a/Note.md", "b/sub/x.md"]);
    // Into itself, into a descendant, and "where it already is" all stay put.
    expect(movableInto(["b"], "b")).toEqual([]);
    expect(movableInto(["b"], "b/sub")).toEqual([]);
    expect(movableInto(["b/sub/x.md"], "b/sub")).toEqual([]);
    expect(movableInto(["Root.md"], "")).toEqual([]);
  });

  it("moves a note, tells the tabs, and relocates the index entry", async () => {
    const { adapter, files } = makeAdapter({ "Inbox/Note.md": "# N", "Projects/.keep": "" });
    const moved: string[] = [];
    const index = { removed: [] as string[], added: [] as string[], full: 0 };
    const indexer: RenameReindexer = {
      indexVaultFull: async () => { index.full += 1; },
      indexPath: async (p) => { index.added.push(p); },
      removePathFromIndex: async (p) => { index.removed.push(p); },
    };
    const r = await moveItems(
      { adapter, queryService: null, indexer, isFolder, onMoved: (f, t) => moved.push(`${f}>${t}`) },
      ["Inbox/Note.md"],
      "Projects",
    );
    expect(r.errors).toEqual([]);
    expect(r.moved).toEqual([{ type: "move", from: "Inbox/Note.md", to: "Projects/Note.md", isFolder: false }]);
    expect(files.has("Projects/Note.md")).toBe(true);
    expect(files.has("Inbox/Note.md")).toBe(false);
    expect(moved).toEqual(["Inbox/Note.md>Projects/Note.md"]);
    expect(index).toEqual({ removed: ["Inbox/Note.md"], added: ["Projects/Note.md"], full: 0 });
  });

  it("moves to the vault root and rescans fully when a folder moves", async () => {
    const { adapter: base, files } = makeAdapter({ "A/B/x.md": "x", "A/y.md": "y" });
    // The in-memory adapter knows files only; a folder rename moves the prefix.
    const adapter: FileActionAdapter = {
      ...base,
      renameItem: async (from, to) => {
        for (const key of [...files.keys()]) {
          if (key === from || key.startsWith(from + "/")) {
            files.set(to + key.slice(from.length), files.get(key)!);
            files.delete(key);
          }
        }
      },
    };
    const index = { full: 0, added: [] as string[] };
    const indexer: RenameReindexer = {
      indexVaultFull: async () => { index.full += 1; },
      indexPath: async (p) => { index.added.push(p); },
      removePathFromIndex: async () => {},
    };
    const r = await moveItems({ adapter, queryService: null, indexer, isFolder }, ["A/B"], "");
    expect(r.moved).toEqual([{ type: "move", from: "A/B", to: "B", isFolder: true }]);
    expect(files.has("B/x.md")).toBe(true);
    expect(files.has("A/B/x.md")).toBe(false);
    expect(index).toEqual({ full: 1, added: [] });
  });

  it("keeps a note whose name is already taken and reports it by name", async () => {
    const { adapter, files } = makeAdapter({ "Inbox/Note.md": "new", "Projects/Note.md": "old" });
    const r = await moveItems({ adapter, queryService: null, indexer: null, isFolder }, ["Inbox/Note.md"], "Projects");
    expect(r.moved).toEqual([]);
    expect(r.errors).toEqual(["Note.md"]);
    expect(files.get("Projects/Note.md")).toBe("old");
    expect(files.get("Inbox/Note.md")).toBe("new");
  });
});
