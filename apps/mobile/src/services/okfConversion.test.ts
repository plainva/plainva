// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, string>();
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
      stored.set(path, data);
    }),
    readFile: vi.fn(async ({ path }: { path: string }) => {
      if (!stored.has(path)) throw new Error("not found");
      return { data: stored.get(path)! };
    }),
    deleteFile: vi.fn(async ({ path }: { path: string }) => {
      stored.delete(path);
    }),
  },
}));
// Routes atomicWriteText through the mocked Filesystem instead of the plugin.
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));
vi.mock("./mobileSettings", () => ({
  getVaultSettings: vi.fn(async () => ({ templateFolder: "Templates" })),
}));

import { convertVaultToOkf, pendingOkfRun, scanVaultOkf, undoOkfConversion } from "./okfConversion";
import { okfJournalPath } from "./okfJournal";
import { OkfRunOpenError } from "@plainva/ui";
import type { MobileVault } from "./vaultService";

const VAULT = "fixture-vault";

/**
 * A vault whose files live in a map, with just enough of the adapter for the
 * run: read, write, mkdir, exists and a recursive listing for the rollback.
 */
function fakeVault(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const adapter = {
    async readTextFile(path: string) {
      if (!files.has(path)) throw new Error(`missing ${path}`);
      return files.get(path)!;
    },
    async writeTextFile(path: string, content: string) {
      files.set(path, content);
    },
    async createDir() {},
    async exists(path: string) {
      return files.has(path) || [...files.keys()].some((k) => k.startsWith(`${path}/`));
    },
    // Mirrors CapacitorVaultAdapter: non-recursive by DEFAULT, and directory
    // entries are part of the listing. A fake that always walks the whole tree
    // would let a rollback that forgot the flag pass while silently skipping
    // every note in a subfolder.
    async listDir(path = "", recursive = false) {
      const prefix = path ? `${path}/` : "";
      const out: { path: string; isDirectory: boolean }[] = [];
      const dirs = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const cut = rest.indexOf("/");
        if (cut === -1) out.push({ path: key, isDirectory: false });
        else {
          dirs.add(prefix + rest.slice(0, cut));
          if (recursive) out.push({ path: key, isDirectory: false });
        }
      }
      // The real walk lists folders in BOTH modes; only its recursion depends
      // on the flag. Callers therefore have to filter directories out.
      for (const d of dirs) out.push({ path: d, isDirectory: true });
      return out;
    },
  };
  const vault = {
    vaultId: VAULT,
    files: adapter,
    queryService: {
      db: {
        // Only notes; the scan filters attachments itself, and the fake has none.
        query: async () =>
          [...files.keys()].filter((p) => p.endsWith(".md") && !p.startsWith(".plainva")).map((path) => ({ path })),
      },
    },
  } as unknown as MobileVault;
  return { vault, files, adapter };
}

const NOTE = "# Just a note\n\nNo frontmatter here.\n";

beforeEach(() => {
  stored.clear();
  vi.clearAllMocks();
});

describe("converting a vault to OKF from the phone", () => {
  it("writes the journal BEFORE the first file, and clears it at the end", async () => {
    const { vault, files } = fakeVault({ "a.md": NOTE, "b.md": NOTE });
    const scan = await scanVaultOkf(vault);
    expect(scan.convertiblePaths).toEqual(["a.md", "b.md"]);

    // The order is the property: at the moment the first file is written, the
    // journal is already on disk. A run whose marker lands afterwards is
    // exactly the run a kill makes unrecoverable.
    let journalAtFirstWrite: string | undefined;
    const write = vault.files.writeTextFile.bind(vault.files);
    vault.files.writeTextFile = async (path: string, content: string) => {
      journalAtFirstWrite ??= stored.get(okfJournalPath(VAULT));
      return write(path, content);
    };

    const report = await convertVaultToOkf({ vault, scan, options: { defaultType: "note" } });

    expect(journalAtFirstWrite, "no journal existed when the first file was written").toBeTruthy();
    expect(report.changed).toEqual(["a.md", "b.md"]);
    expect(files.get("a.md")).toContain("type: note");
    // Finished runs are not pending runs.
    expect(stored.has(okfJournalPath(VAULT))).toBe(false);
    expect(await pendingOkfRun(vault)).toBeNull();
  });

  it("does not convert a single file when the journal cannot be written", async () => {
    const { vault, files } = fakeVault({ "a.md": NOTE });
    const scan = await scanVaultOkf(vault);
    const { Filesystem } = await import("@capacitor/filesystem");
    vi.mocked(Filesystem.writeFile).mockRejectedValueOnce(new Error("disk full"));

    await expect(convertVaultToOkf({ vault, scan, options: { defaultType: "note" } })).rejects.toThrow("disk full");

    // Fail-closed: a conversion nobody could recover from is worse than one
    // that never started.
    expect(files.get("a.md")).toBe(NOTE);
  });

  it("keeps the journal when a run is stopped, so the next start can offer it", async () => {
    const { vault } = fakeVault({ "a.md": NOTE, "b.md": NOTE, "c.md": NOTE });
    const scan = await scanVaultOkf(vault);
    let done = 0;
    const report = await convertVaultToOkf({
      vault,
      scan,
      options: { defaultType: "note" },
      onProgress: () => done++,
      isCancelled: () => done >= 1,
    });

    expect(report.cancelled).toBe(true);
    const open = await pendingOkfRun(vault);
    expect(open?.journal.backupDir).toBe(report.backupDir);
    // What is left is counted, not guessed at.
    expect(open?.remaining).toBeGreaterThan(0);
  });

  it("continues an interrupted run into the SAME backup folder, with the options it began with", async () => {
    const PERSON = "---\ntype: Person\n---\n# C\n";
    const { vault, files } = fakeVault({ "a.md": NOTE, "b.md": NOTE, "c.md": PERSON });
    const options = { defaultType: "Memo", existingTypeStrategy: "rename" as const };
    const first = await convertVaultToOkf({
      vault,
      scan: await scanVaultOkf(vault),
      options,
      isCancelled: (() => {
        let n = 0;
        return () => n++ >= 2;
      })(),
    });
    expect(first.cancelled).toBe(true);
    expect(first.changed).toEqual(["a.md", "b.md"]);
    const afterFirst = files.get("a.md");

    // Continued with nothing but the wish to continue: the folder and the
    // options come from the journal, never from what a screen happens to hold
    // (finding § 3.129 Nr. 1 a — the phone continued with its vault type and "keep").
    const second = await convertVaultToOkf({ vault, scan: await scanVaultOkf(vault), resume: true });

    // Two folders would mean two undos, and neither of them complete.
    expect(second.backupDir).toBe(first.backupDir);
    const backupFolders = new Set(
      [...files.keys()].filter((p) => p.startsWith(".plainva/backups/")).map((p) => p.split("/").slice(0, 3).join("/")),
    );
    expect([...backupFolders]).toEqual([first.backupDir]);
    // The rest is converted with the run's options; what the first pass did is
    // not done twice — "rename" is not idempotent (finding § 3.129 Nr. 1).
    expect(second.changed).toEqual(["c.md"]);
    expect(second.skipped).toEqual([]);
    expect(files.get("a.md")).toBe(afterFirst);
    expect(files.get("a.md")).not.toContain("type_original");
    expect(files.get("c.md")).toContain("type_original: Person");
    expect(files.get("c.md")).toContain("type: Memo");
    // The first pass's backups still hold the originals.
    expect(files.get(`${first.backupDir}/a.md`)).toBe(NOTE);
    expect(await pendingOkfRun(vault)).toBeNull();

    const undo = await undoOkfConversion(vault, second.backupDir, second.recipe);
    expect(undo.restored.sort()).toEqual(["a.md", "b.md", "c.md"]);
    expect(files.get("a.md")).toBe(NOTE);
    expect(files.get("c.md")).toBe(PERSON);
  });

  it("does not start a second run while one is open", async () => {
    // A continue that failed fell back to the preview, whose start opened a
    // second backup folder no undo of the first covers (§ 3.129 Nr. 1 b).
    const { vault, files } = fakeVault({ "a.md": NOTE, "b.md": NOTE });
    const first = await convertVaultToOkf({
      vault,
      scan: await scanVaultOkf(vault),
      options: { defaultType: "note" },
      isCancelled: (() => {
        let n = 0;
        return () => n++ >= 1;
      })(),
    });
    const before = new Map(files);

    await expect(convertVaultToOkf({ vault, scan: await scanVaultOkf(vault), options: { defaultType: "note" } })).rejects.toThrow(
      OkfRunOpenError,
    );

    expect(files).toEqual(before);
    expect((await pendingOkfRun(vault))?.journal.backupDir).toBe(first.backupDir);
  });

  it("an undo leaves a note edited after the run, and names it", async () => {
    // § 3.87 Nr. 15: the undo wrote every backup back, whatever lay there now.
    const { vault, files } = fakeVault({ "a.md": NOTE, "b.md": NOTE });
    const report = await convertVaultToOkf({ vault, scan: await scanVaultOkf(vault), options: { defaultType: "note" } });
    const edited = `${files.get("b.md")}A line written after the run.\n`;
    files.set("b.md", edited);

    const undo = await undoOkfConversion(vault, report.backupDir, report.recipe);

    expect(undo.restored).toEqual(["a.md"]);
    expect(undo.changedSince).toEqual(["b.md"]);
    expect(undo.failed).toEqual([]);
    expect(files.get("a.md")).toBe(NOTE);
    expect(files.get("b.md")).toBe(edited);
    expect(files.get(`${report.backupDir}/b.md`)).toBe(NOTE);
  });

  it("undoes a run from its backup folder, byte for byte", async () => {
    const { vault, files } = fakeVault({ "a.md": NOTE, "deep/b.md": NOTE });
    const report = await convertVaultToOkf({
      vault,
      scan: await scanVaultOkf(vault),
      options: { defaultType: "note" },
    });
    expect(files.get("a.md")).not.toBe(NOTE);

    const undo = await undoOkfConversion(vault, report.backupDir, report.recipe);

    expect(undo.failed).toEqual([]);
    expect(undo.restored.sort()).toEqual(["a.md", "deep/b.md"]);
    expect(files.get("a.md")).toBe(NOTE);
    expect(files.get("deep/b.md")).toBe(NOTE);
    // The backups stay: they are the only copy of the pre-conversion state,
    // and an undo of the undo has to be possible.
    expect(files.has(`${report.backupDir}/a.md`)).toBe(true);
  });
});
