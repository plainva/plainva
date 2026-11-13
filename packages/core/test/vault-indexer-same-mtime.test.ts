import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer, sameAsIndexed } from "../src/vault/VaultIndexer.js";

/**
 * Two writes of one file within the clock's resolution carry the same
 * modification time. A file another program wrote again right after a pass
 * had indexed it — on Windows a few milliseconds are enough — was taken for
 * the one indexed and never read again: its change was not announced, so not
 * uploaded. Found when the full scan became fast enough for the sync tests
 * to land two writes in one tick (performance plan L2).
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

async function vault() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-same-mtime-"));
  const db = await realSqlite();
  closers.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const adapter = new LocalVaultAdapter(root);
  await adapter.initialize();
  const changed: string[] = [];
  const indexer = new VaultIndexer(adapter, db, { onExternalModification: (p) => void changed.push(p) });
  return { root, db, indexer, changed };
}

/** Writes `text` and gives the file exactly the time `at`, as a second write in the same tick would. */
async function writeAt(root: string, name: string, text: string, at: Date) {
  await fs.writeFile(path.join(root, name), text);
  await fs.utimes(path.join(root, name), at, at);
}

describe("a file written again within the same tick", () => {
  const at = new Date(1_790_000_000_000);

  for (const [kind, name] of [["a note", "Note.md"], ["an attachment", "Data.csv"]] as const) {
    it(`is read again by the full scan when its size changed (${kind})`, async () => {
      const { root, db, indexer, changed } = await vault();
      await writeAt(root, name, "one\n", at);
      await indexer.indexVaultFull();
      await db.execute("UPDATE sync_state SET local_sha256 = (SELECT sha256 FROM files WHERE path = ?) WHERE path = ?", [name, name]);
      await writeAt(root, name, "one and two\n", at);
      await indexer.indexVaultFull();
      expect(changed).toEqual([name]);
      const row = await db.queryOne<{ size_bytes: number }>("SELECT size_bytes FROM files WHERE path = ?", [name]);
      expect(row!.size_bytes).toBe("one and two\n".length);
    });

    it(`is read again by a folder re-read when its size changed (${kind}, third review of 11.11.)`, async () => {
      const { root, db, indexer } = await vault();
      await fs.mkdir(path.join(root, "Folder"));
      const inFolder = `Folder/${name}`;
      await writeAt(root, inFolder, "one\n", at);
      await indexer.indexVaultFull();
      await writeAt(root, inFolder, "one and two\n", at);
      expect((await indexer.reconcileFolder("Folder")).indexed).toEqual([inFolder]);
      const row = await db.queryOne<{ size_bytes: number }>("SELECT size_bytes FROM files WHERE path = ?", [inFolder]);
      expect(row!.size_bytes).toBe("one and two\n".length);
    });

    it(`is read again by a single path when its size changed (${kind})`, async () => {
      const { root, db, indexer } = await vault();
      await writeAt(root, name, "one\n", at);
      await indexer.indexVaultFull();
      await writeAt(root, name, "one and two\n", at);
      await indexer.indexPath(name);
      const row = await db.queryOne<{ size_bytes: number }>("SELECT size_bytes FROM files WHERE path = ?", [name]);
      expect(row!.size_bytes).toBe("one and two\n".length);
    });
  }

  it("is left alone when time and size agree, and judged by its time where a size is unknown", () => {
    expect(sameAsIndexed({ mtime_local: 5, size_bytes: 4 }, { mtime: 5, size: 4 })).toBe(true);
    expect(sameAsIndexed({ mtime_local: 5, size_bytes: 4 }, { mtime: 5, size: 12 })).toBe(false);
    expect(sameAsIndexed({ mtime_local: 5, size_bytes: 4 }, { mtime: 6, size: 4 })).toBe(false);
    expect(sameAsIndexed({ mtime_local: 5, size_bytes: null }, { mtime: 5, size: 12 })).toBe(true);
    expect(sameAsIndexed({ mtime_local: 5 }, { mtime: 5 })).toBe(true);
    expect(sameAsIndexed(null, { mtime: 5, size: 4 })).toBe(false);
  });
});
