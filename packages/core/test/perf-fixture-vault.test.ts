import { describe, expect, it } from "vitest";
import { fixtureFiles, summarizeFixture } from "../scripts/perf/fixtureVault.js";
import { environmentName, judge, lookupBaseline, medianBaseline, runRatio, toBaseline } from "../scripts/perf/core-gate.js";
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
    fsWalkMs: calibrationMs / 2,
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

  it("holds the save's median to 15 %, above a floor of half a millisecond", () => {
    // Measured on the runners: unchanged code within 8 %, a save made 30 % slower at least 18 % worse.
    const fast = toBaseline(run(1000, { saveP50Ms: 4 }));
    expect(judge(fast, run(1000, { saveP50Ms: 4.5 })).filter((v) => v.over)).toEqual([]);
    expect(judge(fast, run(1000, { saveP50Ms: 4.7 })).filter((v) => v.over).map((v) => v.metric)).toEqual(["saveP50Ms"]);
    // 1 ms → 1.4 ms is 40 % worse, but by 0.4 ms: below the floor.
    const tiny = toBaseline(run(1000, { saveP50Ms: 1 }));
    expect(judge(tiny, run(1000, { saveP50Ms: 1.4 })).filter((v) => v.over)).toEqual([]);
  });

  it("holds the save's 95th percentile to 50 %: it moved by up to 37 % for nothing", () => {
    expect(judge(baseline, run(1000, { saveP95Ms: 17 })).filter((v) => v.over)).toEqual([]);
    expect(judge(baseline, run(1000, { saveP95Ms: 19 })).filter((v) => v.over).map((v) => v.metric)).toEqual(["saveP95Ms"]);
  });

  it("reads a metric of rounds against each round's own calibration, and takes the median of the rounds", () => {
    const round = (calibrationMs: number, saveP50Ms: number) => ({ calibrationMs, fsWalkMs: 500, warmIndexMs: 400, saveP50Ms, saveP95Ms: 12, searchMs: 20, listTasksMs: 400 });
    // The machine slowed down for two rounds, the code did not: each round's ratio is the same.
    const steady = { ...run(1000, {}), rounds: [round(1000, 8), round(2000, 16), round(1000, 8), round(2500, 20), round(1000, 8)] };
    expect(runRatio(steady, "saveP50Ms")).toBeCloseTo(0.008, 6);
    // One round that met a neighbour is outvoted by the others.
    const oneBad = { ...run(1000, {}), rounds: [round(1000, 8), round(1000, 30), round(1000, 8), round(1000, 8.2), round(1000, 7.9)] };
    expect(runRatio(oneBad, "saveP50Ms")).toBeCloseTo(0.008, 6);
    expect(judge(baseline, oneBad).filter((v) => v.over)).toEqual([]);
    // A slower save in every round is a slower save.
    const slower = { ...run(1000, {}), rounds: [1, 2, 3, 4, 5].map(() => round(1000, 10.4)) };
    expect(judge(baseline, slower).filter((v) => v.over).map((v) => v.metric)).toEqual(["saveP50Ms"]);
    // The pass without changes is read against each round's walk of the folder.
    expect(runRatio(steady, "warmIndexMs")).toBeCloseTo(0.8, 6);
  });

  it("makes a baseline of many runs: each ratio the median of theirs, with their spread", () => {
    const runs = [7.6, 8, 8.4, 8.1, 9.9].map((saveP50Ms) => run(1000, { saveP50Ms }));
    const made = medianBaseline(runs);
    expect(made.runs).toBe(5);
    expect(made.ratios.saveP50Ms).toBeCloseTo(0.0081, 6);
    expect(made.spread!.saveP50Ms[0]).toBeCloseTo(7.6 / 8.1, 3);
    expect(made.spread!.saveP50Ms[1]).toBeCloseTo(9.9 / 8.1, 3);
    const other = { ...run(1000, {}), fixture: { ...run(1000, {}).fixture, digest: "e" } };
    expect(() => medianBaseline([...runs, other])).toThrow(/different fixtures/);
    expect(() => medianBaseline([])).toThrow();
  });

  it("fails an index that grew by more than 25 %", () => {
    expect(judge(baseline, run(1000, { dbBytes: 80_000_000 })).filter((v) => v.over).map((v) => v.metric)).toEqual(["dbBytes"]);
  });
});

describe("the core gate's environments", () => {
  const entry = (cpu: string) => ({
    recorded: "2026-11-11", node: "v22", cpu, calibrationMs: 1000, fsWalkMs: 300,
    ratios: { coldIndexMs: 40, warmIndexMs: 1.2, saveP50Ms: 0.004, saveP95Ms: 0.008, searchMs: 0.05, listTasksMs: 0.7 },
    ms: {}, dbBytes: 1, fixtureDigest: "d",
  });
  const environments = {
    "github-ubuntu-latest": entry("AMD EPYC 7763 64-Core Processor, AMD EPYC 9V45 96-Core Processor"),
    "win32-x64-amd-ryzen-ai-9-hx-370-w-radeon-890m": entry("AMD Ryzen AI 9 HX 370 w/ Radeon 890M"),
  };

  it("names a runner by its label alone, whatever CPU model it hands out, and a machine without one by its CPU", () => {
    const before = process.env.PERF_ENV;
    process.env.PERF_ENV = "github-ubuntu-latest";
    try {
      expect(environmentName()).toBe("github-ubuntu-latest");
      delete process.env.PERF_ENV;
      expect(environmentName()).toMatch(/^[a-z0-9]+-[a-z0-9]+-[a-z0-9-]+$/);
    } finally {
      if (before === undefined) delete process.env.PERF_ENV;
      else process.env.PERF_ENV = before;
    }
  });

  it("compares a run only with the baseline of its own environment", () => {
    const found = lookupBaseline(environments, "github-ubuntu-latest");
    expect("baseline" in found && found.baseline.cpu).toContain("AMD EPYC 7763");
  });

  it("gives an environment without a baseline a warning naming those that have one, and no verdict", () => {
    const found = lookupBaseline(environments, "github-windows-latest");
    expect("baseline" in found).toBe(false);
    const warning = "warning" in found ? found.warning : "";
    expect(warning).toContain('"github-windows-latest"');
    expect(warning).toContain("no verdict (exit 0)");
    expect(warning).toContain("github-ubuntu-latest, win32-x64-amd-ryzen-ai-9-hx-370-w-radeon-890m");
    expect(lookupBaseline({}, "x")).toEqual({ warning: expect.stringContaining("Environments with a baseline: none.") });
  });
});
