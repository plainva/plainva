import { describe, expect, it, vi } from "vitest";
import { realSqlite } from "../helpers/realSqlite.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { STARTER_MANIFEST_PATH, isUntouchedStarter, starterHash } from "../../src/vault/starterFiles.js";
import { PLAINVA_INDEX_MARKER } from "../../src/okf-index.js";

/**
 * The starter content of a fresh vault never goes into a folder the vault is
 * connected to (review 2026-10-27): the phone's starter notes went up into
 * the person's existing wiki. The person's own notes go up as before, and so
 * does a starter note the moment they change it.
 */

const STARTER = "# Willkommen\n\nDas ist Plainva.\n";

function vaultWith(files: Map<string, string>) {
  return {
    exists: vi.fn(async (p: string) => files.has(p)),
    readTextFile: vi.fn(async (p: string) => {
      const text = files.get(p);
      if (text === undefined) throw Object.assign(new Error("missing"), { name: "VaultFileNotFoundError" });
      return text;
    }),
    readBinaryFile: vi.fn(async (p: string) => {
      const text = files.get(p);
      if (text === undefined) throw Object.assign(new Error("missing"), { name: "VaultFileNotFoundError" });
      return new TextEncoder().encode(text);
    }),
    getFileInfo: vi.fn(async () => ({ isDirectory: false })),
    listDir: vi.fn(async () => []),
  };
}

async function setup(files: Map<string, string>) {
  files.set(STARTER_MANIFEST_PATH, JSON.stringify({ version: 1, files: { "Willkommen.md": starterHash(STARTER), "index.md": starterHash("x") } }));
  const db = await realSqlite();
  const repo = new SyncStateRepository(db);
  const queue = new SyncQueue(db);
  const target = { push: vi.fn(async () => ({ etag: "pushed" })), pull: vi.fn(), download: vi.fn() };
  const engine = new SyncEngine(queue, target as never, vaultWith(files) as never, repo);
  return { repo, queue, target, engine };
}

const pushed = (target: { push: { mock: { calls: unknown[][] } } }) =>
  target.push.mock.calls.map((call) => (call[0] as { file_path: string }).file_path);

describe("starter content and a connected folder", () => {
  it("an untouched starter note stays on this device; the person's own note goes up", async () => {
    const files = new Map([["Willkommen.md", STARTER], ["Meine Notiz.md", "# Meine Notiz\n"]]);
    const { queue, target, engine } = await setup(files);
    await queue.queueWrite("Willkommen.md");
    await queue.queueWrite("Meine Notiz.md");

    await engine.processQueue();

    expect(pushed(target)).toEqual(["Meine Notiz.md"]);
    expect(await queue.getPendingOperations()).toEqual([]);
  });

  it("a starter note the person changed is theirs and goes up", async () => {
    const files = new Map([["Willkommen.md", STARTER + "Mein eigener Satz.\n"]]);
    const { queue, target, engine } = await setup(files);
    await queue.queueWrite("Willkommen.md");

    await engine.processQueue();

    expect(pushed(target)).toEqual(["Willkommen.md"]);
  });

  it("a generated listing stays the app's while it carries the marker", async () => {
    const files = new Map([["index.md", `# Vault\n\n- [[Meine Notiz]]\n\n${PLAINVA_INDEX_MARKER}\n`]]);
    const { queue, target, engine } = await setup(files);
    await queue.queueWrite("index.md");

    await engine.processQueue();

    expect(pushed(target)).toEqual([]);
  });

  it("a starter file the remote already holds syncs as before", async () => {
    const files = new Map([["Willkommen.md", STARTER]]);
    const { repo, queue, target, engine } = await setup(files);
    await repo.updateRemoteState("Willkommen.md", "e1", "id-1", 1);
    await queue.queueWrite("Willkommen.md", { force: true });

    await engine.processQueue();

    expect(pushed(target)).toEqual(["Willkommen.md"]);
  });

  it("says untouched only for the bytes it was written with", () => {
    const manifest = { version: 1 as const, files: { "a.md": starterHash("a") } };
    expect(isUntouchedStarter(manifest, "a.md", new TextEncoder().encode("a"))).toBe(true);
    expect(isUntouchedStarter(manifest, "a.md", new TextEncoder().encode("b"))).toBe(false);
    expect(isUntouchedStarter(manifest, "b.md", new TextEncoder().encode("a"))).toBe(false);
    expect(isUntouchedStarter(null, "a.md", new TextEncoder().encode("a"))).toBe(false);
  });
});
