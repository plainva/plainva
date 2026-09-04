import { describe, expect, it } from "vitest";
import { MemoryWorkspaceStateStore, SqlWorkspaceStateStore } from "../src/workspace/state.js";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.js";

/** A compared fork leaves the list (C36) - on both store implementations. */
describe("local forks can be forgotten", () => {
  const record = { forkId: "f1", originalPath: "Notes/A.md", forkPath: ".plainva/workspace/forks/f1-A.md", reason: "permission-denied" as const, createdAt: "2026-09-04T10:00:00.000Z" };

  it("in memory", async () => {
    const store = new MemoryWorkspaceStateStore();
    await store.saveLocalFork(record);
    expect(await store.listLocalForks()).toHaveLength(1);
    await store.deleteLocalFork("f1");
    expect(await store.listLocalForks()).toEqual([]);
  });

  it("in sql", async () => {
    const db = new MockDatabaseAdapter();
    const store = new SqlWorkspaceStateStore(db);
    await store.deleteLocalFork("f1");
    expect(db.queries.at(-1)).toEqual({ query: "DELETE FROM workspace_local_fork WHERE fork_id = ?", params: ["f1"] });
  });
});
