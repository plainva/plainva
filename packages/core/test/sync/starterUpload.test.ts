import { describe, expect, it, vi } from "vitest";
import { realSqlite } from "../helpers/realSqlite.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { STARTER_MANIFEST_PATH, isUntouchedStarter, starterHash } from "../../src/vault/starterFiles.js";
import { PLAINVA_INDEX_MARKER } from "../../src/okf-index.js";

/**
 * A template vault connected to its own folder - a new, empty one, for a
 * second device - uploads all of it, its untouched starter files included
 * (second review 2026-10-27). Starter content is held back only where the
 * phone copies a vault into a new one for a folder that already holds notes
 * (`planVaultTransfer`'s `keepBack`); no upload ever asks the starter record.
 */

const STARTER = "# Willkommen\n\nDas ist Plainva.\n";
const INDEX = `# Vault\n\n- [[Willkommen]]\n\n${PLAINVA_INDEX_MARKER}\n`;
const BASE = "views:\n  - type: table\n    name: Aufgaben\n";

function vaultWith(files: Map<string, string>) {
  const read = async (p: string) => {
    const text = files.get(p);
    if (text === undefined) throw Object.assign(new Error("missing"), { name: "VaultFileNotFoundError" });
    return text;
  };
  return {
    exists: vi.fn(async (p: string) => files.has(p)),
    readTextFile: vi.fn(read),
    readBinaryFile: vi.fn(async (p: string) => new TextEncoder().encode(await read(p))),
    getFileInfo: vi.fn(async () => ({ isDirectory: false })),
    listDir: vi.fn(async () => []),
  };
}

describe("a template vault on a new, empty folder", () => {
  it("uploads its untouched starter notes, databases and listings like every other file", async () => {
    const files = new Map([["Willkommen.md", STARTER], ["index.md", INDEX], ["Aufgaben.base", BASE], ["Meine Notiz.md", "# Meine Notiz\n"]]);
    files.set(STARTER_MANIFEST_PATH, JSON.stringify({ version: 1, files: { "Willkommen.md": starterHash(STARTER), "index.md": starterHash(INDEX), "Aufgaben.base": starterHash(BASE) } }));
    const db = await realSqlite();
    const queue = new SyncQueue(db);
    const target = { push: vi.fn(async () => ({ etag: "pushed" })), pull: vi.fn(), download: vi.fn() };
    const engine = new SyncEngine(queue, target as never, vaultWith(files) as never, new SyncStateRepository(db));
    for (const path of ["Willkommen.md", "index.md", "Aufgaben.base", "Meine Notiz.md"]) await queue.queueWrite(path);

    await engine.processQueue();

    expect(target.push.mock.calls.map((call) => ((call as unknown[])[0] as { file_path: string }).file_path).sort())
      .toEqual(["Aufgaben.base", "Meine Notiz.md", "Willkommen.md", "index.md"]);
  });
});

describe("a vault bound to a folder that already holds notes (third review 2026-10-27)", () => {
  it("keeps the starter files it held back, and sends the person's note and a starter note they changed - which is theirs from then on", async () => {
    const files = new Map([["Willkommen.md", STARTER], ["index.md", INDEX], ["Changed.md", "# Changed by me\n"], ["Meine Notiz.md", "# Meine Notiz\n"]]);
    const db = await realSqlite();
    const queue = new SyncQueue(db);
    const repo = new SyncStateRepository(db);
    await repo.holdBackStarters(new Map([["Willkommen.md", starterHash(STARTER)], ["index.md", starterHash(INDEX)], ["Changed.md", starterHash("# Changed\n")]]));
    const target = { push: vi.fn(async () => ({ etag: "pushed" })), pull: vi.fn(), download: vi.fn() };
    const engine = new SyncEngine(queue, target as never, vaultWith(files) as never, repo);
    for (const path of files.keys()) await queue.queueWrite(path);

    await engine.processQueue();

    expect(target.push.mock.calls.map((call) => ((call as unknown[])[0] as { file_path: string }).file_path).sort()).toEqual(["Changed.md", "Meine Notiz.md"]);
    expect([...(await repo.listHeldBackStarters()).keys()].sort()).toEqual(["Willkommen.md", "index.md"]);
    expect(await queue.getPendingOperations()).toEqual([]);
  });
});

describe("the starter record", () => {
  it("says untouched only for the bytes a file was written with, and for a listing while it carries the marker", () => {
    const manifest = { version: 1 as const, files: { "a.md": starterHash("a"), "index.md": starterHash("x") } };
    expect(isUntouchedStarter(manifest, "a.md", new TextEncoder().encode("a"))).toBe(true);
    expect(isUntouchedStarter(manifest, "a.md", new TextEncoder().encode("b"))).toBe(false);
    expect(isUntouchedStarter(manifest, "b.md", new TextEncoder().encode("a"))).toBe(false);
    expect(isUntouchedStarter(manifest, "index.md", new TextEncoder().encode(INDEX))).toBe(true);
    expect(isUntouchedStarter(null, "a.md", new TextEncoder().encode("a"))).toBe(false);
  });
});
