import { describe, it, expect, vi } from "vitest";
import { MoveBlockedError } from "@plainva/ui";
import { flushUnsavedBeforeMove } from "./moveFlush";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe("flushUnsavedBeforeMove (issue 113, V3)", () => {
  it("flushes only the unsaved notes at or under the moving paths", async () => {
    const flush = vi.fn(async () => {});
    const dirty = () => new Set(["Projects/Plan.md", "Projects/Sub/Deep.md", "Projects-old/Other.md", "Elsewhere.md"]);
    await flushUnsavedBeforeMove(["Projects"], "/vault", { dirty, flush });
    expect(flush.mock.calls.map((c) => c as unknown[])).toEqual([
      ["Projects/Plan.md", "/vault"],
      ["Projects/Sub/Deep.md", "/vault"],
    ]);
  });

  it("does nothing when nothing under the paths is unsaved", async () => {
    const flush = vi.fn(async () => {});
    await flushUnsavedBeforeMove(["Note.md"], "/vault", { dirty: () => new Set(["Other.md"]), flush });
    expect(flush).not.toHaveBeenCalled();
  });

  it("refuses the move with MoveBlockedError naming the note whose save failed", async () => {
    const reason = new Error("disk full");
    const flush = vi.fn(async (path: string) => { if (path === "B.md") throw reason; });
    const err = await flushUnsavedBeforeMove(["A.md", "B.md"], "/vault", { dirty: () => new Set(["A.md", "B.md"]), flush })
      .then(() => null, (e: unknown) => e);
    // The old tree swallowed this (Promise.allSettled without a check) and moved anyway.
    expect(err).toBeInstanceOf(MoveBlockedError);
    expect((err as MoveBlockedError).path).toBe("B.md");
    expect((err as MoveBlockedError).reason).toBe(reason);
  });

  it("waits for every other save before reporting a failure", async () => {
    const slow = deferred();
    const settled = vi.fn();
    const flush = vi.fn((path: string) => (path === "A.md" ? Promise.reject(new Error("locked")) : slow.promise));
    const run = flushUnsavedBeforeMove(["A.md", "B.md"], undefined, { dirty: () => new Set(["A.md", "B.md"]), flush })
      .catch((e: unknown) => { settled(); return e; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    slow.resolve();
    expect(await run).toBeInstanceOf(MoveBlockedError);
    expect(settled).toHaveBeenCalledOnce();
  });
});
