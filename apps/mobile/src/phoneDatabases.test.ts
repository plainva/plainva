import { beforeEach, describe, expect, it, vi } from "vitest";
import { phoneSqlite, type PhonePlatform } from "../../../packages/core/test/helpers/phoneSqlitePlugin";

/**
 * Opening a second database leaves the first one open (device finding
 * 2026-10-28, TestFlight 148).
 *
 * The connect wizard's files step opens the new vault's index while the vault
 * it started in is active. Every adapter made its own `SQLiteConnection` and
 * asked it `checkConnectionsConsistency()` first; a fresh object knows of no
 * connection, and the plugin answers an empty list on iOS and Android by
 * closing every database. The active vault's next query failed - "Query:
 * Connection to plainva-… not available" on the iPhone - and the wizard stood
 * at step 1 with that sentence. Deleting a vault, which reads the deleted
 * vault's index, did the same to the active one.
 *
 * What runs is the shipped adapter; the plugin's two connection lists are
 * stood in for as its sources describe them (`phoneSqlitePlugin.ts`).
 */

vi.mock("@capacitor-community/sqlite", async () => (await import("../../../packages/core/test/helpers/phoneSqlitePlugin")).phoneSqlite.module);

const { CapacitorSqliteAdapter } = await import("./adapters/CapacitorSqliteAdapter");
const { resetDatabasesForTests } = await import("./adapters/sqliteConnections");

const PLATFORMS: PhonePlatform[] = ["android", "ios"];

beforeEach(() => {
  phoneSqlite.reset();
  resetDatabasesForTests();
});

async function opened(name: string) {
  const db = new CapacitorSqliteAdapter(name);
  await db.initialize();
  return db;
}

describe("the phone's databases", () => {
  it.each(PLATFORMS)("opening a second vault's index keeps the active one open (%s)", async (platform) => {
    phoneSqlite.as(platform);
    const active = await opened("plainva-active");
    await active.execute("CREATE TABLE t (k TEXT)");
    await active.execute("INSERT INTO t (k) VALUES ('kept')");

    const prepared = await opened("plainva-new");
    await prepared.execute("CREATE TABLE u (k TEXT)");

    expect(await active.query<{ k: string }>("SELECT k FROM t")).toEqual([{ k: "kept" }]);
    await prepared.close();
    expect(phoneSqlite.isOpen("plainva-active")).toBe(true);
    expect(await active.query<{ k: string }>("SELECT k FROM t")).toEqual([{ k: "kept" }]);
  });

  it.each(PLATFORMS)("one name opened twice is one connection, closed with its last user (%s)", async (platform) => {
    phoneSqlite.as(platform);
    const first = await opened("plainva-x");
    const second = await opened("plainva-x");
    await first.execute("CREATE TABLE t (k TEXT)");
    await second.close();
    expect(phoneSqlite.isOpen("plainva-x")).toBe(true);
    expect(await first.query("SELECT k FROM t")).toEqual([]);
    await first.close();
    expect(phoneSqlite.isOpen("plainva-x")).toBe(false);
    // And it opens again afterwards.
    const again = await opened("plainva-x");
    expect(await again.query("SELECT k FROM t")).toEqual([]);
  });

  it("the wizard names a failure of the device's database as such, not as the provider's answer", async () => {
    const { serviceConnectionMessage } = await import("@plainva/ui");
    const t = (key: string) => key;
    expect(serviceConnectionMessage(new Error("Query: Connection to plainva-45e9259f not available"), t)).toBe("connection.deviceStorageFailed");
    expect(serviceConnectionMessage(new Error("No available connection for database plainva-x"), t)).toBe("connection.deviceStorageFailed");
    expect(serviceConnectionMessage(new Error("error returned from database: (code: 5) database is locked"), t)).toBe("connection.deviceStorageFailed");
    expect(serviceConnectionMessage(new Error("access_denied: the app is not verified"), t)).toBe("connection.providerResponse");
  });

  it.each(PLATFORMS)("a connection left open by an earlier lifetime of the web view does not block the open (%s)", async (platform) => {
    phoneSqlite.as(platform);
    const earlier = new phoneSqlite.module.SQLiteConnection();
    const stale = await earlier.createConnection("plainva-index");
    await stale.open();

    const db = await opened("plainva-index");
    await db.execute("CREATE TABLE IF NOT EXISTS t (k TEXT)");
    expect(phoneSqlite.isOpen("plainva-index")).toBe(true);
  });
});
