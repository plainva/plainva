import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { realSqlite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";

/**
 * The mount point a drive leaves behind is no vault (review 2026-11-18, F62).
 *
 * On Linux and macOS a vault on a drive that went — a network share, a USB
 * disk — leaves its folder standing: empty, on the file system above. Every
 * note in it honestly answers "not found", the listing goes through, and the
 * full scan took that for the person deleting every note: the index emptied,
 * and every note reported deleted, which queues its deletion on the remote.
 * The storage tells it apart (`sameRootAsOpened`: the folder is no longer on
 * the device it was opened on), and the index judges nothing then.
 */

// The storage that can tell its place (`IVaultAdapter.sameRootAsOpened`), as the desktop's does.
let vault: MemoryVaultAdapter & { sameRootAsOpened?: () => Promise<boolean | null> };
let db: IDatabaseAdapter;
let indexer: VaultIndexer;
let gone: string[];
const NOTES = Array.from({ length: 50 }, (_, i) => `Notes/n${String(i).padStart(2, "0")}.md`);

beforeEach(async () => {
  vault = new MemoryVaultAdapter();
  // The vault's own folder is there, also when it holds nothing.
  const own = vault.exists.bind(vault);
  vault.exists = async (p) => p === "" || own(p);
  db = await realSqlite();
  gone = [];
  indexer = new VaultIndexer(vault, db, { onLocalFileDeleted: (p) => gone.push(p) });
  for (const note of NOTES) await vault.writeTextFile(note, `# ${note}\n`);
  await indexer.indexVaultFull();
});

afterEach(async () => {
  await db.close();
});

const rows = async () => (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path);

/** The drive went: the vault's folder stands empty on another device. */
function mountPointLeft(): () => void {
  const empty = new MemoryVaultAdapter();
  const saved = { listDir: vault.listDir, exists: vault.exists, getFileInfo: vault.getFileInfo };
  vault.listDir = (p, r) => empty.listDir(p, r);
  vault.exists = async (p) => p === "" || empty.exists(p);
  vault.getFileInfo = (p) => empty.getFileInfo(p);
  vault.sameRootAsOpened = async () => false;
  return () => {
    Object.assign(vault, saved);
    vault.sameRootAsOpened = async () => true;
  };
}

describe("the mount point a drive leaves behind", () => {
  it("is not judged: a full scan removes no row and reports no deletion", async () => {
    expect(await rows()).toHaveLength(50);
    mountPointLeft();
    await indexer.indexVaultFull();
    expect(await rows()).toHaveLength(50);
    expect(gone).toEqual([]);
  });

  it("is judged again once the folder is the same place: the next scan works as ever", async () => {
    const back = mountPointLeft();
    await indexer.indexVaultFull();
    back();
    await vault.deleteItem(NOTES[0]);
    await indexer.indexVaultFull();
    expect(await rows()).toHaveLength(49);
    expect(gone).toEqual([NOTES[0]]);
  });

  it("does not keep a vault left empty by the person from its scan: there, a deleted note goes", async () => {
    for (const note of NOTES) await vault.deleteItem(note);
    vault.sameRootAsOpened = async () => true;
    await indexer.indexVaultFull();
    expect(await rows()).toEqual([]);
    expect(gone).toHaveLength(50);
  });
});

describe("every question whether the vault is there goes through one answer", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("in the index and in what both shells hand the owed-to-remote sweep", () => {
    expect(read("../src/vault/VaultIndexer.ts")).toMatch(/return \(await vaultFolderIsThere\(this\.vaultAdapter\)\) === true;/);
    expect(read("../../../apps/desktop/src/contexts/VaultContext.tsx")).toMatch(/vaultIsThere: \(\) => vaultFolderIsThere\(vaultAdapter\)\.then\(\(there\) => there === true\),/);
    expect(read("../../../apps/mobile/src/services/vaultService.ts")).toMatch(/vaultIsThere: \(\) => vaultFolderIsThere\(files\)\.then\(\(there\) => there === true\),/);
  });
});

