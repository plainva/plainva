import { afterEach, describe, expect, it, vi } from "vitest";
import { GooglePimTarget } from "../src/pim/GooglePimTarget.ts";
import { pimTaskTraceRow, pimTraceEnabled, setPimTraceSink, tracePimTasks, type PimTaskTrace } from "../src/pim/pimTrace.ts";
import type { FetchFn } from "../src/sync/WebDavSyncTarget.ts";
import type { PimAuthProvider } from "../src/pim/types.ts";

/**
 * The task trace (finding 2026-09-19): a diagnostic aid that keeps a pull's
 * rows as the provider sent them. What it may carry is the point of the test -
 * identity, state, dates, revision; never a note, a link or anything unknown.
 */
const auth = (): PimAuthProvider => ({ getAccessToken: vi.fn(async () => "tok") });
const jsonRes = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => setPimTraceSink(null));

describe("a trace row", () => {
  it("is BUILT from the known fields, so nothing else can pass", () => {
    const raw = { id: "t1", title: "Call the practice about the mail server", status: "completed", hidden: true, due: "2026-09-19T00:00:00.000Z", completed: "2026-09-19T08:00:00.000Z", updated: "2026-09-19T08:00:01.000Z", etag: "\"e1\"", parent: "p", position: "0001", notes: "private text", links: [{ link: "https://example.com" }], webViewLink: "https://tasks.example/t1" };
    const row = pimTaskTraceRow(raw);
    expect(Object.keys(row).sort()).toEqual(["completed", "due", "etag", "hidden", "id", "parent", "position", "status", "title", "titleHash", "updated"]);
    expect(JSON.stringify(row)).not.toContain("private text");
    expect(JSON.stringify(row)).not.toContain("example");
  });

  it("cuts the title and keeps a hash, so two rows of one series can be told from look-alikes", () => {
    const a = pimTaskTraceRow({ id: "1", title: "Water the plants in the office" });
    const b = pimTaskTraceRow({ id: "2", title: "Water the plants in the office" });
    const c = pimTaskTraceRow({ id: "3", title: "Water the plants in the garden" });
    expect(a.title).toBe("Water the plants…");
    expect(a.titleHash).toBe(b.titleHash);
    expect(a.title).toBe(c.title);
    expect(a.titleHash).not.toBe(c.titleHash);
    expect(pimTaskTraceRow({ id: "4", title: "Short" }).title).toBe("Short");
    expect(pimTaskTraceRow({ id: "5" }).title).toBe("");
  });
});

describe("the seam", () => {
  it("is off until a listener is installed, and a throwing listener breaks nothing", () => {
    expect(pimTraceEnabled()).toBe(false);
    tracePimTasks("google", "l1", []);
    setPimTraceSink(() => { throw new Error("listener broke"); });
    expect(pimTraceEnabled()).toBe(true);
    expect(() => tracePimTasks("google", "l1", [])).not.toThrow();
  });

  it("hands the Google pull over as it came: hidden and deleted rows included, before anything is interpreted", async () => {
    const seen: PimTaskTrace[] = [];
    setPimTraceSink((trace) => seen.push(trace));
    const fetchFn: FetchFn = vi.fn(async () => jsonRes({
      items: [
        { id: "t1", title: "Daily", status: "needsAction", due: "2026-09-20T00:00:00.000Z", updated: "2026-09-19T08:00:01.000Z" },
        { id: "t2", title: "Daily", status: "completed", hidden: true, completed: "2026-09-19T08:00:00.000Z", notes: "never in a trace" },
        { id: "t3", title: "Gone", deleted: true },
      ],
    }));
    const { tasks } = await new GooglePimTarget(auth(), fetchFn).pullTasks("l1");
    // The sync itself is unchanged: the deleted row is still dropped there.
    expect(tasks.map((task) => task.uid)).toEqual(["t1", "t2"]);
    expect(seen).toHaveLength(1);
    expect(seen[0].provider).toBe("google");
    expect(seen[0].listId).toBe("l1");
    expect(seen[0].rows.map((row) => [row.id, row.status, row.hidden, row.deleted])).toEqual([["t1", "needsAction", undefined, undefined], ["t2", "completed", true, undefined], ["t3", undefined, undefined, true]]);
    expect(seen[0].rows[0].titleHash).toBe(seen[0].rows[1].titleHash);
    expect(JSON.stringify(seen)).not.toContain("never in a trace");
  });

  it("costs a pull nothing while it is off", async () => {
    const fetchFn: FetchFn = vi.fn(async () => jsonRes({ items: [{ id: "t1", title: "x" }] }));
    const { tasks } = await new GooglePimTarget(auth(), fetchFn).pullTasks("l1");
    expect(tasks).toHaveLength(1);
  });
});
