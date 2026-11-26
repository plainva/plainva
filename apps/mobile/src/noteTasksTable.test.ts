import { beforeEach, describe, expect, it, vi } from "vitest";
import { phoneSqlite, type PhonePlatform } from "../../../packages/core/test/helpers/phoneSqlitePlugin";
import { MemoryVaultAdapter } from "../../../packages/core/test/helpers/memoryVault";

/**
 * The list of every task on the phone answers from the index's task table
 * exactly what it answered when it scanned the text of every note — in every
 * state the table can be in (none, half filled in, rows of another reading,
 * notes a 0.9.0 device wrote in between), over the shipped adapter and the
 * stand-in of the native side (`phoneSqlitePlugin.ts`): reads take their
 * turns there, and the indexer's writes go through the transaction's handle.
 */

vi.mock("@capacitor-community/sqlite", async () => (await import("../../../packages/core/test/helpers/phoneSqlitePlugin")).phoneSqlite.module);

const { CapacitorSqliteAdapter } = await import("./adapters/CapacitorSqliteAdapter");
const { resetDatabasesForTests } = await import("./adapters/sqliteConnections");
const { initializeSchema, VaultIndexer } = await import("@plainva/core");
const { expectEveryMixAnswersAsTheScan, steppingClock, writeRandomNotes } = await import("../../../packages/core/test/helpers/taskListing");

const PLATFORMS: PhonePlatform[] = ["android", "ios"];

beforeEach(() => {
  resetDatabasesForTests();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("the list of every task on the phone", () => {
  it.each(PLATFORMS)("answers as the scan of every note did, whatever the task table holds (%s)", async (platform) => {
    expect.hasAssertions();
    phoneSqlite.reset(platform);
    const db = new CapacitorSqliteAdapter("plainva-tasks");
    await db.initialize();
    await initializeSchema(db);
    const files = new MemoryVaultAdapter(1_700_000_000_000);
    await writeRandomNotes(files, 51, 60);
    const indexer = new VaultIndexer(files, db, { monotonicNow: steppingClock() });
    await expectEveryMixAnswersAsTheScan(db, files, indexer);
    await db.close();
  });
});
