import { describe, it, expect, beforeEach } from "vitest";
import {
  pendingWriteFor,
  trackPendingWrite,
  settlePendingWrites,
  resetPendingWritesForTests,
} from "./pendingWrites";

/** A promise plus the switch that settles it, so the test controls the timing. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("pending writes are scoped to their vault", () => {
  beforeEach(() => resetPendingWritesForTests());

  it("keeps the same relative path apart in two vaults", async () => {
    const a = deferred();
    const b = deferred();
    const runA = trackPendingWrite("/vault/a", "Notes/A.md", a.promise);
    const runB = trackPendingWrite("/vault/b", "Notes/A.md", b.promise);

    // The point of stage D: `Notes/A.md` exists in both vaults, and an editor in
    // one must not wait for - or be chained behind - a write in the other.
    expect(pendingWriteFor("/vault/a", "Notes/A.md")).toBe(a.promise);
    expect(pendingWriteFor("/vault/b", "Notes/A.md")).toBe(b.promise);
    expect(pendingWriteFor("/vault/a", "Notes/A.md")).not.toBe(
      pendingWriteFor("/vault/b", "Notes/A.md"),
    );

    a.resolve();
    b.resolve();
    await Promise.all([runA, runB]);
  });

  it("does not confuse a vault whose path is a prefix of another", async () => {
    const outer = deferred();
    const run = trackPendingWrite("/vault", "a/Notes/A.md", outer.promise);

    // "/vault" + "a/Notes/A.md" and "/vaulta" + "Notes/A.md" would collide under
    // any printable separator; the key uses NUL for exactly this reason.
    expect(pendingWriteFor("/vaulta", "Notes/A.md")).toBeUndefined();

    outer.resolve();
    await run;
  });

  it("drops the entry once the write settles", async () => {
    const d = deferred();
    const run = trackPendingWrite("/vault/a", "Notes/A.md", d.promise);
    expect(pendingWriteFor("/vault/a", "Notes/A.md")).toBe(d.promise);
    d.resolve();
    await run;
    expect(pendingWriteFor("/vault/a", "Notes/A.md")).toBeUndefined();
  });

  it("lets a newer write replace an older one without the older one deleting it", async () => {
    const first = deferred();
    const second = deferred();
    const runFirst = trackPendingWrite("/vault/a", "Notes/A.md", first.promise);
    const runSecond = trackPendingWrite("/vault/a", "Notes/A.md", second.promise);

    first.resolve();
    await runFirst;
    // The first write finishing must not clear the second one's entry - a loader
    // would then read mid-write content back.
    expect(pendingWriteFor("/vault/a", "Notes/A.md")).toBe(second.promise);

    second.resolve();
    await runSecond;
    expect(pendingWriteFor("/vault/a", "Notes/A.md")).toBeUndefined();
  });
});

describe("settling a vault's writes before its runtime goes", () => {
  beforeEach(() => resetPendingWritesForTests());

  it("waits for every write of that vault and ignores the other one", async () => {
    const mine = deferred();
    const foreign = deferred();
    const runMine = trackPendingWrite("/vault/a", "Notes/A.md", mine.promise);
    const runForeign = trackPendingWrite("/vault/b", "Notes/B.md", foreign.promise);

    let settled = false;
    const settle = settlePendingWrites("/vault/a").then(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);

    mine.resolve();
    await settle;
    expect(settled).toBe(true);
    // The other vault is untouched: it belongs to a runtime that keeps running.
    expect(pendingWriteFor("/vault/b", "Notes/B.md")).toBe(foreign.promise);

    foreign.resolve();
    await Promise.all([runMine, runForeign]);
  });

  it("treats a failed write as finished", async () => {
    const d = deferred();
    const run = trackPendingWrite("/vault/a", "Notes/A.md", d.promise).catch(() => undefined);
    d.reject(new Error("disk full"));
    // A failed write is done too, and its error was reported where it happened.
    // Hanging here would keep the vault's teardown open forever.
    await expect(settlePendingWrites("/vault/a")).resolves.toBeUndefined();
    await run;
  });

  it("resolves immediately when nothing is in flight", async () => {
    await expect(settlePendingWrites("/vault/a")).resolves.toBeUndefined();
  });
});
