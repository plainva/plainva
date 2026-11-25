import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PimWorker } from "../src/pim/PimWorker.ts";
import { PimCacheRepository } from "../src/pim/PimCacheRepository.ts";
import { CalDavPimTarget } from "../src/pim/CalDavPimTarget.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";

/**
 * Review 2026-11-18, O4: the calendar and task worker sends this device's
 * password only to this device's own address, whatever the shared document
 * names. The shells build the target from the device's own sign-in; this test
 * runs the REAL worker with the REAL CalDAV client on such a target and a row
 * whose document names another address — in `url`, and as the latest
 * confirmed access of another device — and records every request at the
 * network. Any way inside the core that took the document's address instead
 * (a fallback, a retry elsewhere, a move) makes it red.
 */

const { DatabaseSync } = (await import("node:sqlite")) as any;

class NodeSqliteAdapter implements IDatabaseAdapter {
  constructor(private db: any) {}
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = this.db.prepare(sql).all(...(params as never[])) as T[];
    return rows[0] ?? null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

const OWN = "https://cloud.example.com/remote.php/dav";
const OTHERS = ["https://evil.example/remote.php/dav", "http://192.168.1.5/remote.php/dav"];

describe("the calendar and task worker sends the password only to this device's own address", () => {
  let cache: PimCacheRepository;
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(async () => {
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
  });

  const answers: Array<[string, () => Promise<Response>]> = [
    ["a certificate failure", async () => { throw new TypeError("fetch failed: unable to verify the first certificate"); }],
    ["the server down", async () => new Response("down", { status: 503 })],
    ["a refused sign-in", async () => new Response("no", { status: 401 })],
    ["no such address", async () => new Response("gone", { status: 404 })],
    ["an empty answer", async () => new Response('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>', { status: 207 })],
  ];

  for (const [what, answer] of answers) {
    it(`with ${what} at the own address`, async () => {
      for (const [i, other] of OTHERS.entries()) {
        await cache.upsertAccount({
          id: `a${i}`,
          provider: "caldav",
          label: "NC",
          config: {
            url: other,
            user: "anna",
            confirmedAccess: {
              laptop: { url: OWN, user: "anna", seq: 1 },
              attacker: { url: other, user: "anna", principal: new URL("principals/users/anna/", other + "/").toString(), seq: 999 },
            },
          },
          enabled: true,
        });
      }
      const hosts: string[] = [];
      const record = async (input: RequestInfo | URL) => {
        hosts.push(new URL(input instanceof Request ? input.url : String(input)).host);
        return answer();
      };
      // Also a request that does not go through the target's fetch is seen.
      vi.stubGlobal("fetch", record);
      const worker = new PimWorker({
        cache,
        // What the shells do: the target from THIS device's sign-in.
        buildTarget: async () =>
          new CalDavPimTarget({ url: OWN, user: "anna", pass: "pw" }, record),
        now: () => Date.parse("2026-08-01T12:00:00Z"),
        deviceId: async () => "laptop",
      });
      await worker.triggerImmediate();
      await worker.triggerImmediate();
      expect(hosts.length).toBeGreaterThan(0);
      expect([...new Set(hosts)]).toEqual(["cloud.example.com"]);
    });
  }
});
