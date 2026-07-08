import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { BackupVaultAdapter } from "../src/vault/BackupVaultAdapter.ts";
import { ConflictAwareVaultAdapter, ConflictError } from "../src/vault/ConflictAwareVaultAdapter.ts";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.ts";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

async function sha256Hash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("ConflictAwareVaultAdapter", () => {
  let tmpDir: string;
  let db: MockDatabaseAdapter;
  let syncRepo: SyncStateRepository;
  let adapter: ConflictAwareVaultAdapter;
  let backupAdapter: BackupVaultAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-conflict-"));
    const localAdapter = new LocalVaultAdapter(tmpDir);
    await localAdapter.initialize();
    
    backupAdapter = new BackupVaultAdapter(localAdapter);
    
    db = new MockDatabaseAdapter();
    syncRepo = new SyncStateRepository(db);

    adapter = new ConflictAwareVaultAdapter(backupAdapter, syncRepo);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes file normally if no conflict", async () => {
    await adapter.writeTextFile("test.md", "hello");
    expect(await adapter.readTextFile("test.md")).toBe("hello");
  });

  it("automatically merges disjoint changes", async () => {
    // 1. Initial state (base)
    const baseText = "Line 1\n\nLine 2\n\nLine 3";
    await adapter.writeTextFile("test.md", baseText); 
    
    const baseHash = await sha256Hash(baseText);
    
    // 2. External modification (simulate someone writing directly to disk without updating sync_state)
    const externalText = "Line 1\n\nLine 2 (external)\n\nLine 3";
    await fs.writeFile(path.join(tmpDir, "test.md"), externalText);

    // 3. Local user saves a different line
    const localText = "Line 1 (local)\n\nLine 2\n\nLine 3";
    
    // Mock the sync state and fts_notes as if it was indexed
    db.mockedResults.push([{ path: "test.md", local_sha256: baseHash }]);
    db.mockedResults.push([{ base_text: baseText }]);

    // Attempt to write
    await adapter.writeTextFile("test.md", localText);

    // 4. Verify merge
    const merged = await adapter.readTextFile("test.md");
    expect(merged).toBe("Line 1 (local)\n\nLine 2 (external)\n\nLine 3");
  });

  it("throws ConflictError on unresolvable conflicts", async () => {
    const baseText = "Line 1\nLine 2\nLine 3";
    await adapter.writeTextFile("test.md", baseText);
    const baseHash = await sha256Hash(baseText);

    const externalText = "Line 1\nLine 2 (external)\nLine 3";
    await fs.writeFile(path.join(tmpDir, "test.md"), externalText);

    const localText = "Line 1\nLine 2 (local)\nLine 3"; // Conflict on line 2!
    
    db.mockedResults.push([{ path: "test.md", local_sha256: baseHash }]);
    db.mockedResults.push([{ base_text: baseText }]);

    await expect(adapter.writeTextFile("test.md", localText)).rejects.toThrow(ConflictError);

    // Verify CONFLICT file was created
    const files = await fs.readdir(tmpDir);
    const conflictFile = files.find(f => f.startsWith("test.CONFLICT-") && f.endsWith(".md"));
    expect(conflictFile).toBeDefined();

    if (conflictFile) {
      const conflictContent = await fs.readFile(path.join(tmpDir, conflictFile), "utf-8");
      expect(conflictContent).toBe(localText);
    }

    // Verify original file is untouched
    const diskContent = await fs.readFile(path.join(tmpDir, "test.md"), "utf-8");
    expect(diskContent).toBe(externalText);
  });

  it("uses an empty base text instead of treating it as missing", async () => {
    expect.assertions(2);
    const baseText = "";
    await adapter.writeTextFile("empty-base.md", baseText);
    const baseHash = await sha256Hash(baseText);

    await fs.writeFile(path.join(tmpDir, "empty-base.md"), "external");

    db.mockedResults.push([{ path: "empty-base.md", local_sha256: baseHash }]);
    db.mockedResults.push([{ base_text: baseText }]);

    try {
      await adapter.writeTextFile("empty-base.md", "local");
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as Error).message).not.toContain("base version not found");
    }
  });

  it("invokes onAutoMerge with the merged content on a clean auto-merge", async () => {
    const calls: Array<{ path: string; mergedText: string }> = [];
    const mergeAdapter = new ConflictAwareVaultAdapter(backupAdapter, syncRepo, (p, m) => {
      calls.push({ path: p, mergedText: m });
    });

    const baseText = "Line 1\n\nLine 2\n\nLine 3";
    await mergeAdapter.writeTextFile("cb.md", baseText); // new file -> normal write, must NOT fire callback
    expect(calls).toHaveLength(0);

    const baseHash = await sha256Hash(baseText);
    await fs.writeFile(path.join(tmpDir, "cb.md"), "Line 1\n\nLine 2 (external)\n\nLine 3");

    db.mockedResults.push([{ path: "cb.md", local_sha256: baseHash }]);
    db.mockedResults.push([{ base_text: baseText }]);

    await mergeAdapter.writeTextFile("cb.md", "Line 1 (local)\n\nLine 2\n\nLine 3");

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("cb.md");
    expect(calls[0].mergedText).toBe("Line 1 (local)\n\nLine 2 (external)\n\nLine 3");
    // The merged content is what is now on disk, so the in-memory view must match it.
    expect(await mergeAdapter.readTextFile("cb.md")).toBe(calls[0].mergedText);
  });

  it("does not invoke onAutoMerge when the merge has conflicts", async () => {
    const calls: string[] = [];
    const mergeAdapter = new ConflictAwareVaultAdapter(backupAdapter, syncRepo, (p) => calls.push(p));

    const baseText = "Line 1\nLine 2\nLine 3";
    await mergeAdapter.writeTextFile("cf.md", baseText);
    const baseHash = await sha256Hash(baseText);
    await fs.writeFile(path.join(tmpDir, "cf.md"), "Line 1\nLine 2 (external)\nLine 3");

    db.mockedResults.push([{ path: "cf.md", local_sha256: baseHash }]);
    db.mockedResults.push([{ base_text: baseText }]);

    await expect(
      mergeAdapter.writeTextFile("cf.md", "Line 1\nLine 2 (local)\nLine 3")
    ).rejects.toThrow(ConflictError);
    expect(calls).toHaveLength(0);
  });

  it("self-heals a legacy byte-hash for text files instead of conflicting", async () => {
    // Reproduces the .base conflict bug: the index stored a BYTE hash (sha256 of the raw
    // bytes) for a text file, but the write path hashes the decoded text. Here readTextFile
    // and readBinaryFile deliberately disagree (as Tauri's can), so the stored byte hash
    // differs from the text hash even though the file is unchanged. The write must adopt
    // the file (and record a text hash + base) rather than create a .CONFLICT.
    const byteSha = async (b: Uint8Array) => {
      const buf = await globalThis.crypto.subtle.digest("SHA-256", b as BufferSource);
      return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, "0")).join("");
    };
    const diskBytes = new Uint8Array([1, 2, 3, 4]);
    const byteHash = await byteSha(diskBytes);

    const written: Array<[string, string]> = [];
    const inner = {
      async exists() { return true; },
      async readTextFile() { return "name: db\n"; },     // text view
      async readBinaryFile() { return diskBytes; },        // raw bytes (different)
      async writeTextFile(p: string, c: string) { written.push([p, c]); },
      async listDir() { return []; },
    };
    const states = new Map<string, any>([["x.base", { local_sha256: byteHash, base_text: null }]]);
    const repo = {
      async getSyncState(p: string) { return states.get(p) ?? null; },
      async getBaseText(p: string) { return states.get(p)?.base_text ?? null; },
      async updateLocalHash() {},
      async updateLocalHashAndBaseText(p: string, h: string, t: string) { states.set(p, { local_sha256: h, base_text: t }); },
    };
    const healAdapter = new ConflictAwareVaultAdapter(inner as any, repo as any);

    await healAdapter.writeTextFile("x.base", "name: db\nviews: []\n");

    expect(written.some(([p]) => p.includes(".CONFLICT-"))).toBe(false);
    expect(written).toContainEqual(["x.base", "name: db\nviews: []\n"]);
    expect(states.get("x.base").base_text).toBe("name: db\nviews: []\n");
  });

  it("serializes overlapping writes to the same path (no spurious conflict)", async () => {
    // The `.base` viewer fires many rapid writes to one file. Without per-path
    // serialization, an in-flight write would be misread as an external change and a
    // spurious .CONFLICT created. This drives two overlapping writes through a stateful
    // in-memory vault + sync repo and asserts they run strictly one-after-another.
    const tick = () => new Promise((r) => setTimeout(r, 0));

    const reads: string[] = [];
    const store = new Map<string, string>();
    const vault = {
      async exists(p: string) { return store.has(p); },
      async readTextFile(p: string) { const c = store.get(p) ?? ""; reads.push(c); await tick(); return c; },
      async writeTextFile(p: string, c: string) { await tick(); store.set(p, c); },
      async listDir() { return []; },
    };

    const states = new Map<string, { local_sha256: string | null; base_text: string | null }>();
    const repo = {
      async getSyncState(p: string) { return states.get(p) ?? null; },
      async getBaseText(p: string) { return states.get(p)?.base_text ?? null; },
      async updateLocalHash(p: string, h: string) {
        await tick(); // widen the race window so a missing lock would interleave
        const s = states.get(p) ?? { local_sha256: null, base_text: null };
        s.local_sha256 = h; states.set(p, s);
      },
      async updateLocalHashAndBaseText(p: string, h: string, txt: string) {
        states.set(p, { local_sha256: h, base_text: txt });
      },
    };

    const adapter = new ConflictAwareVaultAdapter(vault as any, repo as any);

    // Seed an existing file whose recorded hash matches disk (no pending external change).
    store.set("db.base", "v0");
    await repo.updateLocalHashAndBaseText("db.base", await sha256Hash("v0"), "v0");

    reads.length = 0;
    await Promise.all([
      adapter.writeTextFile("db.base", "v1"),
      adapter.writeTextFile("db.base", "v2"),
    ]);

    // No conflict copy was created and the last write wins.
    expect([...store.keys()].some((k) => k.includes(".CONFLICT-"))).toBe(false);
    expect(store.get("db.base")).toBe("v2");
    // Serialized: the second write observed the first write's result on disk.
    expect(reads).toEqual(["v0", "v1"]);
  });
});
