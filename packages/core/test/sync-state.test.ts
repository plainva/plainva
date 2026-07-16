import { describe, expect, it, beforeEach } from "vitest";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.ts";

describe("SyncStateRepository", () => {
  let db: MockDatabaseAdapter;
  let repo: SyncStateRepository;

  beforeEach(() => {
    db = new MockDatabaseAdapter();
    repo = new SyncStateRepository(db);
  });

  it("updateLocalHashAndBaseText executes correct upsert query", async () => {
    await repo.updateLocalHashAndBaseText("note.md", "hash123", "base text");
    expect(db.queries.length).toBe(1);
    expect(db.queries[0].query).toContain("INSERT INTO sync_state");
    expect(db.queries[0].query).toContain("ON CONFLICT(path) DO UPDATE SET local_sha256 = excluded.local_sha256, base_text = excluded.base_text");
    expect(db.queries[0].params).toEqual(["note.md", "hash123", "base text"]);
  });

  it("updateLocalHashAndBaseTextGuarded advances base_text unconditionally but guards local_sha256 (P1)", async () => {
    await repo.updateLocalHashAndBaseTextGuarded("note.md", "pushedSha", "pushed text", "expectedSha");
    expect(db.queries.length).toBe(1);
    const q = db.queries[0];
    expect(q.query).toContain("INSERT INTO sync_state");
    // base_text always adopts the pushed content (the new common ancestor)…
    expect(q.query).toContain("base_text = excluded.base_text");
    // …while local_sha256 only advances when still at the expected marker or unset:
    // a save landing during the upload keeps its newer hash.
    expect(q.query).toMatch(
      /local_sha256 = CASE\s+WHEN sync_state\.local_sha256 IS NULL OR sync_state\.local_sha256 = \? THEN excluded\.local_sha256\s+ELSE sync_state\.local_sha256\s+END/
    );
    expect(q.params).toEqual(["note.md", "pushedSha", "pushed text", "expectedSha"]);
  });

  it("updateLocalHashGuarded guards local_sha256 and never touches the base (P1)", async () => {
    await repo.updateLocalHashGuarded("img.png", "pushedSha", null);
    expect(db.queries.length).toBe(1);
    const q = db.queries[0];
    expect(q.query).toContain("INSERT INTO sync_state");
    expect(q.query).not.toContain("base_text");
    expect(q.query).toMatch(
      /local_sha256 = CASE\s+WHEN sync_state\.local_sha256 IS NULL OR sync_state\.local_sha256 = \? THEN excluded\.local_sha256\s+ELSE sync_state\.local_sha256\s+END/
    );
    expect(q.params).toEqual(["img.png", "pushedSha", null]);
  });

  it("deleteSyncState executes delete query", async () => {
    await repo.deleteSyncState("note.md");
    expect(db.queries.length).toBe(1);
    expect(db.queries[0].query).toBe("DELETE FROM sync_state WHERE path = ?");
    expect(db.queries[0].params).toEqual(["note.md"]);
  });

  it("setPendingPushSha upserts the push-journal entry (2026-07-16)", async () => {
    await repo.setPendingPushSha("note.md", "sha-p1");
    expect(db.queries.length).toBe(1);
    const q = db.queries[0];
    expect(q.query).toContain("INSERT INTO sync_state (path, pending_push_sha)");
    expect(q.query).toContain("ON CONFLICT(path) DO UPDATE SET pending_push_sha = excluded.pending_push_sha");
    expect(q.params).toEqual(["note.md", "sha-p1"]);
  });

  it("clearPendingPushSha nulls the journal entry without touching other columns", async () => {
    await repo.clearPendingPushSha("note.md");
    expect(db.queries.length).toBe(1);
    expect(db.queries[0].query).toBe("UPDATE sync_state SET pending_push_sha = NULL WHERE path = ?");
    expect(db.queries[0].params).toEqual(["note.md"]);
  });

  it("updateBaseText advances ONLY the merge base text (echo adoption)", async () => {
    await repo.updateBaseText("note.md", "echo content");
    expect(db.queries.length).toBe(1);
    const q = db.queries[0];
    expect(q.query).toContain("INSERT INTO sync_state (path, base_text)");
    expect(q.query).toContain("ON CONFLICT(path) DO UPDATE SET base_text = excluded.base_text");
    expect(q.query).not.toContain("local_sha256");
    expect(q.params).toEqual(["note.md", "echo content"]);
  });

  it("getAllStates loads pending_push_sha into the per-cycle snapshot", async () => {
    await repo.getAllStates();
    expect(db.queries[0].query).toContain("pending_push_sha");
  });

  it("updateRemoteState upserts remote state even without an existing row", async () => {
    await repo.updateRemoteState("note.md", "etag", "id", 100);
    expect(db.queries.length).toBe(1);
    expect(db.queries[0].query).toContain("INSERT INTO sync_state");
    expect(db.queries[0].query).toContain("ON CONFLICT(path) DO UPDATE");
    expect(db.queries[0].params).toEqual(["note.md", "etag", "id", 100]);
  });

  it("updateBaseState upserts base state even without an existing row", async () => {
    await repo.updateBaseState("note.md", "basehash", "baseetag");
    expect(db.queries.length).toBe(1);
    expect(db.queries[0].query).toContain("INSERT INTO sync_state");
    expect(db.queries[0].query).toContain("ON CONFLICT(path) DO UPDATE");
    expect(db.queries[0].params).toEqual(["note.md", "basehash", "baseetag"]);
  });

  it("updateLocalHash updates only local_sha256 and preserves the base", async () => {
    await repo.updateLocalHash("note.md", "localhash");
    expect(db.queries.length).toBe(1);
    expect(db.queries[0].query).toContain("INSERT INTO sync_state");
    expect(db.queries[0].query).toContain("local_sha256 = excluded.local_sha256");
    expect(db.queries[0].query).not.toContain("base_text");
    expect(db.queries[0].params).toEqual(["note.md", "localhash"]);
  });

  it("getAllPaths returns the persisted paths", async () => {
    db.mockedResults = [[{ path: "a.md" }, { path: "sub/b.md" }]];
    const paths = await repo.getAllPaths();
    expect(db.queries[0].query).toContain("SELECT path FROM sync_state");
    expect(paths).toEqual(["a.md", "sub/b.md"]);
  });

  it("getRemoteId returns the recorded remote id or null", async () => {
    db.mockedResults = [[{ remote_id: "drive-file-123" }]];
    const id = await repo.getRemoteId("note.md");
    expect(db.queries[0].query).toContain("SELECT remote_id FROM sync_state WHERE path = ?");
    expect(db.queries[0].params).toEqual(["note.md"]);
    expect(id).toBe("drive-file-123");

    db.queries = [];
    db.mockedResults = [[]];
    expect(await repo.getRemoteId("missing.md")).toBeNull();
  });

  it("getPathByRemoteId resolves a path from a remote id or null", async () => {
    db.mockedResults = [[{ path: "sub/note.md" }]];
    const path = await repo.getPathByRemoteId("drive-file-123");
    expect(db.queries[0].query).toContain("SELECT path FROM sync_state WHERE remote_id = ?");
    expect(db.queries[0].params).toEqual(["drive-file-123"]);
    expect(path).toBe("sub/note.md");

    db.queries = [];
    db.mockedResults = [[]];
    expect(await repo.getPathByRemoteId("unknown-id")).toBeNull();
  });
});
