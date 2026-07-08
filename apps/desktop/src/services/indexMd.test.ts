import { describe, it, expect } from "vitest";
import {
  collectFolderIndexInfos,
  generateIndexForFolder,
  adoptFileAsIndex,
  type IndexMdAdapter,
} from "./indexMd";

function makeVault(files: Record<string, string>, properties: { path: string; value: string }[] = []) {
  const store = new Map(Object.entries(files));
  const dirs = new Set<string>();
  const adapter: IndexMdAdapter = {
    readTextFile: async (p) => {
      const c = store.get(p);
      if (c === undefined) throw new Error(`missing ${p}`);
      return c;
    },
    writeTextFile: async (p, c) => { store.set(p, c); },
    renameItem: async (oldPath, newPath) => {
      const c = store.get(oldPath);
      if (c === undefined) throw new Error(`missing ${oldPath}`);
      store.delete(oldPath);
      store.set(newPath, c);
    },
    createDir: async (p) => { dirs.add(p); },
    exists: async (p) => store.has(p) || dirs.has(p),
  };
  const queryService = {
    getBacklinks: async () => [],
    db: {
      query: async (sql: string) => {
        if (sql.includes("p.key = 'description'")) return properties;
        if (sql.includes("SELECT path, title")) {
          return Array.from(store.keys())
            .filter((p) => !p.startsWith(".plainva/"))
            .map((path) => ({ path, title: path.split("/").pop()!.replace(/\.md$/i, "") }));
        }
        return Array.from(store.keys())
          .filter((p) => !p.startsWith(".plainva/"))
          .map((path) => ({ path }));
      },
    },
  } as any;
  return { store, adapter, queryService };
}

describe("collectFolderIndexInfos", () => {
  it("groups folders, flags existing/concept index.md and ranks candidates", async () => {
    const { adapter, queryService } = makeVault({
      "Projects/MOC.md": "# MOC\n",
      "Projects/Alpha.md": "# A\n",
      "Other/index.md": "---\ntype: Note\n---\nNot a listing\n",
      "Other/x.md": "# x\n",
      "root.md": "# r\n",
    });
    const infos = await collectFolderIndexInfos({ queryService, adapter });

    const root = infos.find((i) => i.folder === "")!;
    const projects = infos.find((i) => i.folder === "Projects")!;
    const other = infos.find((i) => i.folder === "Other")!;

    expect(infos[0].folder).toBe(""); // root first
    expect(projects.candidates[0].path).toBe("Projects/MOC.md");
    expect(projects.hasIndex).toBe(false);
    expect(other.hasIndex).toBe(true);
    expect(other.indexIsConcept).toBe(true);
    expect(root.fileCount).toBe(1);
  });
});

describe("generateIndexForFolder", () => {
  it("writes a spec-shaped listing with titles, descriptions and subfolders", async () => {
    const { store, adapter, queryService } = makeVault(
      {
        "Projects/Alpha.md": "# A\n",
        "Projects/Beta.md": "# B\n",
        "Projects/Sub/Deep.md": "# D\n",
      },
      [{ path: "Projects/Alpha.md", value: "First project." }]
    );

    const result = await generateIndexForFolder({
      adapter,
      queryService,
      folder: "Projects",
      heading: "Projects",
      subfoldersHeading: "Ordner",
    });

    expect(result.indexPath).toBe("Projects/index.md");
    expect(result.overwrote).toBe(false);
    const content = store.get("Projects/index.md")!;
    expect(content).toContain("# Projects");
    expect(content).toContain("* [Alpha](Alpha.md) - First project.");
    expect(content).toContain("* [Beta](Beta.md)");
    expect(content).toContain("* [Sub](Sub/)");
    expect(content.startsWith("---")).toBe(false);
  });

  it("backs up an existing index.md and adds okf_version at the root", async () => {
    const { store, adapter, queryService } = makeVault({
      "index.md": "old listing\n",
      "a.md": "# a\n",
    });

    const result = await generateIndexForFolder({
      adapter,
      queryService,
      folder: "",
      heading: "Vault",
      subfoldersHeading: "Ordner",
    });

    expect(result.overwrote).toBe(true);
    expect(store.get("index.md")!.startsWith('---\nokf_version: "0.1"\n---\n')).toBe(true);
    const backupKey = [...store.keys()].find((k) => k.startsWith(".plainva/backups/index-md-") && k.endsWith("/index.md"));
    expect(backupKey).toBeDefined();
    expect(store.get(backupKey!)).toBe("old listing\n");
  });
});

describe("adoptFileAsIndex", () => {
  it("prepares (frontmatter removed, wikilinks converted) and renames to index.md", async () => {
    const { store, adapter, queryService } = makeVault({
      "Projects/MOC.md": "---\ntype: MOC\n---\n# Projekte\n\n- [[Alpha]]\n- ![[Bild.png]]\n",
      "Projects/Alpha.md": "# A\n",
    });

    const result = await adoptFileAsIndex({
      adapter,
      queryService,
      candidatePath: "Projects/MOC.md",
      folder: "Projects",
      prepare: true,
    });

    expect(result.indexPath).toBe("Projects/index.md");
    expect(store.has("Projects/MOC.md")).toBe(false);
    const content = store.get("Projects/index.md")!;
    expect(content.startsWith("---")).toBe(false);
    expect(content).toContain("[Alpha](Alpha.md)");
    expect(content).toContain("![[Bild.png]]");
    expect(result.preparation?.converted).toBe(1);
    expect(result.preparation?.embeds).toBe(1);
    // The pre-preparation original is backed up.
    const backupKey = [...store.keys()].find((k) => k.includes("/backups/index-md-") && k.endsWith("Projects/MOC.md"));
    expect(store.get(backupKey!)).toContain("type: MOC");
  });

  it("adopts without preparation, leaving the content untouched", async () => {
    const { store, adapter, queryService } = makeVault({
      "Projects/Übersicht.md": "---\ntype: MOC\n---\nInhalt mit [[Alpha]]\n",
      "Projects/Alpha.md": "# A\n",
    });

    await adoptFileAsIndex({
      adapter,
      queryService,
      candidatePath: "Projects/Übersicht.md",
      folder: "Projects",
      prepare: false,
    });

    expect(store.get("Projects/index.md")).toBe("---\ntype: MOC\n---\nInhalt mit [[Alpha]]\n");
  });
});
