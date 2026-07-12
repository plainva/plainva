import { describe, expect, it } from "vitest";
import { applyIndexChanges, duplicateFile, reindexAfterRename, renameInitialName, renameToName, type FileActionAdapter, type RenameReindexer } from "./fileActions";

/** In-memory adapter: text files as strings, binaries as Uint8Array. */
function makeAdapter(initial: Record<string, string | Uint8Array>) {
  const files = new Map<string, string | Uint8Array>(Object.entries(initial));
  const adapter: FileActionAdapter = {
    exists: async (p) => files.has(p),
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
