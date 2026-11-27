// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { CalDavPimTarget, PimCacheRepository, initializeSchema, type FetchFn, type IDatabaseAdapter, type IPimTarget, type PimTask } from "@plainva/core";
import { createProviderTask } from "@plainva/ui";
import { runTaskSync, type TaskSyncAdapter } from "./taskSync";

/**
 * "Send to list" tried again (issue 119), followed through two syncs. The
 * first send lands and its answer is lost; the task is then changed (or not)
 * at the provider; the same note is sent once more - a later try of the same
 * create. Whatever the adapter answers, the note is anchored to the uid it
 * answers with, and the sync takes the provider's state as the note's. So
 * after a later try, through the second sync:
 *  (a) what was changed elsewhere still stands at the provider,
 *  (b) what the note says is not reset silently,
 *  (c) nothing is said that the next sync takes back.
 * The adapter's rule (docs/engineering/Calendar_Create_Tries.md): a task that
 * is not provably this create's own is left and the draft created anew - the
 * note then hangs on a task that is its draft and nothing else, as on main.
 * Invented data only.
 */

class NodeSqliteAdapter implements IDatabaseAdapter {
  private db = new DatabaseSync(":memory:");
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

const TASK_DB = `properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Open
        - value: Doing
        - value: Done
  note.due:
    plainva:
      input: date
views:
  - type: table
    name: Table
    order:
      - file.name
      - note.status
      - note.due
filters:
  and:
    - file.folder == "Tasks"
`;

const LIST = "https://dav.example.org/cal/home/tasks/";

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const h = (init?.headers ?? {}) as Record<string, string>;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

/** A CalDAV list whose answer to the first PUT never arrives (the object is stored all the same). */
function dav() {
  const objects = new Map<string, { text: string; etag: string }>();
  let rev = 0;
  let lose = true;
  const fetchFn: FetchFn = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const held = objects.get(url);
    if (method === "PUT") {
      if (headerOf(init, "If-None-Match") === "*" && held) return new Response(null, { status: 412 });
      const im = headerOf(init, "If-Match");
      if (im && (!held || held.etag !== im)) return new Response(null, { status: 412 });
      rev += 1;
      objects.set(url, { text: String(init?.body), etag: `"r${rev}"` });
      if (lose) {
        lose = false;
        throw new TypeError("network connection was lost");
      }
      return new Response(null, { status: held ? 204 : 201, headers: { ETag: `"r${rev}"` } });
    }
    if (method === "GET") return held ? new Response(held.text, { status: 200, headers: { ETag: held.etag } }) : new Response("Not Found", { status: 404 });
    return new Response(null, { status: 405 });
  };
  return { objects, target: new CalDavPimTarget({ url: "https://dav.example.org/cal/home/", user: "u", pass: "p" }, fetchFn, async () => undefined) };
}

function vault(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const adapter: TaskSyncAdapter & { readFile: (p: string) => Promise<string>; writeFile: (p: string, t: string) => Promise<void>; stat: () => Promise<{ mtime: number; size: number }> } = {
    readTextFile: async (p) => {
      const c = files.get(p);
      if (c === undefined) throw new Error("not found: " + p);
      return c;
    },
    writeTextFile: async (p, c) => void files.set(p, c),
    exists: async (p) => files.has(p),
    createDir: async () => {},
    readFile: async (p) => files.get(p) ?? "",
    writeFile: async (p, t) => void files.set(p, t),
    stat: async () => ({ mtime: 1, size: 1 }),
  };
  return { adapter, files };
}

/** The tasks as the provider holds them, the way a pull lays them into the cache. */
function remoteTasks(objects: Map<string, { text: string; etag: string }>): PimTask[] {
  return [...objects.entries()].map(([href, o]) => ({
    listId: LIST,
    uid: /UID:([^\r\n]*)/.exec(o.text)![1]!,
    title: /SUMMARY:([^\r\n]*)/.exec(o.text)![1]!,
    completed: /STATUS:COMPLETED/.test(o.text),
    due: /DUE;VALUE=DATE:(\d{4})(\d{2})(\d{2})/.exec(o.text)!.slice(1).join("-"),
    etag: o.etag,
    href,
  })) as PimTask[];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T08:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

let run = 0;

/** Send, lose the answer, change at the provider, send again, sync twice. */
async function laterTry(elsewhere: ((text: string) => string) | null, noteDue = "2026-12-01") {
  run += 1;
  const db = new NodeSqliteAdapter();
  await initializeSchema(db);
  const cache = new PimCacheRepository(db);
  await cache.upsertAccount({ id: "a1", provider: "caldav", label: "Probe", config: {}, enabled: true });
  await cache.replaceTaskLists("a1", [{ id: LIST, name: "Tasks" }]);
  await cache.setTaskListSelected("a1", LIST, true);

  const notePath = `Tasks/Paint the fence ${run}.md`;
  const title = `Paint the fence ${run}`;
  const v = vault({ "Tasks.base": TASK_DB, [notePath]: `---\nstatus: Open\ndue: 2026-12-01\n---\n\n# ${title}\n` });
  const s = dav();
  const send = (due: string) =>
    createProviderTask({ adapter: v.adapter as never, notePath, accountId: "a1", listId: LIST, provider: "caldav", draft: { title, due }, createTask: (l, d) => s.target.createTask(l, d as never) });
  const first = await send("2026-12-01");
  expect(first).toEqual({ ok: false, reason: "createFailed" });
  const [firstHref] = [...s.objects.keys()];
  const firstUid = /UID:([^\r\n]*)/.exec(s.objects.get(firstHref!)!.text)![1]!;
  if (elsewhere) {
    const o = s.objects.get(firstHref!)!;
    s.objects.set(firstHref!, { text: elsewhere(o.text), etag: '"elsewhere"' });
  }
  const changedElsewhere = s.objects.get(firstHref!)!.text;
  // The person changed the note's due date between the tries (or did not).
  v.files.set(notePath, v.files.get(notePath)!.replace("due: 2026-12-01", `due: ${noteDue}`));
  const second = await send(noteDue);
  const anchoredUid = /uid: ?"?([^"\n]*)"?/.exec(v.files.get(notePath)!)?.[1];

  await cache.replaceTasks("a1", LIST, remoteTasks(s.objects));
  const updates: Array<{ uid: string; draft: unknown }> = [];
  const target = {
    provider: "caldav",
    updateTask: vi.fn(async (ref: { uid: string }, draft: unknown) => (updates.push({ uid: ref.uid, draft }), { etag: '"after"' })),
    deleteTask: vi.fn(async () => {}),
    createTask: vi.fn(async () => ({ uid: "x" })),
  } as unknown as IPimTarget;
  const anchorsByUid = new Map([[anchoredUid!, [{ path: notePath, uid: anchoredUid!, list: LIST, ctime: 1000, provider: "caldav" }]]]);
  const opts = { adapter: v.adapter, cache, buildTarget: async () => target, taskDbPath: "Tasks.base", noteType: "Task", allNotePaths: [notePath], anchorsByUid } as never;
  await runTaskSync(opts);
  await runTaskSync(opts);
  return { second, firstUid, firstHref: firstHref!, anchoredUid, updates, s, changedElsewhere, note: v.files.get(notePath)! };
}

describe("send to list, tried again, through two syncs (issue 119)", () => {
  it("TS1 - completed elsewhere: the completed task is never reopened; the note hangs on a task of its own", async () => {
    expect.hasAssertions();
    const out = await laterTry((t) => t.replace("STATUS:NEEDS-ACTION", "STATUS:COMPLETED\r\nCOMPLETED:20261127T080000Z"));
    expect(out.second).toMatchObject({ ok: true, anchored: true });
    expect(out.anchoredUid).not.toBe(out.firstUid);
    // (a) The provider's task stands as it was changed, and no sync wrote to it.
    expect(out.s.objects.get(out.firstHref)!.text).toBe(out.changedElsewhere);
    expect(out.updates.filter((u) => u.uid === out.firstUid)).toEqual([]);
    // (b) The note is still open, and its own task is open.
    expect(out.note).toContain("status: Open");
    expect(out.s.objects.get(`${LIST}${out.anchoredUid}.ics`)!.text).not.toContain("STATUS:COMPLETED");
  });

  it("TS2 - due moved elsewhere: the moved due date is never set back", async () => {
    expect.hasAssertions();
    const out = await laterTry((t) => t.replace(/DUE;VALUE=DATE:\d+/, "DUE;VALUE=DATE:20261205"));
    expect(out.anchoredUid).not.toBe(out.firstUid);
    expect(out.s.objects.get(out.firstHref)!.text).toContain("DUE;VALUE=DATE:20261205");
    expect(out.updates.filter((u) => u.uid === out.firstUid)).toEqual([]);
    expect(out.note).toContain("due: 2026-12-01");
  });

  it("nothing changed elsewhere: the note hangs on the one task, and neither sync writes to it", async () => {
    expect.hasAssertions();
    const out = await laterTry(null);
    expect(out.second).toMatchObject({ ok: true, anchored: true });
    expect(out.anchoredUid).toBe(out.firstUid);
    expect(out.s.objects.size).toBe(1);
    expect(out.updates).toEqual([]);
  });

  it("the note's due changed between the tries, nothing elsewhere: the provider takes the note's, and neither sync writes again", async () => {
    expect.hasAssertions();
    const out = await laterTry(null, "2026-12-09");
    expect(out.anchoredUid).toBe(out.firstUid);
    expect(out.s.objects.size).toBe(1);
    expect(out.s.objects.get(out.firstHref)!.text).toContain("DUE;VALUE=DATE:20261209");
    expect(out.updates).toEqual([]);
  });
});
