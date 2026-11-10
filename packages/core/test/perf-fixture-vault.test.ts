import { describe, expect, it } from "vitest";
import { fixtureFiles, summarizeFixture } from "../scripts/perf/fixtureVault.js";
import { judge, toBaseline } from "../scripts/perf/core-gate.js";
import type { CoreResult } from "../scripts/perf/coreBenchmark.js";

/**
 * The fixture vault of the performance gates (Gesamtplan Leistung L0) is the
 * same on every run and every machine. Its digest is pinned: a change to the
 * generator voids every recorded baseline, so it has to be made on purpose —
 * update the digest here and record the baselines again (Performance_Notes.md,
 * "Performance gates").
 */
describe("the performance fixture vault", () => {
  it("is the same vault every time, and the pinned one", () => {
    const first = summarizeFixture({ count: 1000 });
    expect(summarizeFixture({ count: 1000 })).toEqual(first);
    expect(first).toEqual({
      notes: 1000,
      attachments: 25,
      bases: 3,
      bytes: 5169100,
      tasks: 3245,
      digest: "dc78a73fc6d7b432e96da895cb45ab961d829e7dcfcd7b40c18f949171c81606",
    });
  });

  it("has the shape the measurements need", () => {
    const files = [...fixtureFiles({ count: 2000 })];
    const notes = files.filter((f) => f.path.endsWith(".md"));
    const text = notes.map((f) => String(f.data));
    expect(new Set(files.map((f) => f.path)).size).toBe(files.length);
    expect(notes).toHaveLength(2000);
    expect(String(notes[0].data).split("\n").length).toBeGreaterThan(19_000);
    expect((String(notes[0].data).match(/^\|---\|/gm) ?? []).length).toBe(80);
    expect(notes.filter((f) => f.path.startsWith("Journal/")).length).toBe(120);
    const share = (re: RegExp) => text.filter((t) => re.test(t)).length / text.length;
    expect(share(/^---\n/)).toBeGreaterThan(0.5);
    expect(share(/^- \[[ x]\] /m)).toBeGreaterThan(0.3);
    expect(share(/\[\[[^\]]+\]\]/)).toBeGreaterThan(0.5);
    expect(share(/\]\([^)]+\.md\)/)).toBeGreaterThan(0.05);
    expect(share(/!\[\[Attachments\//)).toBeGreaterThan(0.05);
    expect(files.some((f) => f.path.endsWith(".base"))).toBe(true);
    expect(files.some((f) => f.path.endsWith(".pdf"))).toBe(true);
    const sizes = text.slice(1).map((t) => t.length).sort((a, b) => a - b);
    expect(sizes[Math.floor(sizes.length / 2)]).toBeGreaterThan(500);
    expect(sizes[sizes.length - 1]).toBeGreaterThan(15_000);
  });

  it("refuses a count that is no positive whole number", () => {
    expect(() => [...fixtureFiles({ count: 0 })]).toThrow();
    expect(() => [...fixtureFiles({ count: 1.5 })]).toThrow();
  });
});

describe("the core gate's verdict", () => {
  const run = (calibrationMs: number, metrics: Partial<CoreResult["metrics"]>): CoreResult => ({
    meta: { date: "2026-11-10T00:00:00.000Z", node: "v22", os: "test", cpu: "test", logicalCpus: 1, totalMemory: 1, wal: true },
    fixture: { notes: 1, attachments: 0, bases: 0, bytes: 1, tasks: 0, digest: "d", count: 1 },
    shape: {},
    calibrationMs,
    calibrationSamplesMs: [calibrationMs],
    metrics: { coldIndexMs: 30_000, warmIndexMs: 400, saveP50Ms: 8, saveP95Ms: 12, searchMs: 20, listTasksMs: 400, dbBytes: 60_000_000, ...metrics },
    extra: {},
    boundary: "",
  });
  const baseline = toBaseline(run(1000, {}));

  it("passes the same code on a machine twice as slow", () => {
    const slower = run(2000, { coldIndexMs: 60_000, warmIndexMs: 800, saveP50Ms: 16, saveP95Ms: 24, searchMs: 40, listTasksMs: 800 });
    expect(judge(baseline, slower).filter((v) => v.over)).toEqual([]);
  });

  it("fails a metric more than 25 % worse, measured against the machine's speed", () => {
    const over = judge(baseline, run(1000, { coldIndexMs: 40_000, searchMs: 21 })).filter((v) => v.over).map((v) => v.metric);
    expect(over).toEqual(["coldIndexMs"]);
  });

  it("does not fail a small time for a change below its floor", () => {
    // 4 ms → 6 ms is 50 % worse, but by 2 ms, which is the floor of a save: noise.
    const fast = toBaseline(run(1000, { saveP50Ms: 4 }));
    expect(judge(fast, run(1000, { saveP50Ms: 6 })).filter((v) => v.over)).toEqual([]);
    expect(judge(fast, run(1000, { saveP50Ms: 6.5 })).filter((v) => v.over).map((v) => v.metric)).toEqual(["saveP50Ms"]);
  });

  it("fails an index that grew by more than 25 %", () => {
    expect(judge(baseline, run(1000, { dbBytes: 80_000_000 })).filter((v) => v.over).map((v) => v.metric)).toEqual(["dbBytes"]);
  });
});
