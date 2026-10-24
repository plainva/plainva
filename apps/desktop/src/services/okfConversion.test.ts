import { describe, it, expect, vi, beforeEach } from "vitest";

const storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async (key: string) => storeValues[key] }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn() }));

import { scanVaultOkf, runOkfConversion, rollbackOkfConversion, type OkfConversionAdapter } from "./okfConversion";

function makeAdapter(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const dirs = new Set<string>();
  const adapter: OkfConversionAdapter = {
    readTextFile: async (p) => {
      const c = store.get(p);
      if (c === undefined) throw new Error(`missing ${p}`);
      return c;
    },
    writeTextFile: async (p, c) => {
      store.set(p, c);
    },
    createDir: async (p) => {
      dirs.add(p);
    },
    exists: async (p) => store.has(p) || dirs.has(p),
  };
  return { store, dirs, adapter };
}

beforeEach(() => {
  for (const k of Object.keys(storeValues)) delete storeValues[k];
});

describe("scanVaultOkf", () => {
  it("scans indexed markdown files, excluding the configured template folder", async () => {
    const { adapter } = makeAdapter({
      "a.md": "# x\n",
      "Templates/t.md": "# t\n",
    });
    const queryService = {
      db: { query: async () => [{ path: "a.md" }, { path: "Templates/t.md" }] },
    } as any;
    const result = await scanVaultOkf({ vaultPath: "/v", queryService, adapter });
    expect(result.scanned).toBe(1);
    expect(result.violations).toEqual([{ path: "a.md", kind: "missing-frontmatter" }]);
  });
});

describe("runOkfConversion", () => {
  const scanFor = (paths: string[]) =>
    ({ scanned: paths.length, violations: [], convertiblePaths: paths, typedPaths: [] }) as any;

  it("converts files, writes backups first and reports counts", async () => {
    const { store, adapter } = makeAdapter({
      "a.md": "# no frontmatter\n",
      "b.md": '---\ntype: Note\nokf_version: "0.1"\n---\nBody\n',
    });

    const report = await runOkfConversion({
      adapter,
      scan: scanFor(["a.md", "b.md"]),
      options: { defaultType: "Note" },
    });

    expect(report.changed).toEqual(["a.md"]);
    expect(report.unchanged).toBe(1);
    expect(report.skipped).toEqual([]);
    expect(store.get("a.md")).toContain("type: Note");
    // Backup carries the pre-conversion content.
    const backupPath = `${report.backupDir}/a.md`;
    expect(store.get(backupPath)).toBe("# no frontmatter\n");
    expect(report.samples[0]?.path).toBe("a.md");
  });

  it("ensures each shared backup directory only once per run (WP4)", async () => {
    const base = makeAdapter({ "Notes/a.md": "# a\n", "Notes/b.md": "# b\n" });
    const existsCalls: string[] = [];
    const adapter: OkfConversionAdapter = {
      ...base.adapter,
      exists: async (p) => { existsCalls.push(p); return base.adapter.exists(p); },
    };
    const report = await runOkfConversion({
      adapter,
      scan: scanFor(["Notes/a.md", "Notes/b.md"]),
      options: { defaultType: "Note" },
      concurrency: 1, // deterministic order + cache hit (the pool otherwise races the shared dir)
    });
    expect(report.changed).toEqual(["Notes/a.md", "Notes/b.md"]);
    // The shared backup dir segment is checked once (a.md), then cached (b.md).
    expect(existsCalls.filter((p) => p === report.backupDir).length).toBe(1);
    expect(existsCalls.filter((p) => p === `${report.backupDir}/Notes`).length).toBe(1);
  });

  it("dry run changes nothing on disk but reports what would change", async () => {
    const { store, adapter } = makeAdapter({ "a.md": "# x\n" });
    const report = await runOkfConversion({
      adapter,
      scan: scanFor(["a.md"]),
      options: { defaultType: "Note" },
      dryRun: true,
    });
    expect(report.changed).toEqual(["a.md"]);
    expect(store.get("a.md")).toBe("# x\n");
    expect(report.backupDir).toBe("");
  });

  it("skips files that cannot be edited safely and keeps going", async () => {
    const { store, adapter } = makeAdapter({
      "broken.md": "---\n[broken\n---\n",
      "ok.md": "# x\n",
    });
    const report = await runOkfConversion({
      adapter,
      scan: scanFor(["broken.md", "ok.md"]),
      options: { defaultType: "Note" },
    });
    expect(report.skipped.length).toBe(1);
    expect(report.skipped[0].path).toBe("broken.md");
    expect(store.get("broken.md")).toBe("---\n[broken\n---\n");
    expect(report.changed).toEqual(["ok.md"]);
  });

  it("stops at the cancellation flag", async () => {
    const { adapter } = makeAdapter({ "a.md": "# x\n", "b.md": "# y\n" });
    let calls = 0;
    const report = await runOkfConversion({
      adapter,
      scan: scanFor(["a.md", "b.md"]),
      options: { defaultType: "Note" },
      isCancelled: () => calls++ >= 1,
      concurrency: 1, // deterministic: process one, then cancel
    });
    expect(report.cancelled).toBe(true);
    expect(report.changed.length).toBe(1);
  });

  it("processes files with bounded concurrency and converts them all", async () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    for (let i = 0; i < 20; i++) {
      files[`n${i}.md`] = "# no frontmatter\n";
      names.push(`n${i}.md`);
    }
    const base = makeAdapter(files);
    let active = 0;
    let maxActive = 0;
    const adapter: OkfConversionAdapter = {
      ...base.adapter,
      readTextFile: async (p) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 3));
        active--;
        return base.adapter.readTextFile(p);
      },
    };
    const report = await runOkfConversion({
      adapter,
      scan: scanFor(names),
      options: { defaultType: "Note" },
      concurrency: 4,
    });
    expect(report.changed.length).toBe(20);
    expect(base.store.get("n0.md")).toContain("type: Note");
    expect(maxActive).toBeGreaterThan(1); // genuinely ran in parallel
    expect(maxActive).toBeLessThanOrEqual(4); // but bounded by the pool size
  });

  // The backup folder is what an undo puts back, file by file. A file is
  // replaced only if it still is the text its backup holds (finding
  // 2026-10-12) — so a backup the run wrote must not be left behind for a file
  // it did not convert in the end.
  describe("what an undo finds in the backup folder", () => {
    const NEEDS_NOTHING = '---\ntype: Note\nokf_version: "0.1"\n---\nBody\n';
    const isBackup = (p: string) => p.startsWith(".plainva/backups/");
    /**
     * The fake's files with what the vault's chain adds for a run: a listing
     * (what the undo walks) and a delete. `writeTextFile` is the test's own.
     */
    const vaultLike = (base: ReturnType<typeof makeAdapter>, writeTextFile: OkfConversionAdapter["writeTextFile"]): OkfConversionAdapter => ({
      ...base.adapter,
      writeTextFile,
      listDir: async (dir) => [...base.store.keys()].filter((p) => p.startsWith(`${dir}/`)).map((path) => ({ path, isDirectory: false })),
      deleteItem: async (p) => void base.store.delete(p),
    });
    const backups = (base: ReturnType<typeof makeAdapter>) => [...base.store.keys()].filter(isBackup);

    it("a file that changed while its backup was written and then needs nothing has no backup", async () => {
      const base = makeAdapter({ "a.md": "# no frontmatter\n" });
      // While the backup is written, the note arrives from another device — in a version that needs no conversion.
      let arrived = false;
      const adapter = vaultLike(base, async (p, c) => {
        await base.adapter.writeTextFile(p, c);
        if (isBackup(p) && !arrived) {
          arrived = true;
          base.store.set("a.md", NEEDS_NOTHING);
        }
      });
      const report = await runOkfConversion({ adapter, scan: scanFor(["a.md"]), options: { defaultType: "Note" } });
      expect(report.changed).toEqual([]);
      expect(report.unchanged).toBe(1);
      expect(backups(base)).toEqual([]);
      // Edited after the run: an undo has nothing of this note to put back over the edit.
      base.store.set("a.md", `${NEEDS_NOTHING}A line written after the run.\n`);
      await rollbackOkfConversion(adapter, report.backupDir);
      expect(base.store.get("a.md")).toBe(`${NEEDS_NOTHING}A line written after the run.\n`);
    });

    it("a file that never holds still is skipped and has no backup", async () => {
      const base = makeAdapter({ "a.md": "# version 0\n" });
      let n = 0;
      const adapter = vaultLike(base, async (p, c) => {
        await base.adapter.writeTextFile(p, c);
        if (isBackup(p) && n < 4) base.store.set("a.md", `# version ${++n}\n`);
      });
      const report = await runOkfConversion({ adapter, scan: scanFor(["a.md"]), options: { defaultType: "Note" } });
      expect(report.changed).toEqual([]);
      expect(report.skipped.map((s) => s.path)).toEqual(["a.md"]);
      expect(backups(base)).toEqual([]);
      await rollbackOkfConversion(adapter, report.backupDir);
      expect(base.store.get("a.md")).toBe("# version 4\n");
    });

    it("a file that was moved away while its backup was written is not brought back", async () => {
      const base = makeAdapter({ "a.md": "# no frontmatter\n" });
      const adapter = vaultLike(base, async (p, c) => {
        await base.adapter.writeTextFile(p, c);
        if (isBackup(p) && base.store.has("a.md")) {
          base.store.set("Archive/a.md", base.store.get("a.md")!);
          base.store.delete("a.md");
        }
      });
      const report = await runOkfConversion({ adapter, scan: scanFor(["a.md"]), options: { defaultType: "Note" } });
      expect(report.skipped.map((s) => s.path)).toEqual(["a.md"]);
      expect(backups(base)).toEqual([]);
      await rollbackOkfConversion(adapter, report.backupDir);
      expect(base.store.has("a.md")).toBe(false);
      expect(base.store.get("Archive/a.md")).toBe("# no frontmatter\n");
    });

    it("a write that failed after it had reached the file keeps the backup of the original", async () => {
      const base = makeAdapter({ "a.md": "# no frontmatter\n" });
      let failed = false;
      const adapter = vaultLike(base, async (p, c) => {
        await base.adapter.writeTextFile(p, c);
        if (p === "a.md" && !failed) {
          failed = true;
          throw new Error("the queue refused the entry");
        }
      });
      const report = await runOkfConversion({ adapter, scan: scanFor(["a.md"]), options: { defaultType: "Note" } });
      expect(report.skipped).toEqual([{ path: "a.md", error: "the queue refused the entry" }]);
      expect(base.store.get("a.md")).toContain("type: Note");
      await rollbackOkfConversion(adapter, report.backupDir);
      expect(base.store.get("a.md")).toBe("# no frontmatter\n");
    });

    it("files that cannot remove a backup get it brought to what the file reads", async () => {
      const base = makeAdapter({ "a.md": "# no frontmatter\n" });
      let arrived = false;
      const files: OkfConversionAdapter = {
        ...vaultLike(base, async (p, c) => {
          await base.adapter.writeTextFile(p, c);
          if (isBackup(p) && !arrived) {
            arrived = true;
            base.store.set("a.md", NEEDS_NOTHING);
          }
        }),
        deleteItem: undefined,
      };
      const report = await runOkfConversion({ adapter: files, scan: scanFor(["a.md"]), options: { defaultType: "Note" } });
      expect(report.unchanged).toBe(1);
      expect(base.store.get(`${report.backupDir}/a.md`)).toBe(NEEDS_NOTHING);
      await rollbackOkfConversion(files, report.backupDir);
      expect(base.store.get("a.md")).toBe(NEEDS_NOTHING);
    });

    it("a backup that cannot be removed right now is brought to what the file reads, and nothing is reported", async () => {
      const base = makeAdapter({ "a.md": "# no frontmatter\n" });
      let arrived = false;
      const files: OkfConversionAdapter = {
        ...vaultLike(base, async (p, c) => {
          await base.adapter.writeTextFile(p, c);
          if (isBackup(p) && !arrived) {
            arrived = true;
            base.store.set("a.md", NEEDS_NOTHING);
          }
        }),
        // A file written a moment ago, still held by a scanner or a sync client.
        deleteItem: async () => {
          throw new Error("The process cannot access the file because it is being used by another process");
        },
      };
      const report = await runOkfConversion({ adapter: files, scan: scanFor(["a.md"]), options: { defaultType: "Note" } });
      expect(report.unchanged).toBe(1);
      expect(report.skipped).toEqual([]);
      expect(base.store.get(`${report.backupDir}/a.md`)).toBe(NEEDS_NOTHING);
      await rollbackOkfConversion(files, report.backupDir);
      expect(base.store.get("a.md")).toBe(NEEDS_NOTHING);
    });

    it("a note with an open conflict is not converted, neither of its two texts — and the run goes on", async () => {
      const base = makeAdapter({ "a.md": "# theirs\n", "a.CONFLICT-1.md": "# mine\n", "b.md": "# b\n" });
      const adapter: OkfConversionAdapter = {
        ...vaultLike(base, base.adapter.writeTextFile),
        // As the vault's chain answers: the conflict by either of its two paths, and its entry for a change.
        getConflictSession: async (p) => (p === "a.md" || p === "a.CONFLICT-1.md" ? ({ workingCopyPath: "a.CONFLICT-1.md" } as never) : null),
        updateTextFile: async (p, change) => {
          const before = base.store.get(p)!;
          const next = change(before);
          if (next !== null) base.store.set(p, next);
          return { before, text: next ?? before, changed: next !== null && next !== before, conflict: null };
        },
      };
      const scan = scanFor(["a.md", "a.CONFLICT-1.md", "b.md"]);
      const preview = await runOkfConversion({ adapter, scan, options: { defaultType: "Note" }, dryRun: true, concurrency: 1 });
      const report = await runOkfConversion({ adapter, scan, options: { defaultType: "Note" }, concurrency: 1 });
      for (const run of [preview, report]) {
        expect(run.changed).toEqual(["b.md"]);
        expect(run.skipped.map((s) => s.path)).toEqual(["a.md", "a.CONFLICT-1.md"]);
        expect(run.skipped[0].error).toMatch(/^The file has an open conflict; nothing was written/);
      }
      expect(base.store.get("a.md")).toBe("# theirs\n");
      expect(base.store.get("a.CONFLICT-1.md")).toBe("# mine\n");
      expect(backups(base)).toEqual([`${report.backupDir}/b.md`]);
    });
  });
});
