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

  it("continues an interrupted run into the SAME backup folder", async () => {
    const { vault, files } = fakeVault({ "a.md": NOTE, "b.md": NOTE });
    // The folder is asserted through the FILES, not the returned string: two
    // runs a millisecond apart would stamp the same name by coincidence, and a
    // test that passes because of a clock is not a test.
    const FIRST = ".plainva/backups/okf-conversion-first-pass";
    const first = await convertVaultToOkf({
      vault,
      scan: await scanVaultOkf(vault),
      options: { defaultType: "note" },
      backupDir: FIRST,
      isCancelled: (() => {
        let n = 0;
        return () => n++ >= 1;
      })(),
    });
    expect(first.cancelled).toBe(true);
    expect(first.backupDir).toBe(FIRST);

    const second = await convertVaultToOkf({
      vault,
      scan: await scanVaultOkf(vault),
      options: { defaultType: "note" },
      backupDir: first.backupDir,
    });

    // Two folders would mean two undos, and neither of them complete.
    expect(second.backupDir).toBe(FIRST);
    const backupFolders = new Set(
      [...files.keys()].filter((p) => p.startsWith(".plainva/backups/")).map((p) => p.split("/").slice(0, 3).join("/")),
    );
    expect([...backupFolders]).toEqual([FIRST]);
    // Everything converted, and the already-converted file was not touched
    // twice: convertFileToOkf is idempotent, which is what makes this safe.
    expect(files.get("a.md")).toContain("type: note");
    expect(files.get("b.md")).toContain("type: note");
    expect(await pendingOkfRun(vault)).toBeNull();
  });

  it("undoes a run from its backup folder, byte for byte", async () => {
    const { vault, files } = fakeVault({ "a.md": NOTE, "deep/b.md": NOTE });
    const report = await convertVaultToOkf({
      vault,
      scan: await scanVaultOkf(vault),
      options: { defaultType: "note" },
    });
    expect(files.get("a.md")).not.toBe(NOTE);

    const undo = await undoOkfConversion(vault, report.backupDir);

    expect(undo.failed).toEqual([]);
    expect(undo.restored.sort()).toEqual(["a.md", "deep/b.md"]);
    expect(files.get("a.md")).toBe(NOTE);
    expect(files.get("deep/b.md")).toBe(NOTE);
    // The backups stay: they are the only copy of the pre-conversion state,
    // and an undo of the undo has to be possible.
    expect(files.has(`${report.backupDir}/a.md`)).toBe(true);
  });
});
