import { describe, it, expect } from "vitest";
import { renameFileWithLinkUpdates, type RenameAdapter } from "./renameNote";

/** In-memory adapter + minimal query-service stub. */
function makeVault(
  files: Record<string, string>,
  backlinks: { source_path: string; target_path: string; property_key?: string | null }[]
) {
  const store = new Map(Object.entries(files));
  const adapter: RenameAdapter = {
    readTextFile: async (p) => {
      const c = store.get(p);
      if (c === undefined) throw new Error(`missing ${p}`);
      return c;
    },
    writeTextFile: async (p, c) => {
      store.set(p, c);
    },
    renameItem: async (oldPath, newPath) => {
      const c = store.get(oldPath);
      if (c === undefined) throw new Error(`missing ${oldPath}`);
      store.delete(oldPath);
      store.set(newPath, c);
    },
  };
  const queryService = {
    getBacklinks: async () => backlinks,
    db: { query: async () => Array.from(store.keys()).map((path) => ({ path })) },
  } as any;
  return { store, adapter, queryService };
}

describe("renameFileWithLinkUpdates", () => {
  it("renames the file and retargets bare + qualified wikilinks, embeds and md links", async () => {
    const { store, adapter, queryService } = makeVault(
      {
        "Projects/MOC.md": "# MOC\n",
        "a.md": "See [[MOC]] and [[Projects/MOC#Intro|Alias]].\n",
        "b.md": "Embed: ![[MOC]] and md link [about](Projects/MOC.md).\n",
      },
      [
        { source_path: "a.md", target_path: "MOC" },
        { source_path: "a.md", target_path: "Projects/MOC" },
        { source_path: "b.md", target_path: "MOC" },
        { source_path: "b.md", target_path: "Projects/MOC.md" },
      ]
    );

    const result = await renameFileWithLinkUpdates({
      adapter,
      queryService,
      oldPath: "Projects/MOC.md",
      newPath: "Projects/index.md",
    });

    expect(store.has("Projects/MOC.md")).toBe(false);
    expect(store.has("Projects/index.md")).toBe(true);
    expect(result.renamedLinks).toBe(4);
    expect(result.changedFiles).toBe(2);
    // Bare raw stays bare (basename "index" is unique in this vault).
    expect(store.get("a.md")).toContain("[[index]]");
    // Qualified raw stays qualified; the heading anchor and alias survive.
    expect(store.get("a.md")).toContain("[[Projects/index#Intro|Alias]]");
    expect(store.get("b.md")).toContain("![[index]]");
    expect(store.get("b.md")).toContain("(Projects/index.md)");
  });

  it("qualifies bare wikilinks when the new basename collides with another file", async () => {
    const { store, adapter, queryService } = makeVault(
      {
        "Projects/MOC.md": "# MOC\n",
        "Other/index.md": "# Existing listing\n",
        "a.md": "See [[MOC]].\n",
      },
      [{ source_path: "a.md", target_path: "MOC" }]
    );

    await renameFileWithLinkUpdates({
      adapter,
      queryService,
      oldPath: "Projects/MOC.md",
      newPath: "Projects/index.md",
    });

    expect(store.get("a.md")).toContain("[[Projects/index]]");
  });

  it("updates self-references inside the renamed file via its new path", async () => {
    const { store, adapter, queryService } = makeVault(
      {
        "Note.md": "Self: [[Note#Top]]\n",
      },
      [{ source_path: "Note.md", target_path: "Note" }]
    );

    const result = await renameFileWithLinkUpdates({
      adapter,
      queryService,
      oldPath: "Note.md",
      newPath: "Renamed.md",
    });

    expect(result.changedFiles).toBe(1);
    expect(store.get("Renamed.md")).toContain("[[Renamed#Top]]");
  });

  it("retargets frontmatter relation links (scalar + list) reported via property_key", async () => {
    const { store, adapter, queryService } = makeVault(
      {
        "Projects/MOC.md": "# MOC\n",
        "task.md": '---\nprojekt: "[[MOC]]"\nrefs:\n  - "[[Projects/MOC#Intro|Alias]]"\n---\nText.\n',
      },
      [
        { source_path: "task.md", target_path: "MOC", property_key: "projekt" },
        { source_path: "task.md", target_path: "Projects/MOC", property_key: "refs" },
      ]
    );

    const result = await renameFileWithLinkUpdates({
      adapter,
      queryService,
      oldPath: "Projects/MOC.md",
      newPath: "Projects/index.md",
    });

    expect(result).toEqual({ renamedLinks: 2, changedFiles: 1, linkUpdateFailed: false, changedPaths: ["task.md"] });
    expect(store.get("task.md")).toContain('projekt: "[[index]]"');
    expect(store.get("task.md")).toContain('- "[[Projects/index#Intro|Alias]]"');
  });

  it("rewrites body and frontmatter links of the same source in one write", async () => {
    const { store, adapter, queryService } = makeVault(
      {
        "MOC.md": "# MOC\n",
        "mixed.md": '---\nprojekt: "[[MOC]]"\n---\nSiehe [[MOC]].\n',
      },
      [
        { source_path: "mixed.md", target_path: "MOC" },
        { source_path: "mixed.md", target_path: "MOC", property_key: "projekt" },
      ]
    );

    const result = await renameFileWithLinkUpdates({
      adapter,
      queryService,
      oldPath: "MOC.md",
      newPath: "Index.md",
    });

    expect(result).toEqual({ renamedLinks: 2, changedFiles: 1, linkUpdateFailed: false, changedPaths: ["mixed.md"] });
    expect(store.get("mixed.md")).toContain('projekt: "[[Index]]"');
    expect(store.get("mixed.md")).toContain("Siehe [[Index]].");
  });

  it("qualifies frontmatter links on basename collision", async () => {
    const { store, adapter, queryService } = makeVault(
      {
        "Projects/MOC.md": "# MOC\n",
        "Other/index.md": "# Existing\n",
        "task.md": '---\nprojekt: "[[MOC]]"\n---\n',
      },
      [{ source_path: "task.md", target_path: "MOC", property_key: "projekt" }]
    );

    await renameFileWithLinkUpdates({
      adapter,
      queryService,
      oldPath: "Projects/MOC.md",
      newPath: "Projects/index.md",
    });

    expect(store.get("task.md")).toContain('projekt: "[[Projects/index]]"');
  });

  it("keeps the body-side fix when the frontmatter is unparseable", async () => {
    const { store, adapter, queryService } = makeVault(
      {
        "MOC.md": "# MOC\n",
        "broken.md": "---\n{ kaputt: [\n---\nSiehe [[MOC]].\n",
      },
      [
        { source_path: "broken.md", target_path: "MOC" },
        { source_path: "broken.md", target_path: "MOC", property_key: "projekt" },
      ]
    );

    const result = await renameFileWithLinkUpdates({
      adapter,
      queryService,
      oldPath: "MOC.md",
      newPath: "Index.md",
    });

    expect(result).toEqual({ renamedLinks: 1, changedFiles: 1, linkUpdateFailed: false, changedPaths: ["broken.md"] });
    expect(store.get("broken.md")).toContain("Siehe [[Index]].");
  });

  it("still renames when backlink collection fails", async () => {
    const { store, adapter } = makeVault({ "Note.md": "x\n" }, []);
    const failingQueryService = {
      getBacklinks: async () => {
        throw new Error("db down");
      },
      db: { query: async () => [] },
    } as any;

    const result = await renameFileWithLinkUpdates({
      adapter,
      queryService: failingQueryService,
      oldPath: "Note.md",
      newPath: "New.md",
    });

    expect(store.has("New.md")).toBe(true);
    expect(result).toEqual({ renamedLinks: 0, changedFiles: 0, linkUpdateFailed: true, changedPaths: [] });
  });
});
