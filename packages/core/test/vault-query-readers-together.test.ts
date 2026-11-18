import { describe, expect, it } from "vitest";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { VaultQueryService } from "../src/vault/VaultQueryService.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import { MemoryVaultAdapter } from "./helpers/memoryVault.ts";

/**
 * Two readers with different views at the same time on one index (round 11 of the review of R19, wave 2): two apps
 * with different grants, or an app and the assistant in the cloud. What one query keeps of a note for its reader
 * (`BLOCKS`) is shared by all of them; what a query used to judge a note stays with it until it answers, whatever
 * another query lets go meanwhile, and a note whose view is missing for any reason is withheld, never shown as held.
 * Each statement of the database yields to the event loop as a round trip to the native side does, so queries
 * interleave at every place one waits.
 */

class YieldingSqlite implements IDatabaseAdapter {
  /** Statements answered so far: where a query waits. */
  waits = 0;
  constructor(private db: any) {}
  private tick() {
    this.waits++;
    return new Promise<void>((resolve) => setImmediate(resolve));
  }
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.tick();
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.tick();
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    await this.tick();
    return (this.db.prepare(sql).all(...(params as never[])) as T[])[0] ?? null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {}
}

type Reader = { reach: (paths: readonly string[]) => Promise<ReadonlySet<string>>; withhold: { rule: "any-kept-back" } };
const readerWithout = (prefix: string | null): Reader => ({
  reach: async (paths) => new Set(prefix ? paths.filter((path) => !path.startsWith(prefix)) : paths),
  withhold: { rule: "any-kept-back" },
});
const ticks = async (count: number) => {
  for (let i = 0; i < count; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

async function indexed(files: Record<string, string>) {
  const { DatabaseSync } = (await import("node:sqlite")) as any;
  const vault = new MemoryVaultAdapter(1_700_000_000_000);
  for (const [path, text] of Object.entries(files)) await vault.writeTextFile(path, text);
  const sqlite = new DatabaseSync(":memory:");
  const db = new YieldingSqlite(sqlite);
  await initializeSchema(db);
  await new VaultIndexer(vault, db).indexVaultFull();
  // Another service over the same index with its own store: what a reader is answered when no one else asks.
  const alone = () => new VaultQueryService(new YieldingSqlite(sqlite) as never);
  return { db, query: new VaultQueryService(db as never), alone, close: () => sqlite.close() };
}

const inFolder = (folder: string) => ({ filters: { and: [`file.folder == "${folder}"`] }, views: [{ type: "table", name: "T", sort: [{ property: "file.path", direction: "ASC" }] }] });
const under = { filters: { and: ['file.folder.startsWith("Projects")'] }, views: [{ type: "table", name: "T", sort: [{ property: "file.path", direction: "ASC" }] }] };

describe("two readers at the same time (round 11 of the review of R19, wave 2)", () => {
  it("a reader who may not follow a link is never shown it while another reader lets the same notes go, at any place a query waits", async () => {
    const files: Record<string, string> = { "Private/Aaron.md": "# a\n", "Projects/Lead.md": "# l\n" };
    const paths: string[] = [];
    for (let i = 0; i < 40; i++) {
      const path = `Projects/${i % 2 ? "G2" : "G1"}/n${i}.md`;
      paths.push(path);
      files[path] = `---\nowner: "[[Lead]]"\nup: [[Aaron]]\ntitle: "[[Aaron]] plan"\ntags: [a]\n---\n# n${i}\n`;
    }
    const { db, query, close } = await indexed(files);
    const narrow = readerWithout("Private/");
    const wide = readerWithout(null);
    const odd = paths.filter((_, i) => i % 2);
    const even = paths.filter((_, i) => !(i % 2));
    try {
      // How long one query of the narrow reader waits: B starts at each of those places.
      await query.queryDatabaseFiles(under, narrow);
      let before = db.waits;
      await query.queryDatabaseFiles(under, narrow);
      const rowsWait = db.waits - before;
      before = db.waits;
      await query.notesAsSeen(paths, narrow.reach, "any-kept-back");
      const seenWait = db.waits - before;
      expect(rowsWait).toBeGreaterThan(2);
      expect(seenWait).toBeGreaterThan(2);
      for (let delay = 0; delay <= rowsWait + 2; delay++) {
        // The narrow reader keeps every block; the wide one lets those of G2 go; then the narrow reader reads them
        // again while the wide one lets those of G1 go.
        await query.queryDatabaseFiles(under, narrow);
        await query.queryDatabaseFiles(inFolder("Projects/G2"), wide);
        const [rows] = await Promise.all([query.queryDatabaseFiles(under, narrow), ticks(delay).then(() => query.queryDatabaseFiles(inFolder("Projects/G1"), wide))]);
        const named = rows.filter((row: any) => !String(row["file.path"]).startsWith("Private/") && /Aaron/.test(JSON.stringify(row)));
        expect(named.map((row: any) => `${delay}: ${JSON.stringify(row)}`)).toEqual([]);
        expect(rows.filter((row: any) => String(row["file.path"]).startsWith("Projects/G")).length).toBe(40);
      }
      for (let delay = 0; delay <= seenWait + 2; delay++) {
        await query.notesAsSeen(paths, narrow.reach, "any-kept-back");
        await query.notesAsSeen(odd, wide.reach, "any-kept-back");
        const [seen] = await Promise.all([query.notesAsSeen(paths, narrow.reach, "any-kept-back"), ticks(delay).then(() => query.notesAsSeen(even, wide.reach, "any-kept-back"))]);
        // Every one of them holds a withheld title: each is answered for, none with the name it withholds.
        expect([delay, seen.size]).toEqual([delay, 40]);
        expect([...seen.values()].filter((note) => /Aaron/.test(note.title))).toEqual([]);
      }
    } finally {
      close();
    }
  });

  // Random notes, three readers, their queries started in random order and at random places of each other: each is
  // answered as that reader is answered alone (`ITER` rounds; `ITER=2000` for the long run).
  const ITER = Number(process.env.ITER_TOGETHER ?? 120);
  let seed = Number(process.env.SEED ?? 11);
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const LINES = ['owner: "[[Lead]]"', "up: [[Aaron]]", 'title: "[[Aaron]] plan"', "title: plain", "rel: [[n3]]", 'rel: "[[Projects/G1/n2]]"', "x: [t](../Private/Aaron.md)", "x: [t](G1/n4.md)", "tags: [a]", "tags: [b, c]", "list:\n  - [[Lead]]\n  - [[Aaron]]", "list: [[[n5]], [[Lead]]]", 'm: {k: "[[Aaron]]"}', "esc: \"\\x5b\\x5bAaron]]\"", "n: 3"];

  it("readers whose queries interleave are each answered as when alone", async () => {
    const files: Record<string, string> = { "Private/Aaron.md": "# a\n", "Projects/Lead.md": "# l\n" };
    const paths: string[] = [];
    for (let i = 0; i < 30; i++) {
      const path = `Projects/${i % 3 ? "G2" : "G1"}/n${i}.md`;
      paths.push(path);
      const lines = new Set<string>();
      for (let k = 1 + Math.floor(random() * 4); k > 0; k--) lines.add(pick(LINES));
      const keys = new Set<string>();
      const block = [...lines].filter((line) => {
        const key = line.split(":")[0]!;
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      });
      files[path] = `---\n${block.join("\n")}\n---\n# n${i}\n`;
    }
    const { query, alone, close } = await indexed(files);
    const readers = [readerWithout("Private/"), readerWithout("Projects/G1/"), readerWithout(null)];
    const configs = [under, inFolder("Projects/G1"), inFolder("Projects/G2")];
    const expected = new Map<string, string>();
    const answerAlone = async (kind: "rows" | "seen", reader: number, config: number, slice: number) => {
      const key = `${kind}/${reader}/${config}/${slice}`;
      if (!expected.has(key)) {
        const service = alone();
        const answer = kind === "rows" ? await service.queryDatabaseFiles(configs[config]!, readers[reader]!) : [...(await service.notesAsSeen(paths.filter((_, i) => i % 2 === slice || slice === 2), readers[reader]!.reach, "any-kept-back"))];
        expected.set(key, JSON.stringify(answer));
      }
      return expected.get(key)!;
    };
    try {
      let checked = 0;
      for (let round = 0; round < ITER; round++) {
        const asked = Array.from({ length: 2 + Math.floor(random() * 3) }, () => ({ kind: random() < 0.6 ? ("rows" as const) : ("seen" as const), reader: Math.floor(random() * readers.length), config: Math.floor(random() * configs.length), slice: Math.floor(random() * 3), delay: Math.floor(random() * 12) }));
        const answers = await Promise.all(
          asked.map((one) =>
            ticks(one.delay).then(async () =>
              JSON.stringify(one.kind === "rows" ? await query.queryDatabaseFiles(configs[one.config]!, readers[one.reader]!) : [...(await query.notesAsSeen(paths.filter((_, i) => i % 2 === one.slice || one.slice === 2), readers[one.reader]!.reach, "any-kept-back"))]),
            ),
          ),
        );
        for (let k = 0; k < asked.length; k++) {
          const one = asked[k]!;
          expect([round, one, answers[k]]).toEqual([round, one, await answerAlone(one.kind, one.reader, one.config, one.slice)]);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(ITER * 2 - 1);
    } finally {
      close();
    }
  }, 120_000);
});
