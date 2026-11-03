import { describe, it, expect, vi } from "vitest";
import {
  collectFolderIndexInfos,
  generateIndexForFolder,
  adoptFileAsIndex,
  adoptionSummary,
  foldersMissingIndex,
  pinOverviewLinks,
  planOverviewLinkPins,
  type IndexMdAdapter,
} from "./indexMd";
import { resolveLinkTarget } from "@plainva/core";

describe("foldersMissingIndex (WP4)", () => {
  it("returns only the folders without an index.md, preserving order", () => {
    const infos = [
      { folder: "", hasIndex: true },
      { folder: "Projects", hasIndex: false },
      { folder: "Areas", hasIndex: true },
      { folder: "Archive", hasIndex: false },
    ];
    expect(foldersMissingIndex(infos)).toEqual(["Projects", "Archive"]);
  });
  it("returns an empty list when every folder already has one", () => {
    expect(foldersMissingIndex([{ folder: "A", hasIndex: true }])).toEqual([]);
  });
});

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
    // The link rule's corpus, as the index holds it (VaultQueryService.linkTargets).
    linkTargets: async () =>
      Array.from(store.keys())
        .filter((p) => !p.startsWith(".plainva/"))
        .map((path) => ({ path, title: path.split("/").pop()!.replace(/\.md$/i, ""), mode: /\.md$/i.test(path) ? "obsidian" : "attachment" })),
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

  it("takes an index.md whose block declares nothing for a listing, not for a concept", async () => {
    // One answer for every form of "no entries": `---` on `---` counted as no
    // frontmatter, a blank line between the fences as a violation.
    const { adapter, queryService } = makeVault({
      "index.md": "---\n---\n# Vault\n",
      "A/index.md": "---\n---\n# A\n",
      "B/index.md": "---\r\n\r\n---\r\n# B\r\n",
      "C/index.md": "---\n---\ntype: Note\n\n---\n",
      "D/index.md": "---\ntype: Note\n---\n",
    });
    const infos = await collectFolderIndexInfos({ queryService, adapter });
    const concept = Object.fromEntries(infos.map((i) => [i.folder, i.indexIsConcept]));
    expect(concept).toEqual({ "": false, A: false, B: false, C: false, D: true });
  });
});

describe("generateIndexForFolder", () => {
  it("writes a spec-shaped listing with titles, descriptions and subfolders", async () => {
    const { store, adapter, queryService } = makeVault(
      {
        "Projects/Alpha.md": "# A\n",
        "Projects/Beta.md": "# B\n",
        "Projects/Sub/Deep.md": "# D\n",
        "Projects/Docs/index.md": "# Docs\n",
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
    // Docs has its own index.md → link straight to it (opens in Plainva AND
    // Obsidian). Sub has none → plain text, so a click never fabricates a stray
    // note in Obsidian (Issue #9).
    expect(content).toContain("* [Docs](Docs/index.md)");
    expect(content).toContain("* Sub");
    expect(content).not.toContain("(Sub/)");
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
    expect(store.get("index.md")!.startsWith('---\nokf_version: "0.2"\n---\n')).toBe(true);
    const backupKey = [...store.keys()].find((k) => k.startsWith(".plainva/backups/index-md-") && k.endsWith("/index.md"));
    expect(backupKey).toBeDefined();
    expect(store.get(backupKey!)).toBe("old listing\n");
  });

  it("keeps the bundle version an existing root declares (OKF v0.2 plan, P2)", async () => {
    // Regenerating the listing is a structural refresh that the index.md
    // automation runs on every rename. Lifting the declared version from 0.1 to
    // 0.2 is the explicit migration's job — an auto-update must never do it on
    // the side (red against the previous implementation, which wrote the
    // current constant regardless).
    const { store, adapter, queryService } = makeVault({
      "index.md": '---\nokf_version: "0.1"\n---\n# Vault\n\n* [a](a.md)\n',
      "a.md": "# a\n",
    });

    await generateIndexForFolder({
      adapter,
      queryService,
      folder: "",
      heading: "Vault",
      subfoldersHeading: "Ordner",
    });

    expect(store.get("index.md")!.startsWith('---\nokf_version: "0.1"\n---\n')).toBe(true);
    // A root without any declaration ("old listing" above) still gets the current one.
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
      afterMove: async () => {},
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
      afterMove: async () => {},
    });

    expect(store.get("Projects/index.md")).toBe("---\ntype: MOC\n---\nInhalt mit [[Alpha]]\n");
  });

  it.each([
    ["the note itself", "Projects/MOC.md", "Projects/MOC.CONFLICT-1.md"],
    ["the place it would be moved to", "Projects/index.md", "Projects/index.CONFLICT-1.md"],
  ])("an open conflict on %s: nothing is prepared — the vault's chain would refuse the rename afterwards", async (_where, conflicted, workingCopy) => {
    const original = "---\ntype: MOC\n---\n# Projekte\n\n- [[Alpha]]\n";
    const { store, adapter, queryService } = makeVault({ "Projects/MOC.md": original, "Projects/Alpha.md": "# A\n" });
    // As the chain answers for a path whose conflict is open (finding 2026-10-12).
    const chain: IndexMdAdapter = {
      ...adapter,
      getConflictSession: async (path) => (path === conflicted ? ({ workingCopyPath: workingCopy } as never) : null),
      updateTextFile: async () => {
        throw new Error("the note was changed although it cannot be moved");
      },
    };
    const refused = await adoptFileAsIndex({ adapter: chain, queryService, candidatePath: "Projects/MOC.md", folder: "Projects", prepare: true, afterMove: async () => {} })
      .then(() => null, (error: unknown) => error);
    expect(refused).toMatchObject({ name: "ConflictError", conflictPath: workingCopy });
    // Neither prepared nor moved, and no backup of a note nothing was done to.
    expect(store.get("Projects/MOC.md")).toBe(original);
    expect([...store.keys()].sort()).toEqual(["Projects/Alpha.md", "Projects/MOC.md"]);
  });

  // Sammelplan § 3.135 Nr. 1: the adoption moved the note past what the shell's
  // own rename carries along — a bookmark on the overview kept the old path.
  it("hands the move to the shell's follow-up once the note is at its new path, and only then", async () => {
    const { store, adapter, queryService } = makeVault({ "Projects/MOC.md": "# Projekte\n" });
    const moves: Array<[string, string, boolean]> = [];
    await adoptFileAsIndex({
      adapter,
      queryService,
      candidatePath: "Projects/MOC.md",
      folder: "Projects",
      prepare: false,
      afterMove: async (from, to) => void moves.push([from, to, store.has(to) && !store.has(from)]),
    });
    expect(moves).toEqual([["Projects/MOC.md", "Projects/index.md", true]]);

    const refused = makeVault({ "Projects/MOC.md": "# Projekte\n", "Projects/index.md": "# da\n" });
    await expect(adoptFileAsIndex({ ...refused, candidatePath: "Projects/MOC.md", folder: "Projects", prepare: true, afterMove: async (from, to) => void moves.push([from, to, false]) })).rejects.toThrow();
    expect(moves).toHaveLength(1);
  });

  // Finding 2026-10-12: the note was prepared first and the rename refused
  // afterwards — it stayed under its old name without its properties.
  it("refuses before anything is written where the folder has an index.md", async () => {
    const { store, adapter, queryService } = makeVault({
      "Projects/MOC.md": "---\ntype: MOC\n---\n# Projekte\n\n- [[MOC]] und [[Alpha]]\n",
      "Projects/index.md": "# Projekte\n\nschon da\n",
      "Projects/Alpha.md": "# A\n",
    });
    const before = new Map(store);

    await expect(adoptFileAsIndex({ adapter, queryService, candidatePath: "Projects/MOC.md", folder: "Projects", prepare: true, afterMove: async () => {} })).rejects.toThrow(/already exists: Projects\/index\.md/);

    expect(new Map(store)).toEqual(before);
  });

  it("names the note itself from its own folder where it links to itself, and keeps what the link showed", async () => {
    const { store, adapter, queryService } = makeVault({
      "Projects/MOC.md": "- [[MOC]] und [[MOC#Teil|dort]]\n- [[Alpha]]\n",
      "Projects/Alpha.md": "# A\n",
    });

    const result = await adoptFileAsIndex({ adapter, queryService, candidatePath: "Projects/MOC.md", folder: "Projects", prepare: true, afterMove: async () => {} });

    expect(store.get("Projects/index.md")).toBe("- [MOC](./index.md) und [dort](./index.md#Teil)\n- [Alpha](Alpha.md)\n");
    expect(result.preparation).toEqual({ converted: 3, embeds: 0, unresolved: 0, inLabels: 0, sectionLinks: 0 });
    expect(result.linkUpdateFailed).toBe(false);
  });

  // Finding 2026-10-21: `[[C# Notes/index]]` names `C`, and a bare `[[index]]`
  // follows whichever overview the rule finds first — in the manager's run one
  // the index does not know yet. A link to the overview of such a folder, by
  // its name or by the title the preparation takes out, stays as it was, and
  // the adoption says so.
  it("leaves the links to an overview a wiki link cannot carry as they were, and says so", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const vaults: Array<Record<string, string>> = [{}, { "Other/index.md": "# Other\n" }];
      for (const others of vaults) {
        const { store, adapter, queryService } = makeVault({
          "C# Notes/Map.md": "---\ntitle: Karte der Notizen\n---\n# Karte\n",
          "Start.md": "[[Map]] und [[Karte der Notizen]]\n",
          ...others,
        });
        // The second reaches the note only by its title (the link rule's last step).
        queryService.getBacklinks = async () => [
          { source_path: "Start.md", target_path: "Map" },
          { source_path: "Start.md", target_path: "Karte der Notizen" },
        ];

        const result = await adoptFileAsIndex({ adapter, queryService, candidatePath: "C# Notes/Map.md", folder: "C# Notes", prepare: true, afterMove: async () => {} });

        const named = JSON.stringify(others);
        expect(store.get("C# Notes/index.md"), named).toBe("# Karte\n");
        expect(store.get("Start.md"), named).toBe("[[Map]] und [[Karte der Notizen]]\n");
        expect(result, named).toMatchObject({ renamedLinks: 0, linkUpdateFailed: true });
      }
    } finally {
      warned.mockRestore();
    }
  });

  it("hands on that the links to the note could not be read, instead of passing it over", async () => {
    // The rename says so on the console as well; that is its own, and not what is asked here.
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const prepare of [false, true]) {
        const { store, adapter, queryService } = makeVault({ "Projects/MOC.md": "# Projekte\n", "Projects/Alpha.md": "[[MOC]]\n" });
        queryService.getBacklinks = async () => {
          throw new Error("the index is busy");
        };

        const result = await adoptFileAsIndex({ adapter, queryService, candidatePath: "Projects/MOC.md", folder: "Projects", prepare, afterMove: async () => {} });

        // The note is adopted all the same; what links to it may still name the old file.
        expect(store.has("Projects/index.md"), String(prepare)).toBe(true);
        expect(result, String(prepare)).toMatchObject({ renamedLinks: 0, changedFiles: 0, linkUpdateFailed: true });
      }
    } finally {
      warned.mockRestore();
    }
  });
});

// Sammelplan § 3.135 Nr. 6: a link that names an overview only as `index`
// leads wherever the rule finds an `index.md` first, and an adoption that puts
// a new one there takes it over. The adoption offers to write such links with
// their folder, before anything moves.
describe("planOverviewLinkPins / pinOverviewLinks", () => {
  type Row = { source_path: string; target_path: string; link_type: string; property_key?: string | null };
  function withLinks(files: Record<string, string>, rows: Row[]) {
    const vault = makeVault(files);
    vault.queryService.linksNamingFile = async () => rows;
    return vault;
  }
  const corpus = (store: Map<string, string>) => [...store.keys()].filter((p) => !p.startsWith(".plainva/")).map((path) => ({ path, title: null }));

  it("writes the links the adoption would take over with their folder, so they keep leading where they led", async () => {
    const { store, adapter, queryService } = withLinks(
      {
        "Other/index.md": "# Other\n",
        "Projects/MOC.md": "# Projects\n",
        "Projects/Plan.md": "See [[index]], [[index#Part|there]] and [x](index.md).\n",
        "Projects/Task.md": "---\nup: \"[[index]]\"\n---\nText.\n",
        "Start.md": "Home: [[index]]\n",
      },
      [
        { source_path: "Projects/Plan.md", target_path: "index", link_type: "wikilink" },
        { source_path: "Projects/Plan.md", target_path: "index", link_type: "wikilink" },
        { source_path: "Projects/Plan.md", target_path: "index.md", link_type: "markdown-link" },
        { source_path: "Projects/Task.md", target_path: "index", link_type: "wikilink", property_key: "up" },
        { source_path: "Start.md", target_path: "index", link_type: "wikilink" },
      ],
    );
    const adoption = [{ candidatePath: "Projects/MOC.md", indexPath: "Projects/index.md" }];
    // The finding: after the adoption the bare links in Projects/ lead to the new overview.
    const after = [...corpus(store).filter((f) => f.path !== "Projects/MOC.md"), { path: "Projects/index.md", title: null }];
    expect(resolveLinkTarget("Projects/Plan.md", "index", corpus(store))).toBe("Other/index.md");
    expect(resolveLinkTarget("Projects/Plan.md", "index", after)).toBe("Projects/index.md");

    const pins = await planOverviewLinkPins(queryService, adoption);
    // The root note's link keeps its way (the shorter path still answers): it is left alone.
    expect(pins).toMatchObject({ links: 4, failed: false });
    const done = await pinOverviewLinks(adapter, pins);
    expect(done).toEqual({ pinned: 4, changedPaths: ["Projects/Plan.md", "Projects/Task.md"], failed: false });
    expect(store.get("Projects/Plan.md")).toBe("See [[Other/index]], [[Other/index#Part|there]] and [x](../Other/index.md).\n");
    expect(store.get("Projects/Task.md")).toBe("---\nup: \"[[Other/index]]\"\n---\nText.\n");
    expect(store.get("Start.md")).toBe("Home: [[index]]\n");
    // And they lead there after the adoption.
    expect(resolveLinkTarget("Projects/Plan.md", "Other/index", after)).toBe("Other/index.md");
    expect(resolveLinkTarget("Projects/Plan.md", "../Other/index.md", after)).toBe("Other/index.md");
  });

  it("an adoption at the vault's root takes every bare link: each keeps the overview it led to", async () => {
    const { store, adapter, queryService } = withLinks(
      { "Other/index.md": "# Other\n", "Home.md": "# Home\n", "Start.md": "[[index]] and [[Home]]\n" },
      [{ source_path: "Start.md", target_path: "index", link_type: "wikilink" }],
    );
    const pins = await planOverviewLinkPins(queryService, [{ candidatePath: "Home.md", indexPath: "index.md" }]);
    expect(pins.links).toBe(1);
    await pinOverviewLinks(adapter, pins);
    expect(store.get("Start.md")).toBe("[[Other/index]] and [[Home]]\n");
  });

  it("leaves a link that led nowhere and a link to the adopted note itself - the rename follows that one", async () => {
    const { queryService } = withLinks(
      { "Projects/MOC.md": "# Projects\n", "Projects/Plan.md": "[[index]] [[Projects/MOC]]\n" },
      [
        { source_path: "Projects/Plan.md", target_path: "index", link_type: "wikilink" },
        { source_path: "Projects/Plan.md", target_path: "Projects/MOC", link_type: "wikilink" },
      ],
    );
    const pins = await planOverviewLinkPins(queryService, [{ candidatePath: "Projects/MOC.md", indexPath: "Projects/index.md" }]);
    expect(pins).toMatchObject({ links: 0, failed: false });
    expect(pins.plan.sources).toEqual([]);
  });

  it("says that the links could not be read instead of offering nothing", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { queryService } = makeVault({ "Projects/MOC.md": "# P\n" });
      queryService.linksNamingFile = async () => {
        throw new Error("the index is busy");
      };
      expect(await planOverviewLinkPins(queryService, [{ candidatePath: "Projects/MOC.md", indexPath: "Projects/index.md" }])).toMatchObject({ links: 0, failed: true });
    } finally {
      warned.mockRestore();
    }
  });
});

describe("adoptionSummary", () => {
  // The texts are their keys with their values: which sentence is said, and with which numbers.
  const t = ((key: string, values?: Record<string, unknown>) => `${key}${values ? JSON.stringify(values) : ""}`) as never;
  const adopted = { indexPath: "Projects/index.md", renamedLinks: 0, changedFiles: 0, linkUpdateFailed: false };

  it("names the adopted note, and nothing else where nothing else happened", () => {
    expect(adoptionSummary(t, "MOC.md", adopted)).toBe('indexMd.resultAdopted{"file":"MOC.md"}');
    // A preparation that converted every link has left nothing to mention.
    expect(adoptionSummary(t, "MOC.md", { ...adopted, preparation: { converted: 4, embeds: 0, unresolved: 0, inLabels: 0, sectionLinks: 0 } })).toBe('indexMd.resultAdopted{"file":"MOC.md"}');
  });

  it("counts the links to a section of the note and the pinned links on their own", () => {
    const result = { ...adopted, preparation: { converted: 2, embeds: 0, unresolved: 0, inLabels: 0, sectionLinks: 3 } };
    expect(adoptionSummary(t, "MOC.md", result, 2)).toBe(
      'indexMd.resultAdopted{"file":"MOC.md"} (indexMd.resultPinned{"links":2}; indexMd.resultPrepSectionLinks{"links":3})'
    );
  });

  it("adds the links that followed and what a preparation left as it was — a wikilink in a link's label counted on its own", () => {
    const result = { ...adopted, renamedLinks: 3, changedFiles: 2, preparation: { converted: 4, embeds: 1, unresolved: 0, inLabels: 2, sectionLinks: 0 } };
    expect(adoptionSummary(t, "MOC.md", result)).toBe(
      'indexMd.resultAdopted{"file":"MOC.md"} (indexMd.resultLinks{"links":3,"files":2}; indexMd.resultPrepLeftovers{"embeds":1,"unresolved":0}; indexMd.resultPrepInLabels{"links":2})'
    );
    expect(adoptionSummary(t, "MOC.md", { ...adopted, preparation: { converted: 0, embeds: 0, unresolved: 0, inLabels: 1, sectionLinks: 0 } })).toBe(
      'indexMd.resultAdopted{"file":"MOC.md"} (indexMd.resultPrepInLabels{"links":1})'
    );
  });
});
