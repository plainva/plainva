import { describe, it, expect, vi, afterEach } from "vitest";
import { PLAINVA_INDEX_MARKER } from "@plainva/core";
import {
  affectedFolders,
  createIndexAutoUpdater,
  updateAllManagedIndexes,
  type FileOp,
} from "./indexMdAutoUpdate";

const ROOT_OKF_INDEX = `---\nokf_version: "0.1"\n---\n\n# Vault\n\n${PLAINVA_INDEX_MARKER}\n`;
const managedIndex = (heading: string) => `# ${heading}\n\n${PLAINVA_INDEX_MARKER}\n`;

function makeVault(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const writes: string[] = [];
  const adapter = {
    readTextFile: async (p: string) => {
      if (!store.has(p)) throw new Error(`missing ${p}`);
      return store.get(p)!;
    },
    writeTextFile: async (p: string, c: string) => {
      store.set(p, c);
      writes.push(p);
    },
    exists: async (p: string) => store.has(p),
    createDir: async () => {},
    renameItem: async () => {
      throw new Error("unused");
    },
  };
  const queryService = {
    db: {
      query: async (sql: string) => {
        const mdPaths = [...store.keys()].filter((p) => p.endsWith(".md"));
        if (sql.includes("'description'")) return [];
        if (sql.includes("title")) {
          return mdPaths.map((p) => ({ path: p, title: p.split("/").pop()!.replace(/\.md$/, "") }));
        }
        return mdPaths.map((p) => ({ path: p }));
      },
    },
  };
  return { store, writes, adapter, queryService };
}

const deps = (v: ReturnType<typeof makeVault>, extra?: Partial<Parameters<typeof createIndexAutoUpdater>[0]>) => ({
  adapter: v.adapter as any,
  queryService: v.queryService as any,
  vaultName: () => "Vault",
  subfoldersHeading: () => "Unterordner",
  ...extra,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("affectedFolders", () => {
  it("maps create/delete to the parent and move to both parents", () => {
    const ops: FileOp[] = [
      { type: "create", path: "P/Neu.md" },
      { type: "delete", path: "Alt.md" },
      { type: "move", from: "A/x.md", to: "B/x.md" },
    ];
    expect(affectedFolders(ops)).toEqual(new Set(["P", "", "A", "B"]));
  });

  it("skips attachments, reserved names and internal paths; folders count for the parent and (moved) themselves", () => {
    expect(affectedFolders([{ type: "create", path: "P/foto.png" }])).toEqual(new Set());
    expect(affectedFolders([{ type: "create", path: "P/index.md" }])).toEqual(new Set());
    expect(affectedFolders([{ type: "delete", path: ".plainva/backups/x.md" }])).toEqual(new Set());
    expect(affectedFolders([{ type: "create", path: "P/Sub", isFolder: true }])).toEqual(new Set(["P"]));
    expect(affectedFolders([{ type: "move", from: "P/Sub", to: "Q/Sub", isFolder: true }])).toEqual(
      new Set(["P", "Q", "Q/Sub"])
    );
  });
});

describe("createIndexAutoUpdater", () => {
  it("rewrites only existing, marked listings of affected folders", async () => {
    const v = makeVault({
      "index.md": ROOT_OKF_INDEX,
      "P/index.md": managedIndex("P"),
      "P/Alt.md": "# Alt\n",
      "P/Neu.md": "# Neu\n",
      "Q/Ding.md": "# Ding\n",
    });
    const written: string[] = [];
    const updater = createIndexAutoUpdater(deps(v, { onWritten: (p) => written.push(p) }));
    updater.notify([
      { type: "create", path: "P/Neu.md" },
      { type: "create", path: "Q/Neu2.md" },
    ]);
    const result = await updater.flush();
    expect(result.updated).toEqual(["P/index.md"]);
    expect(written).toEqual(["P/index.md"]);
    expect(v.store.get("P/index.md")).toContain("[Neu](Neu.md)");
    expect(v.store.get("P/index.md")).toContain(PLAINVA_INDEX_MARKER);
    expect(v.store.has("Q/index.md")).toBe(false); // never created unasked
    updater.dispose();
  });

  it("does nothing without the root okf_version gate or without the marker", async () => {
    const noOkf = makeVault({
      "index.md": `# Vault\n\n${PLAINVA_INDEX_MARKER}\n`, // no okf_version frontmatter
      "P/index.md": managedIndex("P"),
      "P/Neu.md": "# Neu\n",
    });
    const u1 = createIndexAutoUpdater(deps(noOkf));
    u1.notify([{ type: "create", path: "P/Neu.md" }]);
    expect((await u1.flush()).updated).toEqual([]);
    u1.dispose();

    const unmarked = makeVault({
      "index.md": ROOT_OKF_INDEX,
      "P/index.md": "# Eigene Übersicht\n", // adopted/manual — hands off
      "P/Neu.md": "# Neu\n",
    });
    const u2 = createIndexAutoUpdater(deps(unmarked));
    u2.notify([{ type: "create", path: "P/Neu.md" }]);
    expect((await u2.flush()).updated).toEqual([]);
    expect(unmarked.store.get("P/index.md")).toBe("# Eigene Übersicht\n");
    u2.dispose();
  });

  it("debounces batches into one refresh per folder", async () => {
    vi.useFakeTimers();
    const v = makeVault({
      "index.md": ROOT_OKF_INDEX,
      "P/index.md": managedIndex("P"),
      "P/a.md": "# a\n",
      "P/b.md": "# b\n",
    });
    const updater = createIndexAutoUpdater(deps(v, { debounceMs: 500 }));
    updater.notify([{ type: "create", path: "P/a.md" }]);
    updater.notify([{ type: "create", path: "P/b.md" }]);
    expect(v.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(v.writes).toEqual(["P/index.md"]);
    updater.dispose();
  });
});

describe("updateAllManagedIndexes", () => {
  it("rewrites marked listings everywhere and counts the unmarked ones", async () => {
    const v = makeVault({
      "index.md": ROOT_OKF_INDEX,
      "P/index.md": managedIndex("P"),
      "P/a.md": "# a\n",
      "Q/index.md": "# Manuell\n",
      "Q/b.md": "# b\n",
    });
    const result = await updateAllManagedIndexes(deps(v));
    expect(result.updated.sort()).toEqual(["P/index.md", "index.md"].sort());
    expect(result.skippedNoMarker).toBe(1);
    expect(v.store.get("Q/index.md")).toBe("# Manuell\n");
    expect(v.store.get("P/index.md")).toContain("[a](a.md)");
  });
});

describe("the root overview's heading (F7 of release 0.9.0)", () => {
  // Every name a shell has for the vault holds on one device only — the
  // desktop's own name or folder, the phone's list entry, a translated label.
  // The root listing is synced: a refresh keeps the heading that is there.
  const root = (heading: string) => `---\nokf_version: "0.2"\n---\n\n# ${heading}\n\n* [A](A.md)\n\n${PLAINVA_INDEX_MARKER}\n`;
  const headingOf = (text: string | undefined) => text?.split("\n").find((line) => line.startsWith("# "));

  it("a refresh on any device keeps it, however that device names the vault", async () => {
    const v = makeVault({ "index.md": root("Plainva"), "A.md": "# A\n" });
    for (const [i, name] of ["Auf diesem Gerät", "wiki_dev", "Google Drive · wiki_dev", "Mein Wiki"].entries()) {
      v.store.set(`N${i}.md`, "# n\n");
      const updater = createIndexAutoUpdater(deps(v, { vaultName: () => name, debounceMs: 1 }));
      updater.notify([{ type: "create", path: `N${i}.md` }]);
      expect((await updater.flush()).updated).toEqual(["index.md"]);
      updater.dispose();
      expect(headingOf(v.store.get("index.md"))).toBe("# Plainva");
      expect(v.store.get("index.md")).toContain(`[N${i}](N${i}.md)`);
    }
  });

  it("so does updating every overview, and a root without a vault heading keeps having none", async () => {
    const v = makeVault({ "index.md": root("Mein Wiki"), "P/index.md": `${PLAINVA_INDEX_MARKER}\n`, "P/a.md": "# a\n" });
    await updateAllManagedIndexes(deps(v, { vaultName: () => "wiki_dev" }));
    expect(headingOf(v.store.get("index.md"))).toBe("# Mein Wiki");
    // A subfolder's heading is its folder's name, the same on every device.
    expect(headingOf(v.store.get("P/index.md"))).toBe("# P");
    const bare = makeVault({ "index.md": `---\nokf_version: "0.2"\n---\n\n${PLAINVA_INDEX_MARKER}\n`, "A.md": "# A\n" });
    await updateAllManagedIndexes(deps(bare, { vaultName: () => "wiki_dev" }));
    // The name comes only from creating the listing.
    expect(headingOf(bare.store.get("index.md"))).toBeUndefined();
    expect(bare.store.get("index.md")).toContain("* [A](A.md)");
  });

  it("a heading of the list itself is never the vault's name (review 17.11.)", async () => {
    // No vault heading, subfolders only: the listing opens with its subfolder section.
    const text = `---\nokf_version: "0.2"\n---\n\n# Unterordner\n\n* [P](P/index.md)\n* Q\n\n${PLAINVA_INDEX_MARKER}\n`;
    const v = makeVault({ "index.md": text, "P/index.md": `${PLAINVA_INDEX_MARKER}\n`, "P/a.md": "# a\n", "Q/b.md": "# b\n" });
    for (let i = 0; i < 2; i++) await updateAllManagedIndexes(deps(v, { vaultName: () => "wiki_dev" }));
    const after = v.store.get("index.md")!;
    expect(after.split("\n").filter((line) => line.startsWith("# "))).toEqual(["# Unterordner"]);
    expect(after).toContain("* [P](P/index.md)");
    // With a vault heading and subfolders only, the first heading is the vault's.
    const named = makeVault({ "index.md": `---\nokf_version: "0.2"\n---\n\n# Mein Wiki\n\n# Unterordner\n\n* Q\n\n${PLAINVA_INDEX_MARKER}\n`, "Q/b.md": "# b\n" });
    await updateAllManagedIndexes(deps(named, { vaultName: () => "wiki_dev" }));
    expect(named.store.get("index.md")!.split("\n").filter((line) => line.startsWith("# "))).toEqual(["# Mein Wiki", "# Unterordner"]);
  });

  it("keeps a heading behind properties written with CRLF", async () => {
    const v = makeVault({ "index.md": root("Plainva").split("\n").join("\r\n"), "A.md": "# A\n" });
    await updateAllManagedIndexes(deps(v, { vaultName: () => "wiki_dev" }));
    expect(v.store.get("index.md")).toContain("# Plainva\r\n");
  });
});
