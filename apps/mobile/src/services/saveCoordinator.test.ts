import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaveCoordinator } from "./saveCoordinator";

describe("saveCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces and writes the LATEST text exactly once", async () => {
    const writes: Array<[string, string]> = [];
    const c = createSaveCoordinator<string>({
      contextKey: (ctx) => ctx,
      debounceMs: 800,
      write: async (_ctx, path, text) => {
        writes.push([path, text]);
      },
    });
    c.schedule("vault-a", "Note.md", "one");
    c.schedule("vault-a", "Note.md", "two");
    c.schedule("vault-a", "Note.md", "three");
    await vi.advanceTimersByTimeAsync(799);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([["Note.md", "three"]]);
    expect(c.hasPending()).toBe(false);
  });

  it("single-flight: a snapshot arriving during a write is written right after (latest wins)", async () => {
    const finished: string[] = [];
    let release: (() => void) | null = null;
    const c = createSaveCoordinator<string>({
      contextKey: (ctx) => ctx,
      debounceMs: 10,
      write: (_ctx, _path, text) =>
        new Promise<void>((resolve) => {
          release = () => {
            finished.push(text);
            resolve();
          };
        }),
    });
    c.schedule("v", "A.md", "first");
    await vi.advanceTimersByTimeAsync(10); // first write is now in flight
    c.schedule("v", "A.md", "second"); // newer snapshot while writing
    await vi.advanceTimersByTimeAsync(100);
    expect(finished).toEqual([]);
    release!(); // finish the first write
    await vi.advanceTimersByTimeAsync(0);
    // The follow-up write for "second" starts immediately, not after a debounce.
    expect(release).not.toBeNull();
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toEqual(["first", "second"]);
    expect(c.hasPending("A.md")).toBe(false);
  });

  it("discard drops a debounced snapshot without writing it (2026-07-16)", async () => {
    const writes: string[] = [];
    const c = createSaveCoordinator<string>({
      contextKey: (ctx) => ctx,
      debounceMs: 10,
      write: async (_ctx, _path, text) => {
        writes.push(text);
      },
    });
    c.schedule("v", "A.md", "draft");
    c.discard("A.md", "v"); // conflict path: the draft went to a .CONFLICT copy instead
    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toEqual([]);
    expect(c.hasPending("A.md")).toBe(false);
  });

  it("discard during an in-flight write prevents the latest-wins re-queue", async () => {
    const finished: string[] = [];
    let release: (() => void) | null = null;
    const c = createSaveCoordinator<string>({
      contextKey: (ctx) => ctx,
      debounceMs: 10,
      write: (_ctx, _path, text) =>
        new Promise<void>((resolve) => {
          release = () => {
            finished.push(text);
            resolve();
          };
        }),
    });
    c.schedule("v", "A.md", "first");
    await vi.advanceTimersByTimeAsync(10); // first write in flight
    c.schedule("v", "A.md", "second"); // newer snapshot queued behind it
    c.discard("A.md", "v"); // …but the conflict path discards it
    release!();
    await vi.advanceTimersByTimeAsync(100);
    expect(finished).toEqual(["first"]); // "second" was never written
    expect(c.hasPending("A.md")).toBe(false);
  });

  it("keeps the text pending on failure, reports the error and retries with backoff", async () => {
    const errors: number[] = [];
    let failuresLeft = 2;
    const writes: string[] = [];
    const c = createSaveCoordinator<string>({
      contextKey: (ctx) => ctx,
      debounceMs: 10,
      retryBaseMs: 1000,
      onError: (_p, _e, attempt) => errors.push(attempt),
      write: async (_ctx, _path, text) => {
        if (failuresLeft > 0) {
          failuresLeft--;
          throw new Error("disk full");
        }
        writes.push(text);
      },
    });
    c.schedule("v", "A.md", "important");
    await vi.advanceTimersByTimeAsync(10);
    expect(errors).toEqual([1]);
    expect(c.hasPending("A.md")).toBe(true); // text survived the failure
    await vi.advanceTimersByTimeAsync(1000); // retry 1 (base delay)
    expect(errors).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(2000); // retry 2 (doubled)
    expect(writes).toEqual(["important"]);
    expect(c.hasPending("A.md")).toBe(false);
  });

  it("flush writes pending work immediately and rejects on failure without hanging", async () => {
    const writes: string[] = [];
    let fail = true;
    const c = createSaveCoordinator<string>({
      contextKey: (ctx) => ctx,
      debounceMs: 60_000, // would never fire on its own in this test
      write: async (_ctx, _path, text) => {
        if (fail) throw new Error("offline");
        writes.push(text);
      },
    });
    c.schedule("v", "A.md", "text");
    await expect(c.flush("A.md")).rejects.toThrow("offline");
    expect(c.hasPending("A.md")).toBe(true);

    fail = false;
    const flushOk = c.flushAll();
    await vi.advanceTimersByTimeAsync(0);
    await flushOk;
    expect(writes).toEqual(["text"]);
    expect(c.hasPending()).toBe(false);
  });

  it("a terminal failure stops after ONE report — no retry storm (S5, 2026-08-12)", async () => {
    // A conflict is terminal: the write path already preserved the text in a
    // `.CONFLICT` sibling. Retrying would write another copy every backoff
    // round. Red counter-check: without `isTerminal` this reports 4 times and
    // keeps a pending entry.
    class Conflict extends Error {}
    const reports: Array<[string, number]> = [];
    let writes = 0;
    const c = createSaveCoordinator<string>({
      contextKey: (ctx) => ctx,
      debounceMs: 10,
      retryBaseMs: 50,
      isTerminal: (err) => err instanceof Conflict,
      onError: (path, _err, attempt) => {
        reports.push([path, attempt]);
      },
      write: async () => {
        writes += 1;
        throw new Conflict("conflict");
      },
    });
    c.schedule("v", "A.md", "my text");
    await vi.advanceTimersByTimeAsync(10);
    expect(writes).toBe(1);
    expect(reports).toEqual([["A.md", 1]]);
    // Let several backoff windows pass: nothing more may happen.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes).toBe(1);
    expect(reports).toEqual([["A.md", 1]]);
    expect(c.hasPending("A.md")).toBe(false);
  });

  it("a terminal failure does not block the next edit of the same note (S5)", async () => {
    class Conflict extends Error {}
    let fail = true;
    const writes: string[] = [];
    const c = createSaveCoordinator<string>({
      contextKey: (ctx) => ctx,
      debounceMs: 10,
      isTerminal: (err) => err instanceof Conflict,
      write: async (_ctx, _path, text) => {
        if (fail) throw new Conflict("conflict");
        writes.push(text);
      },
    });
    c.schedule("v", "A.md", "lost round");
    await vi.advanceTimersByTimeAsync(10);
    expect(writes).toEqual([]);
    fail = false;
    c.schedule("v", "A.md", "typed after resolving");
    await vi.advanceTimersByTimeAsync(10);
    expect(writes).toEqual(["typed after resolving"]);
  });

  it("a transient failure still retries (the terminal branch is not a blanket give-up)", async () => {
    class Conflict extends Error {}
    let attempts = 0;
    const c = createSaveCoordinator<string>({
      contextKey: (ctx) => ctx,
      debounceMs: 10,
      retryBaseMs: 50,
      isTerminal: (err) => err instanceof Conflict,
      write: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("disk busy");
      },
    });
    c.schedule("v", "A.md", "text");
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(500);
    expect(attempts).toBe(3);
    expect(c.hasPending("A.md")).toBe(false);
  });

  it("writes into the context captured at schedule time (vault-switch safety)", async () => {
    const targets: string[] = [];
    const c = createSaveCoordinator<string>({
      contextKey: (ctx) => ctx,
      debounceMs: 10,
      write: async (ctx, _path, text) => {
        targets.push(`${ctx}:${text}`);
      },
    });
    c.schedule("vault-OLD", "A.md", "typed in old vault");
    await vi.advanceTimersByTimeAsync(10);
    expect(targets).toEqual(["vault-OLD:typed in old vault"]);
  });
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}

describe("vault and revision isolation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps both vaults when they edit the same path before either debounce", async () => {
    const saved: string[] = [];
    const c = createSaveCoordinator<{ id: string }>({
      contextKey: (v) => v.id,
      write: async (v, path, text) => { saved.push(v.id + ":" + path + ":" + text); },
    });
    c.schedule({ id: "A" }, "Note.md", "alpha");
    c.schedule({ id: "B" }, "Note.md", "beta");
    await c.flush("Note.md", { id: "A" });
    expect(saved).toEqual(["A:Note.md:alpha"]);
    expect(c.hasPending("Note.md", { id: "B" })).toBe(true);
    await c.flushAll();
    expect(saved).toEqual(["A:Note.md:alpha", "B:Note.md:beta"]);
  });

  it("keeps revision numbers monotonic after successful entries retire", async () => {
    const c = createSaveCoordinator<string>({ contextKey: (v) => v, write: async () => {} });
    expect(c.schedule("v", "a", "first")).toBe(1);
    await c.flushAll();
    expect(c.schedule("v", "a", "second")).toBe(2);
    expect(c.discard("a", "v", 1)).toBe(false);
    expect(c.hasPending("a", "v")).toBe(true);
    await c.flushAll();
  });

  it("preserves a newer revision through its own write after a terminal conflict", async () => {
    const first = deferred();
    const writes: string[] = [], reports: number[] = [], saved: number[] = [];
    const c = createSaveCoordinator<string>({
      contextKey: (v) => v,
      debounceMs: 10,
      write: async (_v, _p, text) => {
        writes.push(text);
        if (text === "first") await first.promise;
      },
      isTerminal: () => true,
      onError: (_p, _e, _a, _v, revision) => { reports.push(revision); },
      onSaved: (_p, _v, revision) => { saved.push(revision); },
    });
    c.schedule("v", "a", "first");
    await vi.advanceTimersByTimeAsync(10);
    c.schedule("v", "a", "second");
    first.reject(new Error("first preserved as conflict"));
    await c.flushAll();
    expect(writes).toEqual(["first", "second"]);
    expect(reports).toEqual([1]);
    expect(saved).toEqual([2]);
    expect(c.hasPending()).toBe(false);
  });

  it("reports a failing follow-up once against its own revision", async () => {
    const first = deferred();
    const reports: Array<[number, number]> = [];
    const c = createSaveCoordinator<string>({
      contextKey: (v) => v, debounceMs: 10,
      write: async (_v, _p, text) => {
        if (text === "first") await first.promise;
        else throw new Error("second failed");
      },
      onError: (_p, _e, attempt, _v, revision) => { reports.push([revision, attempt]); },
    });
    c.schedule("v", "a", "first");
    await vi.advanceTimersByTimeAsync(10);
    c.schedule("v", "a", "second");
    const flushed = expect(c.flushAll()).rejects.toThrow("second failed");
    first.resolve();
    await flushed;
    expect(reports).toEqual([[2, 1]]);
    expect(c.hasPending()).toBe(true);
    c.discard("a", "v");
  });

  it.each([false, true])("a discarded failure cannot delete or retry its replacement (terminal=%s)", async (terminal) => {
    const first = deferred();
    const writes: string[] = [], reports: number[] = [];
    const c = createSaveCoordinator<string>({
      contextKey: (v) => v, debounceMs: 10,
      write: async (_v, _p, text) => { writes.push(text); if (text === "old") await first.promise; },
      isTerminal: () => terminal,
      onError: (_p, _e, _a, _v, rev) => { reports.push(rev); },
    });
    c.schedule("v", "a", "old");
    await vi.advanceTimersByTimeAsync(10);
    c.discard("a", "v");
    c.schedule("v", "a", "replacement");
    const flushed = c.flushAll();
    await vi.advanceTimersByTimeAsync(10);
    expect(writes).toEqual(["old"]); // physical writes remain ordered across discard
    first.reject(new Error("old failure"));
    await flushed;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes).toEqual(["old", "replacement"]);
    expect(reports).toEqual([]);
  });

  it("flush waits for a discarded native write before allowing teardown", async () => {
    const first = deferred();
    const c = createSaveCoordinator<string>({
      contextKey: (v) => v, debounceMs: 10, write: () => first.promise,
    });
    c.schedule("v", "a", "old");
    await vi.advanceTimersByTimeAsync(10);
    c.discard("a", "v");
    let finished = false;
    const flushed = c.flushAll().then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    first.resolve();
    await flushed;
    expect(finished).toBe(true);
  });

  it("flush waits for other documents before rejecting a failed write", async () => {
    const other = deferred();
    const c = createSaveCoordinator<string>({
      contextKey: (v) => v,
      write: async (_v, path) => { if (path === "bad") throw new Error("disk full"); await other.promise; },
    });
    c.schedule("v", "bad", "keep");
    c.schedule("v", "other", "wait");
    let settled = false;
    const flushed = c.flushAll().catch((error: Error) => { settled = true; return error.message; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    other.resolve();
    expect(await flushed).toBe("disk full");
    expect(c.hasPending("bad", "v")).toBe(true);
    c.discard("bad", "v");
  });

  it("external preservation holds background writes and leaves failed preservation pending", async () => {
    const copying = deferred();
    const writes: string[] = [];
    const c = createSaveCoordinator<string>({
      contextKey: (v) => v, debounceMs: 10,
      write: async (_v, _p, text) => { writes.push(text); },
    });
    c.schedule("v", "a", "draft");
    const held = expect(c.withWriteLock("a", "v", () => copying.promise)).rejects.toThrow("copy failed");
    await vi.advanceTimersByTimeAsync(10);
    expect(writes).toEqual([]);
    expect(c.hasPending("a", "v")).toBe(true);
    copying.reject(new Error("copy failed"));
    await held;
    await c.flushAll();
    expect(writes).toEqual(["draft"]);
  });
});
