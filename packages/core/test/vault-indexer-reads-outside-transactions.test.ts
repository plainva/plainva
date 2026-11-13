import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";

/**
 * No file is read inside a transaction on the single-path routes (stability
 * plan R1, review M1): a save's pass (`indexFile`), the watcher's look at one
 * path (`indexPath`), a folder re-read (`reconcileFolder`).
 *
 * The read used to happen inside the transaction. A file that takes long to
 * read — on a share, behind a provider that fetches it first, a film of
 * gigabytes — held every other writer for as long: a save's queue entry, the
 * sync marking an upload done; they gave up after a minute, and on the
 * desktop a transaction that sent nothing for two minutes was rolled back
 * under its body. And a save that lands between the read and the write must
 * still end up indexed with the newer text.
 *
 * Real files and a real SQLite: a write sent to the adapter itself while a
 * transaction is open waits for it, and fails after two seconds under the
 * tests (realSqlite.ts) — so a write that goes through while a read is held
 * proves that no transaction is open.
 */

let root: string;
let raw: LocalVaultAdapter;
let db: IDatabaseAdapter;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-reads-outside-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * The vault, with the next read of `held` waiting until `release()`. With
 * `after`, the read is made first and its answer held: what the pass gets is
 * the file as it was when its read began (review of R1: holding before the
 * read let the slow pass read the newer text, and no test needed `claimWrite`).
 */
function holdingReads(held: string, after = false) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reached!: () => void;
  const reading = new Promise<void>((resolve) => { reached = resolve; });
  let armed = true;
  const vault = new Proxy(raw, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (key !== "readBinaryFile" && key !== "readTextFile") return value.bind(target);
      return async (p: string, ...rest: unknown[]) => {
        const read = () => (value as (...a: unknown[]) => Promise<unknown>).call(target, p, ...rest);
        if (armed && p === held) {
          armed = false;
          const answer = after ? await read() : undefined;
          reached();
          await gate;
          if (after) return answer;
        }
        return read();
      };
    },
  });
  return { vault, release, reading };
}

const later = (ms: number) => new Date(Date.now() + ms);

describe("a single path is read before its transaction", () => {
  it.each(["indexFile", "indexPath", "reconcileFolder"] as const)("while %s waits for a slow read, other writers go on", async (route) => {
    await raw.writeTextFile("Folder/Big.md", "# Big\n\nzeppelin\n");
    const { vault, release, reading } = holdingReads("Folder/Big.md");
    const indexer = new VaultIndexer(vault, db);
    const pass = route === "indexFile"
      ? indexer.indexFile(await raw.getFileInfo("Folder/Big.md"))
      : route === "indexPath" ? indexer.indexPath("Folder/Big.md") : indexer.reconcileFolder("Folder");
    await reading;
    // A write of another flow — it would wait for an open transaction and fail after two seconds.
    await db.execute("INSERT INTO meta (key, value) VALUES ('another writer', '1')");
    release();
    await pass;
    expect(await db.queryOne("SELECT value FROM meta WHERE key = 'another writer'")).toEqual({ value: "1" });
    expect((await new VaultQueryService(db).searchFullText("zeppelin")).map((hit) => hit.path)).toEqual(["Folder/Big.md"]);
  });

  it.each(["indexFile", "indexPath", "reconcileFolder"] as const)("a save that lands between the read and the write is indexed with its newer text (%s)", async (route) => {
    await raw.writeTextFile("Folder/Note.md", "# Note\n\nfirst balloon\n");
    await fs.utimes(path.join(root, "Folder/Note.md"), new Date(), later(-60_000));
    // The slow pass has READ the first text when the save comes; only the order of the reads keeps it from writing it.
    const { vault, release, reading } = holdingReads("Folder/Note.md", true);
    const slow = new VaultIndexer(vault, db);
    const listed = await raw.getFileInfo("Folder/Note.md");
    const pass = route === "indexFile" ? slow.indexFile(listed) : route === "indexPath" ? slow.indexPath("Folder/Note.md") : slow.reconcileFolder("Folder");
    await reading;
    // While the first pass reads, the note is saved and the save's own pass goes through.
    await fs.writeFile(path.join(root, "Folder/Note.md"), "# Note\n\nsecond zeppelin\n", "utf8");
    // Another program may set an OLDER timestamp: the order of the reads decides, not the file's clock.
    await fs.utimes(path.join(root, "Folder/Note.md"), new Date(), later(-3_600_000));
    // The save's pass is the same indexer's, as in the app; its read begins after the first one's.
    await slow.indexFile(await raw.getFileInfo("Folder/Note.md"));
    release();
    await pass;
    const search = new VaultQueryService(db);
    expect((await search.searchFullText("zeppelin")).map((hit) => hit.path)).toEqual(["Folder/Note.md"]);
    expect(await search.searchFullText("balloon")).toEqual([]);
  });
});
