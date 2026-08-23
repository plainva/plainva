import { describe, it, expect, vi } from "vitest";
import { cachedEnvelopes, cacheEnvelopes, cachedMessage } from "@plainva/ui/mail";
import type { IDatabaseAdapter } from "@plainva/core";

/**
 * The offline copy of a mailbox on a connection that may not write.
 *
 * An auxiliary window attaches the index READ-ONLY -- its capability withholds
 * `sql:allow-execute` -- so the cache's `CREATE TABLE` throws there. That throw
 * used to travel out of a caller that reads the cache BEFORE fetching, which
 * left the message list empty and silent while the folder tree, which never
 * touches the cache, looked healthy (maintainer finding 2026-08-23).
 *
 * The cache is a convenience. On a connection it cannot use it switches itself
 * off, exactly as if no database had been handed in.
 */
function readOnlyDb(): IDatabaseAdapter {
  return {
    execute: vi.fn(async () => {
      throw new Error("sql.execute not allowed on this window");
    }),
    query: vi.fn(async () => []),
  } as unknown as IDatabaseAdapter;
}

describe("mail cache on a read-only connection", () => {
  it("answers empty instead of throwing when it cannot create its tables", async () => {
    const db = readOnlyDb();
    await expect(cachedEnvelopes(db, "acct", "INBOX", 50)).resolves.toEqual([]);
    await expect(cachedMessage(db, "acct", "INBOX", "1")).resolves.toBeNull();
  });

  it("swallows a write on such a connection", async () => {
    const db = readOnlyDb();
    await expect(
      cacheEnvelopes(db, "acct", "INBOX", [{ id: "1", subject: "s", from: "a@b", date: 0, seen: false } as never]),
    ).resolves.toBeUndefined();
  });

  it("stops asking after the first refusal", async () => {
    // Otherwise every list, every body and every folder switch would fire a
    // failing CREATE TABLE at a connection that has already said no.
    const db = readOnlyDb();
    await cachedEnvelopes(db, "acct", "INBOX", 50);
    const calls = (db.execute as ReturnType<typeof vi.fn>).mock.calls.length;
    await cachedEnvelopes(db, "acct", "INBOX", 50);
    expect((db.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });

  it("still works normally where writing is allowed", async () => {
    const db = { execute: vi.fn(async () => {}), query: vi.fn(async () => []) } as unknown as IDatabaseAdapter;
    await expect(cachedEnvelopes(db, "acct", "INBOX", 50)).resolves.toEqual([]);
    expect(db.execute, "the schema is created on a writable connection").toHaveBeenCalled();
  });
});
