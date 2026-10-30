import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Whose OKF journal is it (open-items plan 3.124, the same class as the draft
 * journal): the file name was a lossy hash of the vault path, and the vaults
 * `C:/vaults/A` and `C:/vaults/B` got the same one — an interrupted run in one
 * vault was offered for recovery in the other.
 */

const appData = new Map<string, string>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "register_write_root") return "root-1";
    if (cmd === "write_file_atomic") {
      appData.set(`APPDATA/okf-journal/${args?.relPath as string}`, args?.contents as string);
      return undefined;
    }
    throw new Error(`unexpected invoke ${cmd}`);
  },
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

import { legacyPathHash } from "./draftJournal";
import { clearOkfJournal, readOkfJournal, writeOkfJournal, type OkfJournal } from "./okfJournal";

const journal = (vaultPath: string): OkfJournal => ({
  startedAt: "2026-10-30T10:00:00Z",
  vaultPath,
  backupDir: ".plainva/backups/okf-conversion-X",
  total: 3,
  options: { defaultType: "Note" },
});

describe("OKF journal per vault", () => {
  beforeEach(() => appData.clear());

  it("is never another vault's, even when the two paths differ only at the end", async () => {
    await writeOkfJournal(journal("C:/vaults/A"));
    expect(await readOkfJournal("C:/vaults/B")).toBeNull();
    expect(await readOkfJournal("C:/vaults/A")).toMatchObject({ vaultPath: "C:/vaults/A" });
    await clearOkfJournal("C:/vaults/B");
    expect(await readOkfJournal("C:/vaults/A")).toMatchObject({ vaultPath: "C:/vaults/A" });
  });

  it("still finds a journal an older version wrote under the old name, and clears it", async () => {
    appData.set(`APPDATA/okf-journal/${legacyPathHash("C:/vaults/A")}.json`, JSON.stringify(journal("C:/vaults/A")));
    expect(await readOkfJournal("C:/vaults/B")).toBeNull();
    expect(await readOkfJournal("C:/vaults/A")).toMatchObject({ vaultPath: "C:/vaults/A", total: 3 });
    await clearOkfJournal("C:/vaults/A");
    expect(await readOkfJournal("C:/vaults/A")).toBeNull();
  });
});
