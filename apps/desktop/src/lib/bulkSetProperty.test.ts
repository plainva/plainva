import { describe, expect, it, vi } from "vitest";
import { bulkSetProperty, type PropertyWriteAdapter } from "@plainva/ui";

/**
 * The three properties that make a bulk write survivable on a real vault:
 * it must not stop at the first bad file, it must be interruptible without
 * losing what already landed, and it must not open two hundred writes at once.
 */

function adapter(fail: (path: string) => boolean, seen?: string[]): PropertyWriteAdapter & { writes: Map<string, string> } {
  const writes = new Map<string, string>();
  return {
    writes,
    async readTextFile(path: string) {
      seen?.push(path);
      if (fail(path)) throw new Error(`cannot read ${path}`);
      return "---\ntype: note\nokf_version: '1'\n---\n\nbody\n";
    },
    async writeTextFile(path: string, content: string) {
      writes.set(path, content);
    },
  };
}

describe("bulkSetProperty", () => {
  it("reports the files it could not write instead of abandoning the rest", async () => {
    const a = adapter((p) => p === "b.md");
    const r = await bulkSetProperty(a, ["a.md", "b.md", "c.md"], "status", "done");

    expect(r.written.sort()).toEqual(["a.md", "c.md"]);
    expect(r.failed.map((f) => f.path)).toEqual(["b.md"]);
    expect(r.failed[0].message).toContain("cannot read b.md");
    expect(r.cancelled).toBe(false);
    // The two good ones really carry the value.
    expect(a.writes.get("a.md")).toContain("status: done");
    expect(a.writes.get("c.md")).toContain("status: done");
  });

  it("stops when asked and keeps what it already wrote", async () => {
    const a = adapter(() => false);
    let done = 0;
    const r = await bulkSetProperty(
      a,
      ["a.md", "b.md", "c.md", "d.md", "e.md"],
      "status",
      "done",
      {
        concurrency: 1,
        onProgress: () => { done += 1; },
        isCancelled: () => done >= 2,
      }
    );

    expect(r.cancelled).toBe(true);
    expect(r.written.length).toBe(2);
    // Nothing beyond the cancel point was touched.
    expect(a.writes.size).toBe(2);
  });

  it("reports determinate progress: every step, total never moves", async () => {
    const a = adapter(() => false);
    const steps: string[] = [];
    await bulkSetProperty(a, ["a.md", "b.md", "c.md"], "status", "x", {
      concurrency: 1,
      onProgress: (d, total) => steps.push(`${d}/${total}`),
    });
    expect(steps).toEqual(["1/3", "2/3", "3/3"]);
  });

  it("keeps at most `concurrency` writes in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const a: PropertyWriteAdapter = {
      async readTextFile() {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return "---\ntype: note\n---\n\nbody\n";
      },
      async writeTextFile() {},
    };
    await bulkSetProperty(a, Array.from({ length: 20 }, (_, i) => `n${i}.md`), "status", "x", { concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("an empty selection writes nothing and does not report a failure", async () => {
    const a = adapter(() => true);
    const onProgress = vi.fn();
    const r = await bulkSetProperty(a, [], "status", "x", { onProgress });
    expect(r).toEqual({ written: [], failed: [], cancelled: false });
    expect(onProgress).not.toHaveBeenCalled();
  });
});
