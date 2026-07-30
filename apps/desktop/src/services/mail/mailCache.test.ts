import { describe, expect, it, beforeEach } from "vitest";
import type { IDatabaseAdapter } from "@plainva/core";
import {
  cacheEnvelopes,
  cachedEnvelopes,
  cacheMessage,
  cachedMessage,
  forgetCachedMail,
  resetMailCache,
  type MailEnvelope,
  type MailMessage,
} from "@plainva/ui/mail";

/**
 * Offline mail cache (issue #34 wave 3: lifted from the mobile shell to the
 * shared seam, so the desktop reads the same rows through the same SQL).
 *
 * Driven against a tiny in-memory SQL stand-in rather than a real database: the
 * point of these tests is the CONTRACT — a cache miss is never an error, the
 * body table is bounded on write, and removing an account takes its rows with
 * it. The statements themselves are pinned by shape.
 */

interface Row {
  [k: string]: unknown;
}

/** Minimal adapter that records statements and serves the two tables it needs. */
function fakeDb() {
  const envelopes = new Map<string, Row>();
  const bodies = new Map<string, Row>();
  const statements: string[] = [];
  const db: IDatabaseAdapter = {
    execute: async (sql: string, params: unknown[] = []) => {
      statements.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("INSERT INTO mail_envelopes")) {
        const [account, mailbox, id, subject, sender, dateTs, seen, flagged, preview, threadId, messageId, inReplyTo, refs] =
          params as never[];
        envelopes.set(`${account}|${mailbox}|${id}`, {
          account, mailbox, id, subject, sender, date_ts: dateTs, seen, flagged, preview,
          thread_id: threadId, message_id: messageId, in_reply_to: inReplyTo, refs,
          cached_at: Date.now(),
        });
      }
      if (sql.includes("INSERT INTO mail_bodies")) {
        const [account, mailbox, id, payload] = params as never[];
        bodies.set(`${account}|${mailbox}|${id}`, { account, mailbox, id, payload });
      }
      if (sql.includes("DELETE FROM mail_envelopes WHERE account")) {
        for (const [k, v] of envelopes) if (v.account === params[0]) envelopes.delete(k);
      }
      if (sql.includes("DELETE FROM mail_bodies WHERE account")) {
        for (const [k, v] of bodies) if (v.account === params[0]) bodies.delete(k);
      }
      return { rowsAffected: 0 } as never;
    },
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM mail_envelopes")) {
        const [account, mailbox, limit] = params as [string, string, number];
        return [...envelopes.values()]
          .filter((r) => r.account === account && r.mailbox === mailbox)
          .sort((a, b) => (b.date_ts as number) - (a.date_ts as number))
          .slice(0, limit) as never;
      }
      if (sql.includes("FROM mail_bodies")) {
        const [account, mailbox, id] = params as [string, string, string];
        const hit = bodies.get(`${account}|${mailbox}|${id}`);
        return (hit ? [hit] : []) as never;
      }
      return [] as never;
    },
  } as unknown as IDatabaseAdapter;
  return { db, statements, bodies };
}

const env = (id: string, dateTs: number, over: Partial<MailEnvelope> = {}): MailEnvelope => ({
  id,
  subject: `Subject ${id}`,
  from: "someone@example.org",
  dateTs,
  seen: false,
  flagged: false,
  preview: "",
  ...over,
});

const msg = (id: string): MailMessage => ({ id, subject: "S", from: "a@b.c", dateTs: 1, text: "body" } as MailMessage);

beforeEach(() => resetMailCache());

describe("mail cache (shared)", () => {
  it("round-trips envelopes newest first and keeps the preview line", async () => {
    const { db } = fakeDb();
    await cacheEnvelopes(db, "acc1", "INBOX", [
      env("1", 1000, { preview: "hello", seen: true }),
      env("2", 3000, { flagged: true }),
    ]);
    const out = await cachedEnvelopes(db, "acc1", "INBOX", 50);
    expect(out.map((e) => e.id)).toEqual(["2", "1"]);
    expect(out[1]).toMatchObject({ preview: "hello", seen: true, flagged: false });
    expect(out[0]).toMatchObject({ flagged: true, seen: false });
  });

  /**
   * P9.1: the cache has to hand back the SAME thread identity it was given, or
   * an offline list would group differently from a fetched one — which is a
   * worse lie than not grouping at all. The chain goes in as a list and comes
   * back as a list, through the shared normaliser both ways.
   */
  it("round-trips thread identity, list and all", async () => {
    const { db } = fakeDb();
    await cacheEnvelopes(db, "acc1", "INBOX", [
      env("1", 1000, { messageId: "c@z.org", inReplyTo: "b@y.org", references: ["a@x.org", "b@y.org"] }),
      env("2", 2000, { threadId: "AAQkAD..." }),
    ]);
    const out = await cachedEnvelopes(db, "acc1", "INBOX", 50);
    expect(out[1]).toMatchObject({
      messageId: "c@z.org",
      inReplyTo: "b@y.org",
      references: ["a@x.org", "b@y.org"],
    });
    expect(out[0]).toMatchObject({ threadId: "AAQkAD..." });
  });

  it("leaves a row cached before P9.1 without thread fields, not with empty ones", async () => {
    // The migration defaults the columns to '', which must read as "unknown".
    // An empty message id would match every other row that has none.
    const { db } = fakeDb();
    await cacheEnvelopes(db, "acc1", "INBOX", [env("1", 1000)]);
    const [row] = await cachedEnvelopes(db, "acc1", "INBOX", 50);
    expect(row.messageId).toBeUndefined();
    expect(row.references).toBeUndefined();
    expect(row.threadId).toBeUndefined();
  });

  it("keeps mailboxes and accounts apart", async () => {
    const { db } = fakeDb();
    await cacheEnvelopes(db, "acc1", "INBOX", [env("1", 1)]);
    await cacheEnvelopes(db, "acc1", "Sent", [env("2", 1)]);
    await cacheEnvelopes(db, "acc2", "INBOX", [env("3", 1)]);
    expect((await cachedEnvelopes(db, "acc1", "INBOX", 50)).map((e) => e.id)).toEqual(["1"]);
    expect((await cachedEnvelopes(db, "acc1", "Sent", 50)).map((e) => e.id)).toEqual(["2"]);
    expect((await cachedEnvelopes(db, "acc2", "INBOX", 50)).map((e) => e.id)).toEqual(["3"]);
  });

  it("bounds the body table ON WRITE — a cache that only grows is the same bug as no cache", async () => {
    const { db, statements } = fakeDb();
    await cacheMessage(db, "acc1", "INBOX", msg("1"));
    expect(statements.some((s) => s.includes("DELETE FROM mail_bodies WHERE rowid NOT IN"))).toBe(true);
  });

  it("treats a corrupt body row as a miss, never an error", async () => {
    const { db, bodies } = fakeDb();
    await cacheMessage(db, "acc1", "INBOX", msg("1"));
    bodies.set("acc1|INBOX|1", { payload: "{not json" });
    await expect(cachedMessage(db, "acc1", "INBOX", "1")).resolves.toBeNull();
  });

  it("is inert without a database — no vault open is not an error", async () => {
    await expect(cachedEnvelopes(null, "acc1", "INBOX", 50)).resolves.toEqual([]);
    await expect(cachedMessage(undefined, "acc1", "INBOX", "1")).resolves.toBeNull();
    await expect(cacheEnvelopes(null, "acc1", "INBOX", [env("1", 1)])).resolves.toBeUndefined();
  });

  it("forgetting an account drops both its tables' rows", async () => {
    const { db } = fakeDb();
    await cacheEnvelopes(db, "acc1", "INBOX", [env("1", 1)]);
    await cacheMessage(db, "acc1", "INBOX", msg("1"));
    await cacheEnvelopes(db, "acc2", "INBOX", [env("9", 1)]);
    await forgetCachedMail(db, "acc1");
    expect(await cachedEnvelopes(db, "acc1", "INBOX", 50)).toEqual([]);
    expect(await cachedMessage(db, "acc1", "INBOX", "1")).toBeNull();
    expect((await cachedEnvelopes(db, "acc2", "INBOX", 50)).map((e) => e.id)).toEqual(["9"]);
  });

  it("prepares the schema once per database, not per call", async () => {
    const { db, statements } = fakeDb();
    await cacheEnvelopes(db, "acc1", "INBOX", [env("1", 1)]);
    const afterFirst = statements.filter((s) => s.startsWith("CREATE TABLE")).length;
    await cacheEnvelopes(db, "acc1", "INBOX", [env("2", 2)]);
    expect(statements.filter((s) => s.startsWith("CREATE TABLE")).length).toBe(afterFirst);
    expect(afterFirst).toBeGreaterThan(0);
  });
});
