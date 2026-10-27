import { afterEach, describe, expect, it } from "vitest";
import { SyncEngine, SyncQueue, SyncStateRepository, SyncWorker, type IDatabaseAdapter } from "@plainva/core";
import { folderHoldsNotes, getVaultTemplates, holdBackStartersAtFirstListing, scaffoldVaultTemplate, starterFilesToHoldBack } from "@plainva/ui";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { MemoryVaultAdapter } from "../../../../packages/core/test/helpers/memoryVault";

/**
 * The desktop binds its open vault to a cloud folder in place (third review
 * 2026-10-27). A template vault bound to a folder that already holds notes put
 * its untouched starter notes into that folder - the maintainer's harm, on the
 * other shell. Now one rule decides for both shells: the folder's first
 * listing says whether it holds notes; where it does, the starter files
 * nobody changed stay here, and every upload asks the record of them.
 */

const NOW = new Date(2026, 9, 27, 10, 0);
const template = getVaultTemplates("en").find((def) => def.notes.length > 2) ?? getVaultTemplates("en")[0];

let db: IDatabaseAdapter | null = null;
afterEach(async () => { await db?.close(); db = null; });

async function templateVault() {
  const vault = new MemoryVaultAdapter(NOW.getTime());
  await scaffoldVaultTemplate({ isNewVault: true, adapter: vault, template, vaultName: "Vault", subfoldersHeading: "Subfolders", now: NOW });
  await vault.writeTextFile("My own note.md", "# My own note\n");
  return vault;
}

/** Binds the vault to a folder holding `remote`, runs its first cycle, and says what went up. */
async function bindAndSync(vault: MemoryVaultAdapter, remote: Record<string, string>): Promise<string[]> {
  db = await realSqlite();
  const repo = new SyncStateRepository(db);
  const queue = new SyncQueue(db);
  // Everything local waits to go up, as the local-only sweep queues it.
  for (const entry of await vault.listDir("", true)) if (!entry.isDirectory && !entry.path.startsWith(".plainva")) await queue.queueWrite(entry.path);
  const pushed: string[] = [];
  const target = {
    pull: async () => ({ etagMap: new Map(Object.keys(remote).map((path) => [path, `e-${path}`])) }),
    download: async (path: string) => (path in remote ? new TextEncoder().encode(remote[path]) : null),
    push: async (op: { file_path: string; new_path?: string }) => { pushed.push(op.new_path ?? op.file_path); return { etag: "pushed" }; },
  };
  const engine = new SyncEngine(queue, target as never, vault, repo);
  const worker = new SyncWorker(engine, target as never, repo, vault, queue, 60_000);
  Reflect.set(worker, "isRunning", true);
  holdBackStartersAtFirstListing(worker, vault, repo);
  await worker.runCycle();
  return pushed;
}

const starterPaths = async (vault: MemoryVaultAdapter) => (await vault.listDir("", true))
  .filter((entry) => !entry.isDirectory && !entry.path.startsWith(".plainva") && entry.path !== "My own note.md")
  .map((entry) => entry.path);

describe("a template vault the desktop binds to a cloud folder", () => {
  it("bound to a folder that already holds notes, keeps its untouched starter notes here and sends the person's own", async () => {
    const vault = await templateVault();
    const starters = await starterPaths(vault);
    expect(starters.length).toBeGreaterThan(0);

    const pushed = await bindAndSync(vault, { "Wiki/Existing.md": "# Existing\n" });

    expect(pushed).toContain("My own note.md");
    expect(pushed.filter((path) => starters.includes(path))).toEqual([]);
  });

  it("sends a starter note the moment the person changed it", async () => {
    const vault = await templateVault();
    const [changed] = (await starterPaths(vault)).filter((path) => path.endsWith(".md") && !path.endsWith("index.md"));
    await vault.writeTextFile(changed, (await vault.readTextFile(changed)) + "\nMy own line.\n");

    const pushed = await bindAndSync(vault, { "Wiki/Existing.md": "# Existing\n" });

    expect(pushed).toContain(changed);
  });

  it("bound to an empty folder, sends everything, its starter structure included", async () => {
    const vault = await templateVault();
    const starters = await starterPaths(vault);

    const pushed = await bindAndSync(vault, {});

    expect([...pushed].sort()).toEqual([...starters, "My own note.md"].sort());
  });
});

describe("the one rule both shells call", () => {
  it("holds nothing back for an empty folder, and holds back where the listing could not be read", async () => {
    const vault = await templateVault();
    expect(folderHoldsNotes([])).toBe(false);
    expect(folderHoldsNotes([".plainva/sync/settings.json"])).toBe(false);
    expect(folderHoldsNotes(["a.md"])).toBe(true);
    expect(folderHoldsNotes(null)).toBe(true);
    expect((await starterFilesToHoldBack(vault, [])).size).toBe(0);
    const held = await starterFilesToHoldBack(vault, null);
    expect([...held.keys()].sort()).toEqual((await starterPaths(vault)).sort());
  });
});
