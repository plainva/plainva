import { describe, it, expect } from "vitest";
import { createLimiter } from "@plainva/ui";

/** A promise plus its resolver, so tests control exactly when a task finishes. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createLimiter", () => {
  it("never runs more than `limit` tasks at once", async () => {
    const limit = createLimiter(3);
    let active = 0;
    let maxActive = 0;
    const gates = Array.from({ length: 10 }, () => deferred<void>());

    const runs = gates.map((g, i) =>
      limit.run(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await g.promise;
        active--;
        return i;
      })
    );

    // Let the first batch start.
    await Promise.resolve();
    expect(active).toBe(3);
    expect(maxActive).toBe(3);

    // Release tasks one by one; the queue should keep exactly 3 in flight.
    for (const g of gates) {
      g.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(active).toBeLessThanOrEqual(3);
    }

    const results = await Promise.all(runs);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(maxActive).toBe(3);
  });

  it("runs every task even when the limit is smaller than the batch", async () => {
    const limit = createLimiter(2);
    const seen: number[] = [];
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        limit.run(async () => {
          seen.push(i);
        })
      )
    );
    expect(seen.length).toBe(25);
    expect(new Set(seen).size).toBe(25);
  });

  it("resolves each call with its own result and isolates rejections", async () => {
    const limit = createLimiter(2);
    const ok = limit.run(async () => "value");
    const bad = limit.run(async () => {
      throw new Error("boom");
    });
    const ok2 = limit.run(async () => 42);

    await expect(ok).resolves.toBe("value");
    await expect(bad).rejects.toThrow("boom");
    await expect(ok2).resolves.toBe(42);
  });

  it("keeps draining the queue after a task rejects", async () => {
    const limit = createLimiter(1);
    const results = await Promise.allSettled([
      limit.run(async () => {
        throw new Error("first fails");
      }),
      limit.run(async () => "second ok"),
      limit.run(async () => "third ok"),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[1]).toEqual({ status: "fulfilled", value: "second ok" });
    expect(results[2]).toEqual({ status: "fulfilled", value: "third ok" });
  });
});
