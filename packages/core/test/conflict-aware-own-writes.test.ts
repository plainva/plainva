import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { ConflictAwareVaultAdapter, ConflictError } from "../src/vault/ConflictAwareVaultAdapter.ts";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.ts";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/**
 * TestFlight feedback Build 91, P1 (decision E2: measure the window first).
 * The first case is the measurement: an adapter that does NOT remember its
 * own writes turns a stale sync_state row into a `.CONFLICT` copy on the
 * second save of a brand-new note. The second case is the fix.
 */
describe("ConflictAwareVaultAdapter — the disk holding our own content is never a conflict", () => {
  let tmpDir: string;
  let inner: LocalVaultAdapter;
  let db: MockDatabaseAdapter;
  let repo: SyncStateRepository;

  const staleRow = { path: "Inbox/Notiz 1.md", local_sha256: "hash-of-the-deleted-note", base_text: "# Notiz 1\n\nalt" };
  const conflictFiles = async () => (await fs.readdir(path.join(tmpDir, "Inbox"))).filter((f) => f.includes(".CONFLICT-"));

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-own-writes-"));
    inner = new LocalVaultAdapter(tmpDir);
    await inner.initialize();
    db = new MockDatabaseAdapter();
    repo = new SyncStateRepository(db);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("measurement: a second adapter instance (no memory of the first write) conflicts on the stale row", async () => {
    const first = new ConflictAwareVaultAdapter(inner, repo);
    await first.writeTextFile("Inbox/Notiz 1.md", "# Notiz 1\n\nneu");

    const second = new ConflictAwareVaultAdapter(inner, repo);
    db.mockedResults.push([staleRow]); // getSyncState
    db.mockedResults.push([{ base_text: staleRow.base_text }]); // getBaseText -> hash mismatch -> no base
    await expect(second.writeTextFile("Inbox/Notiz 1.md", "# Notiz 1\n\nneu, weiter getippt")).rejects.toThrow(ConflictError);
    expect(await conflictFiles()).toHaveLength(1);
  });

  it("fix: the adapter that wrote the file adopts it despite the stale row and records the new hash", async () => {
    const adapter = new ConflictAwareVaultAdapter(inner, repo);
    await adapter.writeTextFile("Inbox/Notiz 1.md", "# Notiz 1\n\nneu");

    db.mockedResults.push([staleRow]); // getSyncState: the deleted note's row
    await adapter.writeTextFile("Inbox/Notiz 1.md", "# Notiz 1\n\nneu, weiter getippt");

    expect(await conflictFiles()).toHaveLength(0);
    expect(await inner.readTextFile("Inbox/Notiz 1.md")).toBe("# Notiz 1\n\nneu, weiter getippt");
    const update = db.queries.find((q) => /sync_state/i.test(q.query) && /local_sha256/.test(q.query));
    expect(update).toBeDefined();
    expect((update!.params as any[])).not.toContain("hash-of-the-deleted-note");
  });

  it("a genuinely foreign change is still a conflict even for a path we wrote before", async () => {
    const adapter = new ConflictAwareVaultAdapter(inner, repo);
    await adapter.writeTextFile("Inbox/Notiz 1.md", "# Notiz 1\n\nneu");
    await fs.writeFile(path.join(tmpDir, "Inbox/Notiz 1.md"), "# Notiz 1\n\nvon SyncTrain überschrieben");

    db.mockedResults.push([staleRow]);
    db.mockedResults.push([{ base_text: staleRow.base_text }]);
    await expect(adapter.writeTextFile("Inbox/Notiz 1.md", "# Notiz 1\n\nneu, weiter getippt")).rejects.toThrow(ConflictError);
    expect(await conflictFiles()).toHaveLength(1);
  });

  it("wasWrittenByUs answers for the last write only", async () => {
    const adapter = new ConflictAwareVaultAdapter(inner, repo);
    await adapter.writeTextFile("a.md", "one");
    const sha = async (t: string) =>
      Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    expect(adapter.wasWrittenByUs("a.md", await sha("one"))).toBe(true);
    expect(adapter.wasWrittenByUs("a.md", await sha("two"))).toBe(false);
    expect(adapter.wasWrittenByUs("b.md", await sha("one"))).toBe(false);
  });
});
