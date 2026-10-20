// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SyncStateRepository, VaultIndexer, type IDatabaseAdapter } from "@plainva/core";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { rebuildVaultIndex } from "./indexMaintenance";
import type { MobileVault } from "./vaultService";

/**
 * "Rebuild the index" on the phone rebuilds it (finding 2026-10-12).
 *
 * It ran the ordinary scan, which reads only what changed by its timestamp:
 * a note whose index entry was out of step with it under a matching
 * timestamp stayed as it was — the one thing the button is for. It now goes
 * the core's way, the desktop's too (`VaultIndexer.rebuildIndex`; the rules
 * of that way are in packages/core/test/vault-indexer-rebuild.test.ts).
 */

let root: string;
let vault: LocalVaultAdapter;
let db: IDatabaseAdapter;
let indexer: VaultIndexer;
let fresh: string[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-phone-rebuild-"));
  vault = new LocalVaultAdapter(root);
  await vault.initialize();
  db = await realSqlite();
  fresh = [];
  indexer = new VaultIndexer(vault, db, { onNewLocalFile: (p) => void fresh.push(p) });
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

const found = async (term: string) =>
  (await db.query<{ path: string }>("SELECT path FROM fts_notes WHERE fts_notes MATCH ? ORDER BY path", [term])).map((r) => r.path);

describe("rebuilding the index on the phone", () => {
  it("reads a note again whose index entry is out of step under a matching timestamp, and announces nothing the sync knows", async () => {
    await vault.writeTextFile("Plan.md", "# Plan\n");
    await vault.writeTextFile("Ideas.md", "# Ideas\n");
    await indexer.indexVaultFull("open, empty index");
    // Both files are known to the sync.
    const repo = new SyncStateRepository(db);
    for (const p of ["Plan.md", "Ideas.md"]) {
      await repo.updateBaseState(p, "base", "etag-1");
      await repo.updateRemoteState(p, "etag-1", null, 1);
    }
    await fs.writeFile(path.join(root, "Plan.md"), "# Plan\n\nthe zeppelin\n", "utf8");
    await db.execute("UPDATE files SET mtime_local = ? WHERE path = 'Plan.md'", [(await vault.getFileInfo("Plan.md")).mtime]);
    fresh.length = 0;

    expect(await rebuildVaultIndex({ indexer } as Pick<MobileVault, "indexer">)).toBe(true);

    expect(await found("zeppelin")).toEqual(["Plan.md"]);
    expect(fresh).toEqual([]);
  });

  it("says when it could not", async () => {
    expect(await rebuildVaultIndex({ indexer: null } as Pick<MobileVault, "indexer">)).toBe(false);
  });
});
