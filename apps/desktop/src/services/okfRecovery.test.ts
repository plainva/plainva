import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OkfScanResult } from "@plainva/core";

/**
 * The journal around an OKF conversion, and the recovery it makes possible.
 *
 * The run itself is shared with the phone and already covered by its own
 * tests; what is asserted here is the ORDER — journal on disk before the first
 * note is touched — and the three cases where the journal must survive: a
 * cancelled run, a partial rollback, and a journal that could not be written
 * at all (then nothing runs).
 *
 * These deliberately drive the REAL shared runner over a fake file system
 * rather than mocking it. A mock would prove that `runOkfConversion` was
 * called; only the real run proves that the journal was already there when its
 * first write landed.
 */

// ---- tauri doubles -------------------------------------------------------

const appData = new Map<string, string>();
let journalWriteFails = false;

const invokeMock = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === "register_write_root") return "root-1";
  if (cmd === "write_file_atomic") {
    if (journalWriteFails) throw new Error("disk full");
    appData.set(`APPDATA/okf-journal/${args?.relPath as string}`, args?.contents as string);
    return undefined;
  }
  throw new Error(`unexpected invoke ${cmd}`);
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invokeMock(...(a as [string, Record<string, unknown>])),
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "APPDATA",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (p: string) => appData.has(p) || p === "APPDATA/okf-journal",
  mkdir: async () => {},
  readTextFile: async (p: string) => {
    const c = appData.get(p);
    if (c === undefined) throw new Error(`missing ${p}`);
    return c;
  },
  remove: async (p: string) => {
    appData.delete(p);
  },
}));

import { convertVaultToOkf, undoOkfConversion } from "./okfConversion";
import { readOkfJournal, writeOkfJournal } from "./okfJournal";

// ---- vault double --------------------------------------------------------

const VAULT = "C:/vaults/main";

/** A vault adapter that records the order of what happened to it. */
function fakeVault(notes: Record<string, string>) {
  const files = new Map(Object.entries(notes));
  const writes: string[] = [];
  return {
    files,
    writes,
    adapter: {
      readTextFile: async (p: string) => {
        const c = files.get(p);
        if (c === undefined) throw new Error(`missing ${p}`);
        return c;
      },
      writeTextFile: async (p: string, content: string) => {
        writes.push(p);
        files.set(p, content);
      },
      createDir: async () => {},
      exists: async (p: string) => files.has(p) || [...files.keys()].some((f) => f.startsWith(`${p}/`)),
      listDir: async (path?: string) => {
        const prefix = path ? `${path}/` : "";
        return [...files.keys()]
          .filter((f) => f.startsWith(prefix))
          .map((f) => ({ path: f, isDirectory: false }));
      },
    },
  };
}

const scanOf = (paths: string[]): OkfScanResult => ({
  scanned: paths.length,
  violations: paths.map((path) => ({ path, kind: "missing-type" as const })),
  convertiblePaths: paths,
  typedPaths: [],
});

const OPTIONS = { defaultType: "Note" as const, existingTypeStrategy: "keep" as const };

beforeEach(() => {
  appData.clear();
  invokeMock.mockClear();
  journalWriteFails = false;
});

describe("OKF conversion journal", () => {
  it("is on disk before the first note is touched", async () => {
    const vault = fakeVault({ "A.md": "# A\n", "B.md": "# B\n" });
    // Fail the run at its very first write: whatever the journal has to prove,
    // it has to prove it BEFORE this point.
    let journalAtFirstWrite: string | null = null;
    const original = vault.adapter.writeTextFile;
    vault.adapter.writeTextFile = async (p: string, c: string) => {
      // Read through the real reader rather than guessing the file name.
      journalAtFirstWrite ??= JSON.stringify(await readOkfJournal(VAULT));
      return original(p, c);
    };

    await convertVaultToOkf({
      vaultPath: VAULT,
      adapter: vault.adapter,
      scan: scanOf(["A.md", "B.md"]),
      options: OPTIONS,
    });

    expect(vault.writes.length).toBeGreaterThan(0);
    expect(journalAtFirstWrite).not.toBeNull();
    expect(journalAtFirstWrite).toContain("okf-conversion-");
  });

  it("refuses to run at all when the journal cannot be written", async () => {
    journalWriteFails = true;
    const vault = fakeVault({ "A.md": "# A\n" });

    await expect(
      convertVaultToOkf({
        vaultPath: VAULT,
        adapter: vault.adapter,
        scan: scanOf(["A.md"]),
        options: OPTIONS,
      })
    ).rejects.toThrow(/disk full/);

    // Fail-closed: a conversion nobody could recover from is worse than one
    // that never started.
    expect(vault.writes).toEqual([]);
    expect(vault.files.get("A.md")).toBe("# A\n");
  });

  it("is cleared by a run that reaches the end", async () => {
    const vault = fakeVault({ "A.md": "# A\n" });
    await convertVaultToOkf({
      vaultPath: VAULT,
      adapter: vault.adapter,
      scan: scanOf(["A.md"]),
      options: OPTIONS,
    });
    expect(await readOkfJournal(VAULT)).toBeNull();
  });

  it("survives a cancelled run — that IS the state the recovery is for", async () => {
    const vault = fakeVault({ "A.md": "# A\n", "B.md": "# B\n" });
    const report = await convertVaultToOkf({
      vaultPath: VAULT,
      adapter: vault.adapter,
      scan: scanOf(["A.md", "B.md"]),
      options: OPTIONS,
      isCancelled: () => true,
    });
    expect(report.cancelled).toBe(true);
    expect(await readOkfJournal(VAULT)).not.toBeNull();
  });

  it("continues into the SAME backup folder rather than opening a second one", async () => {
    // Two folders would mean two undos, neither of which restores the vault on
    // its own. The name is fixed and unlike any generated one, so this cannot
    // pass by accident the way a timestamp comparison could.
    const carried = ".plainva/backups/okf-conversion-FIRST-PASS";
    const vault = fakeVault({ "A.md": "# A\n" });

    const report = await convertVaultToOkf({
      vaultPath: VAULT,
      adapter: vault.adapter,
      scan: scanOf(["A.md"]),
      options: OPTIONS,
      backupDir: carried,
    });

    expect(report.backupDir).toBe(carried);
    expect(vault.writes).toContain(`${carried}/A.md`);
    expect(vault.writes.some((w) => w.includes("okf-conversion-2"))).toBe(false);
  });

  it("keeps the journal when a rollback leaves something behind", async () => {
    await writeOkfJournal({
      startedAt: new Date().toISOString(),
      vaultPath: VAULT,
      backupDir: ".plainva/backups/okf-conversion-X",
      total: 1,
      options: { defaultType: "Note" },
    });
    const vault = fakeVault({ ".plainva/backups/okf-conversion-X/A.md": "# A\n" });
    // A restore that cannot write is a restore that did not happen.
    vault.adapter.writeTextFile = async () => {
      throw new Error("read-only");
    };

    const report = await undoOkfConversion(VAULT, vault.adapter, ".plainva/backups/okf-conversion-X");

    expect(report.failed.length).toBe(1);
    // Still recoverable: the next start offers it again.
    expect(await readOkfJournal(VAULT)).not.toBeNull();
  });

  it("clears the journal after a rollback that restored everything", async () => {
    await writeOkfJournal({
      startedAt: new Date().toISOString(),
      vaultPath: VAULT,
      backupDir: ".plainva/backups/okf-conversion-X",
      total: 1,
      options: { defaultType: "Note" },
    });
    const vault = fakeVault({ ".plainva/backups/okf-conversion-X/A.md": "# A\n" });

    const report = await undoOkfConversion(VAULT, vault.adapter, ".plainva/backups/okf-conversion-X");

    expect(report.failed).toEqual([]);
    expect(await readOkfJournal(VAULT)).toBeNull();
  });

  it("treats a journal without a backup folder as absent", async () => {
    // There would be nothing to continue into and nothing to roll back to;
    // offering a recovery that cannot work is worse than offering none.
    appData.set(
      `APPDATA/okf-journal/${(await import("./draftJournal")).pathHash(VAULT)}.json`,
      JSON.stringify({ startedAt: "x", vaultPath: VAULT, backupDir: "", total: 0, options: { defaultType: "Note" } })
    );
    expect(await readOkfJournal(VAULT)).toBeNull();
  });
});
