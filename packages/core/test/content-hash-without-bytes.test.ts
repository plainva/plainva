import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { contentSha256Of, fileSha256 } from "../src/vault/localText.js";

/**
 * The index and the sync need only the hash of a picture. On a phone every
 * byte a vault adapter hands out crosses the WebView bridge, where a whole
 * picture as one message froze the app (17.11.): an adapter that takes the
 * hash where the file lies (`contentSha256`) is asked for it, and the bytes
 * are not read.
 */

const sha = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");

/** A vault whose binary files cannot be read whole - only hashed. */
class HashOnlyVault extends LocalVaultAdapter {
  hashed: string[] = [];
  override async readBinaryFile(file: string): Promise<Uint8Array> {
    if (file.endsWith(".png")) throw new Error(`${file} was read whole`);
    return super.readBinaryFile(file);
  }
  async contentSha256(file: string): Promise<string> {
    this.hashed.push(file);
    return sha(await super.readBinaryFile(file));
  }
}

let root: string;
let vault: HashOnlyVault;
let db: IDatabaseAdapter;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-hash-only-"));
  vault = new HashOnlyVault(root);
  await vault.initialize();
  db = await realSqlite();
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe("a file's hash without its bytes", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

  it("the index takes an attachment's hash from the adapter", async () => {
    await vault.writeBinaryFile("shot.png", png);
    const indexer = new VaultIndexer(vault, db);
    expect(await indexer.indexFile(await vault.getFileInfo("shot.png"))).toBe(true);
    expect(vault.hashed).toEqual(["shot.png"]);
    const row = await db.queryOne<{ local_sha256: string }>("SELECT local_sha256 FROM sync_state WHERE path = ?", ["shot.png"]);
    expect(row?.local_sha256).toBe(await sha(png));
  });

  it("the file hash of the conflict paths asks the adapter, and falls back to the bytes", async () => {
    await vault.writeBinaryFile("shot.png", png);
    expect(await fileSha256(vault, "shot.png")).toBe(await sha(png));
    expect(await fileSha256(vault, "missing.png")).toBeNull();
    const plain = new LocalVaultAdapter(root);
    expect(await contentSha256Of(plain, "shot.png")).toBe(await sha(png));
  });
});
