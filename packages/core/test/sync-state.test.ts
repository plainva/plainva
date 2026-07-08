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

  it("deleteSyncState executes delete query", async () => {
    await repo.deleteSyncState("note.md");
    expect(db.queries.length).toBe(1);
    expect(db.queries[0].query).toBe("DELETE FROM sync_state WHERE path = ?");
    expect(db.queries[0].params).toEqual(["note.md"]);
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
