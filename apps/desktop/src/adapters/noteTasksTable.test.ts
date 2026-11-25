import { beforeEach, describe, expect, it, vi } from "vitest";
import { desktopSqlite } from "../../../../packages/core/test/helpers/desktopSqlite";
import { MemoryVaultAdapter } from "../../../../packages/core/test/helpers/memoryVault";

/**
 * The list of every task on the desktop answers from the index's task table
 * exactly what it answered when it scanned the text of every note — in every
 * state the table can be in (none, half filled in, rows of another reading,
 * notes a 0.9.0 device wrote in between), over the shipped adapter and the
 * stand-in of the native side (`desktopSqlite.ts`: the plugin's pool, the
 * batch and transaction commands, a real SQLite file in WAL mode).
 */

vi.mock("@tauri-apps/plugin-sql", async () => (await import("../../../../packages/core/test/helpers/desktopSqlite")).desktopSqlite.module.sql);
vi.mock("@tauri-apps/api/core", async () => ({
  invoke: (await import("../../../../packages/core/test/helpers/desktopSqlite")).desktopSqlite.module.invoke,
}));

const { TauriDatabaseAdapter } = await import("./TauriDatabaseAdapter");
const { initializeSchema, VaultIndexer } = await import("@plainva/core");
const { expectEveryMixAnswersAsTheScan, steppingClock, writeRandomNotes } = await import("../../../../packages/core/test/helpers/taskListing");

beforeEach(() => {
  desktopSqlite.reset();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("the list of every task on the desktop", () => {
  it("answers as the scan of every note did, whatever the task table holds", async () => {
    expect.hasAssertions();
    const db = new TauriDatabaseAdapter("sqlite:index.db");
    await db.initialize();
    await initializeSchema(db);
    const files = new MemoryVaultAdapter(1_700_000_000_000);
    await writeRandomNotes(files, 52, 60);
    const indexer = new VaultIndexer(files, db, { monotonicNow: steppingClock() });
    await expectEveryMixAnswersAsTheScan(db, files, indexer);
  });
});
