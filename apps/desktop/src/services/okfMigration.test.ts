import { describe, it, expect } from "vitest";
import { OKF_VERSION } from "@plainva/core";
import type { OkfConversionAdapter } from "@plainva/ui";
import {
  okfBundleStatusLines,
  okfMigrationPending,
  okfVersionBreakdown,
  rollbackOkfConversion,
  runOkfMigration,
  scanVaultOkfVersion,
} from "./okfMigration";

// OKF v0.2 plan, P2 — the desktop half of the bundle migration: the index
// names the candidates, the shared run lifts the root and strips the notes,
// every write goes through a backup that the undo can read back.

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
    exists: async (p) => store.has(p) || dirs.has(p) || [...store.keys()].some((k) => k.startsWith(`${p}/`)),
    // Mirrors the real adapters: flat by default, folder entries included, so a
    // rollback that forgot the recursive flag would be caught here too.
    listDir: async (path = "", recursive = false) => {
      const prefix = path ? `${path}/` : "";
      const out: { path: string; isDirectory: boolean }[] = [];
      const folders = new Set<string>();
      for (const key of store.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const cut = rest.indexOf("/");
        if (cut === -1) out.push({ path: key, isDirectory: false });
        else {
          folders.add(prefix + rest.slice(0, cut));
          if (recursive) out.push({ path: key, isDirectory: false });
        }
      }
      for (const d of folders) out.push({ path: d, isDirectory: true });
      return out;
    },
  };
  // The index: `properties` holds every frontmatter key of every note, so the
  // candidate query returns exactly the notes whose frontmatter carries the key.
  const queryService = {
    db: {
      query: async () =>
        [...store.entries()]
          .filter(([p, c]) => p.endsWith(".md") && !p.startsWith(".plainva") && /(^|\n)okf_version:/.test(c))
          .map(([path]) => ({ path })),
    },
  } as any;
  return { store, dirs, adapter, queryService };
}

const ROOT_01 = '---\nokf_version: "0.1"\n---\n# Vault\n\n* [a](a.md)\n';
const NOTE_01 = '---\ntype: Note\nokf_version: "0.1"\n---\n\nBody\n';
const NOTE_10 = '---\ntype: Note\nokf_version: "1.0"\n---\n\nBody\n';
const CLEAN = "---\ntype: Note\n---\n\nBody\n";
const SUB_INDEX = '---\nokf_version: "0.1"\n---\n# Sub\n';

const vaultFiles = (): Record<string, string> => ({
  "index.md": ROOT_01,
  "a.md": NOTE_01,
  "b.md": NOTE_10,
  "Sub/c.md": NOTE_01,
  "d.md": CLEAN,
  // A subfolder index.md is reserved, never a candidate and never touched.
  "Sub/index.md": SUB_INDEX,
});

describe("scanVaultOkfVersion", () => {
  it("names the root declaration and the notes still carrying the legacy key", async () => {
    const { adapter, queryService } = makeAdapter(vaultFiles());
    const state = await scanVaultOkfVersion({ queryService, adapter });
    expect(state.rootIndex).toEqual({ exists: true, declared: "0.1", current: false });
    expect(state.targetVersion).toBe(OKF_VERSION);
    // Sorted by path the way the scan sorts (locale-aware, so "Sub" after "b").
    expect(state.notesWithVersion.map((n) => n.path)).toEqual(["a.md", "b.md", "Sub/c.md"]);
    expect(state.byValue).toEqual({ "0.1": 2, "1.0": 1 });
    expect(okfVersionBreakdown(state)).toBe("2× 0.1, 1× 1.0");
    expect(okfBundleStatusLines(state).map((l) => l.key)).toEqual(["settings.okfBundleDeclares", "settings.okfBundleLegacy"]);
    expect(okfMigrationPending(state, false)).toBe(true);
  });

  it("reports a vault without root, without declaration and an up-to-date one", async () => {
    const noRoot = makeAdapter({ "d.md": CLEAN });
    const s1 = await scanVaultOkfVersion(noRoot);
    expect(s1.rootIndex.exists).toBe(false);
    expect(okfBundleStatusLines(s1)).toEqual([{ key: "settings.okfBundleNoRoot", params: {} }]);
    expect(okfMigrationPending(s1, true)).toBe(false);
    expect(okfVersionBreakdown(s1)).toBe("");

    const noDecl = makeAdapter({ "index.md": "# Vault\n", "d.md": CLEAN });
    const s2 = await scanVaultOkfVersion(noDecl);
    expect(s2.rootIndex).toEqual({ exists: true, declared: null, current: false });
    expect(okfBundleStatusLines(s2).map((l) => l.key)).toEqual(["settings.okfBundleNoDeclaration"]);

    const current = makeAdapter({ "index.md": `---\nokf_version: "${OKF_VERSION}"\n---\n# Vault\n`, "d.md": CLEAN });
    const s3 = await scanVaultOkfVersion(current);
    expect(s3.rootIndex.current).toBe(true);
    expect(okfBundleStatusLines(s3)).toEqual([{ key: "settings.okfBundleCurrent", params: { declared: OKF_VERSION } }]);
    expect(okfMigrationPending(s3, true)).toBe(false);
  });
});

describe("runOkfMigration", () => {
  it("lifts the root and strips the notes through backups, then has nothing left to do", async () => {
    const { store, adapter, queryService } = makeAdapter(vaultFiles());
    const state = await scanVaultOkfVersion({ queryService, adapter });

    const report = await runOkfMigration({ adapter, state, stripNoteVersion: true });

    expect([...report.changed].sort()).toEqual(["Sub/c.md", "a.md", "b.md", "index.md"]);
    expect(report.unchanged).toBe(0);
    expect(report.skipped).toEqual([]);
    expect(report.cancelled).toBe(false);
    expect(store.get("index.md")).toBe(`---\nokf_version: "${OKF_VERSION}"\n---\n# Vault\n\n* [a](a.md)\n`);
    expect(store.get("a.md")).toBe(CLEAN);
    expect(store.get("b.md")).toBe(CLEAN);
    expect(store.get("Sub/c.md")).toBe(CLEAN);
    expect(store.get("d.md")).toBe(CLEAN);
    expect(store.get("Sub/index.md")).toBe(SUB_INDEX);
    // The backup folder uses its own batch prefix and holds the originals.
    expect(report.backupDir).toMatch(/^\.plainva\/backups\/okf-migration-/);
    expect(store.get(`${report.backupDir}/index.md`)).toBe(ROOT_01);
    expect(store.get(`${report.backupDir}/a.md`)).toBe(NOTE_01);
    expect(store.get(`${report.backupDir}/b.md`)).toBe(NOTE_10);

    // Idempotent: the second scan finds nothing and a second run writes nothing.
    const again = await scanVaultOkfVersion({ queryService, adapter });
    expect(again.rootIndex.current).toBe(true);
    expect(again.notesWithVersion).toEqual([]);
    expect(okfMigrationPending(again, true)).toBe(false);
    const second = await runOkfMigration({ adapter, state: again, stripNoteVersion: true });
    expect(second.changed).toEqual([]);
    // No file was touched, so no backup was written either (the folder name is
    // reserved up front, the folder only materialises with its first file).
    expect([...store.keys()].some((k) => k.startsWith(`${second.backupDir}/`))).toBe(false);
  });

  it("leaves the notes alone when the cleanup is opted out", async () => {
    const { store, adapter, queryService } = makeAdapter(vaultFiles());
    const state = await scanVaultOkfVersion({ queryService, adapter });
    const report = await runOkfMigration({ adapter, state, stripNoteVersion: false });
    expect(report.changed).toEqual(["index.md"]);
    expect(store.get("a.md")).toBe(NOTE_01);
    expect(store.get("b.md")).toBe(NOTE_10);
    // The notes are still pending once the user opts in.
    const again = await scanVaultOkfVersion({ queryService, adapter });
    expect(okfMigrationPending(again, false)).toBe(false);
    expect(okfMigrationPending(again, true)).toBe(true);
  });

  it("writes nothing in a dry run", async () => {
    const { store, adapter, queryService } = makeAdapter(vaultFiles());
    const before = new Map(store);
    const state = await scanVaultOkfVersion({ queryService, adapter });
    const report = await runOkfMigration({ adapter, state, stripNoteVersion: true, dryRun: true });
    expect(report.changed.length).toBe(4);
    expect(report.backupDir).toBe("");
    expect([...store.entries()]).toEqual([...before.entries()]);
  });

  it("undo puts every file back from the run's backup folder", async () => {
    const { store, adapter, queryService } = makeAdapter(vaultFiles());
    const state = await scanVaultOkfVersion({ queryService, adapter });
    const report = await runOkfMigration({ adapter, state, stripNoteVersion: true });
    const undo = await rollbackOkfConversion(adapter, report.backupDir);
    expect(undo.failed).toEqual([]);
    expect([...undo.restored].sort()).toEqual(["Sub/c.md", "a.md", "b.md", "index.md"]);
    for (const [path, content] of Object.entries(vaultFiles())) {
      expect(store.get(path), path).toBe(content);
    }
  });

  it("stops between files when asked and says so", async () => {
    const { store, adapter, queryService } = makeAdapter(vaultFiles());
    const state = await scanVaultOkfVersion({ queryService, adapter });
    let done = 0;
    const report = await runOkfMigration({
      adapter,
      state,
      stripNoteVersion: true,
      concurrency: 1,
      onProgress: (n) => {
        done = n;
      },
      isCancelled: () => done >= 1,
    });
    expect(report.cancelled).toBe(true);
    expect(report.changed.length).toBeGreaterThanOrEqual(1);
    expect(report.changed.length).toBeLessThan(4);
    // What changed stays changed, what did not is untouched — and the next scan
    // simply offers the rest.
    const again = await scanVaultOkfVersion({ queryService, adapter });
    expect(okfMigrationPending(again, true)).toBe(true);
    expect(store.get("Sub/index.md")).toBe(SUB_INDEX);
  });
});
