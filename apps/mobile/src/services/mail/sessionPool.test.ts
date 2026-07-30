import { describe, expect, it } from "vitest";
import { SessionPool, accountMarker, sessionKey } from "@plainva/ui/mail";

/**
 * P7.3: the phone's socket transport reuses one IMAP connection per account, the
 * same policy the desktop's Rust pool has (P7.2). These are the same nine cases
 * as `mail_pool::tests` — kept side by side on purpose: if one platform's policy
 * drifts, the other one's test suite stops matching it, and a mail transport that
 * hands out a half-consumed connection returns the wrong body under the right
 * subject.
 */

interface Fake {
  id: number;
  healthy: boolean;
}

function harness(ttlMs = 120_000) {
  const log = { opened: [] as number[], closed: [] as number[], probed: [] as number[] };
  let nextId = 0;
  let clock = 0;
  let openHealthy = true;
  const pool = new SessionPool<Fake>(
    {
      healthy: async (conn) => {
        log.probed.push(conn.id);
        return conn.healthy;
      },
      close: async (conn) => {
        log.closed.push(conn.id);
      },
      now: () => clock,
    },
    ttlMs,
  );
  const open = async (): Promise<Fake> => {
    nextId += 1;
    const conn = { id: nextId, healthy: openHealthy };
    log.opened.push(conn.id);
    return conn;
  };
  return {
    pool,
    log,
    open,
    tick: (ms: number) => {
      clock += ms;
    },
    setOpenHealthy: (value: boolean) => {
      openHealthy = value;
    },
    run: (key: string, fn: (conn: Fake) => Promise<number>) => pool.with(key, open, fn),
    ok: (key: string) => pool.with(key, open, async (conn) => conn.id),
  };
}

describe("mail session pool (P7.3)", () => {
  it("five actions on one account produce a single login", async () => {
    const h = harness();
    const ids: number[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await h.ok("acct"));
    expect(ids).toEqual([1, 1, 1, 1, 1]);
    expect(h.log.opened).toEqual([1]);
    expect(h.log.closed).toEqual([]);
    // Probed on every reuse — never blindly handed out.
    expect(h.log.probed).toEqual([1, 1, 1, 1]);
  });

  it("retires the connection when an operation fails", async () => {
    const h = harness();
    expect(await h.ok("acct")).toBe(1);
    await expect(
      h.run("acct", async () => {
        throw new Error("fetch failed");
      }),
    ).rejects.toThrow("fetch failed");
    expect(h.pool.size).toBe(0);
    expect(await h.ok("acct")).toBe(2);
    expect(h.log.closed).toEqual([1]);
  });

  it("closes an idle connection past the TTL instead of reusing it", async () => {
    const h = harness(30);
    expect(await h.ok("acct")).toBe(1);
    h.tick(31);
    expect(await h.ok("acct")).toBe(2);
    expect(h.log.closed).toEqual([1]);
    // An expired connection is dropped WITHOUT spending a round trip on it.
    expect(h.log.probed).toEqual([]);
  });

  it("replaces a connection whose probe fails", async () => {
    const h = harness();
    h.setOpenHealthy(false);
    expect(await h.ok("acct")).toBe(1);
    expect(await h.ok("acct")).toBe(2);
    expect(h.log.probed).toEqual([1]);
    expect(h.log.closed).toEqual([1]);
  });

  it("keeps one connection per account", async () => {
    const h = harness();
    expect(await h.ok("a")).toBe(1);
    expect(await h.ok("b")).toBe(2);
    expect(await h.ok("a")).toBe(1);
    expect(await h.ok("b")).toBe(2);
    expect(h.pool.size).toBe(2);
    expect(h.log.closed).toEqual([]);
  });

  it("never lets two overlapping operations share one connection", async () => {
    const h = harness();
    expect(await h.ok("acct")).toBe(1);
    // IMAP cannot interleave commands, so the inner call must open its own.
    const outer = await h.run("acct", async (conn) => {
      const inner = await h.ok("acct");
      expect(inner).not.toBe(conn.id);
      return conn.id;
    });
    expect(outer).toBe(1);
    expect(h.pool.size).toBe(1);
    expect(h.log.closed).toHaveLength(1);
  });

  it("releases one account, then everything", async () => {
    const h = harness();
    const creds = (user: string) => ({ host: "mail.example", port: 993, user, pass: "pw" });
    await h.ok(sessionKey(creds("ada")));
    await h.ok(sessionKey(creds("bob")));
    // The desktop pool shipped a bug here: a PREFIX match released nothing, and
    // "nada" must not be caught by releasing "ada".
    await h.ok(sessionKey(creds("nada")));
    await h.pool.release(accountMarker("ada"));
    expect(h.log.closed).toHaveLength(1);
    expect(h.pool.size).toBe(2);
    // No marker = everything, which is what the phone does on going to the background.
    await h.pool.release();
    expect(h.pool.size).toBe(0);
    expect(h.log.closed).toHaveLength(3);
    // A released account opens a fresh connection on its next operation — the
    // pool must not hand out an id it already closed.
    const reopened = await h.ok(sessionKey(creds("ada")));
    expect(h.log.closed).not.toContain(reopened);
  });

  it("does not reuse a session after the password changed", async () => {
    const base = { host: "mail.example", port: 993, user: "ada" };
    const old = sessionKey({ ...base, pass: "old-pw" });
    const fresh = sessionKey({ ...base, pass: "new-pw" });
    expect(old).not.toBe(fresh);
    expect(old).not.toContain("old-pw");
    const marker = accountMarker("ada");
    expect(old).toContain(marker);
    expect(fresh).toContain(marker);
    const h = harness();
    await h.ok(old);
    expect(await h.ok(fresh)).toBe(2);
  });

  it("separates hosts, ports and users", () => {
    const base = sessionKey({ host: "mail.example", port: 993, user: "ada", pass: "pw" });
    expect(base).not.toBe(sessionKey({ host: "other.example", port: 993, user: "ada", pass: "pw" }));
    expect(base).not.toBe(sessionKey({ host: "mail.example", port: 143, user: "ada", pass: "pw" }));
    expect(base).not.toBe(sessionKey({ host: "mail.example", port: 993, user: "bob", pass: "pw" }));
  });
});
