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
      debounceMs: 10,
      write: async (_ctx, _path, text) => {
        writes.push(text);
      },
    });
    c.schedule("v", "A.md", "draft");
    c.discard("A.md"); // conflict path: the draft went to a .CONFLICT copy instead
    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toEqual([]);
    expect(c.hasPending("A.md")).toBe(false);
  });

  it("discard during an in-flight write prevents the latest-wins re-queue", async () => {
    const finished: string[] = [];
    let release: (() => void) | null = null;
    const c = createSaveCoordinator<string>({
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
    c.discard("A.md"); // …but the conflict path discards it
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

  it("flush writes pending work immediately and resolves on failure without hanging", async () => {
    const writes: string[] = [];
    let fail = true;
    const c = createSaveCoordinator<string>({
      debounceMs: 60_000, // would never fire on its own in this test
      write: async (_ctx, _path, text) => {
        if (fail) throw new Error("offline");
        writes.push(text);
      },
    });
    c.schedule("v", "A.md", "text");
    const flushFail = c.flush("A.md");
    await vi.advanceTimersByTimeAsync(0);
    await flushFail; // resolves despite the failure
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
