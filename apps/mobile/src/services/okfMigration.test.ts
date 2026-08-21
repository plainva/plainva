// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { OKF_VERSION, okfMigrationPending } from "@plainva/core";
import { migrateVaultOkf, scanVaultOkfVersion, undoOkfMigration } from "./okfMigration";
import type { MobileVault } from "./vaultService";

// OKF v0.2 plan, P2 — the phone's half of the bundle migration. The run is the
// shared one; what this pins is the wiring: the index names the candidates,
// the root is read directly, the writes go through `vault.files`, and the
// undo reads the run's backup folder back through the real listDir shape.

/**
 * A vault whose files live in a map — the same fake the conversion test uses,
 * including `listDir` being non-recursive by default with folder entries.
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
      for (const d of dirs) out.push({ path: d, isDirectory: true });
      return out;
    },
  };
  const vault = {
    vaultId: "fixture-vault",
    files: adapter,
    queryService: {
      db: {
        // The `properties` table would list every note whose frontmatter
        // carries the key; the fake derives that from the content.
        query: async () =>
          [...files.entries()]
            .filter(([p, c]) => p.endsWith(".md") && !p.startsWith(".plainva") && /(^|\n)okf_version:/.test(c))
            .map(([path]) => ({ path })),
      },
    },
  } as unknown as MobileVault;
  return { vault, files };
}

const ROOT_01 = '---\nokf_version: "0.1"\n---\n# Vault\n\n* [a](a.md)\n';
const NOTE_01 = '---\ntype: Note\nokf_version: "0.1"\n---\n\nBody\n';
const NOTE_10 = '---\ntype: Note\nokf_version: "1.0"\n---\n\nBody\n';
const CLEAN = "---\ntype: Note\n---\n\nBody\n";

const vaultFiles = (): Record<string, string> => ({
  "index.md": ROOT_01,
  "a.md": NOTE_01,
  "Sub/b.md": NOTE_10,
  "c.md": CLEAN,
});

describe("the OKF bundle migration from the phone", () => {
  it("scans through the index and reads the root directly", async () => {
    const { vault } = fakeVault(vaultFiles());
    const state = await scanVaultOkfVersion(vault);
    expect(state.rootIndex).toEqual({ exists: true, declared: "0.1", current: false });
    // Sorted by path the way the scan sorts (locale-aware, so "Sub" after "a").
    expect(state.notesWithVersion.map((n) => n.path)).toEqual(["a.md", "Sub/b.md"]);
    expect(okfMigrationPending(state, false)).toBe(true);
  });

  it("refuses to scan a vault whose index is not ready", async () => {
    const { vault } = fakeVault(vaultFiles());
    (vault as unknown as { queryService: unknown }).queryService = undefined;
    await expect(scanVaultOkfVersion(vault)).rejects.toThrow(/no index/);
  });

  it("lifts the root, strips the notes and can undo both from the backup folder", async () => {
    const { vault, files } = fakeVault(vaultFiles());
    const state = await scanVaultOkfVersion(vault);
    const seen: string[] = [];

    const report = await migrateVaultOkf({
      vault,
      state,
      stripNoteVersion: true,
      onProgress: (_done, _total, path) => seen.push(path),
    });

    // concurrency 1 — the root first, then the notes in the scan's order.
    const expectedOrder = ["index.md", ...state.notesWithVersion.map((n) => n.path)];
    expect(expectedOrder).toEqual(["index.md", "a.md", "Sub/b.md"]);
    expect(report.changed).toEqual(expectedOrder);
    expect(seen).toEqual(expectedOrder);
    expect(files.get("index.md")).toBe(`---\nokf_version: "${OKF_VERSION}"\n---\n# Vault\n\n* [a](a.md)\n`);
    expect(files.get("a.md")).toBe(CLEAN);
    expect(files.get("Sub/b.md")).toBe(CLEAN);
    expect(files.get("c.md")).toBe(CLEAN);
    expect(report.backupDir).toMatch(/^\.plainva\/backups\/okf-migration-/);
    expect(files.get(`${report.backupDir}/Sub/b.md`)).toBe(NOTE_10);

    // A second scan offers nothing; the bundle is current.
    const again = await scanVaultOkfVersion(vault);
    expect(again.rootIndex.current).toBe(true);
    expect(okfMigrationPending(again, true)).toBe(false);

    const undo = await undoOkfMigration(vault, report.backupDir);
    expect(undo.failed).toEqual([]);
    expect([...undo.restored].sort()).toEqual(["Sub/b.md", "a.md", "index.md"]);
    for (const [path, content] of Object.entries(vaultFiles())) {
      expect(files.get(path), path).toBe(content);
    }
  });

  it("pauses between files and leaves the rest for the next run", async () => {
    const { vault, files } = fakeVault(vaultFiles());
    const state = await scanVaultOkfVersion(vault);
    let done = 0;
    const report = await migrateVaultOkf({
      vault,
      state,
      stripNoteVersion: true,
      onProgress: (n) => {
        done = n;
      },
      // The appStateChange listener flips exactly this flag when the app
      // goes to the background.
      isCancelled: () => done >= 1,
    });
    expect(report.cancelled).toBe(true);
    expect(report.changed.length).toBeGreaterThanOrEqual(1);
    expect(report.changed.length).toBeLessThan(3);
    // The half state is valid and visible: the next scan names what is left.
    const again = await scanVaultOkfVersion(vault);
    expect(okfMigrationPending(again, true)).toBe(true);
    expect(files.get("c.md")).toBe(CLEAN);
  });
});
