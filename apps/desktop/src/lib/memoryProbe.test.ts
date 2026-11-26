import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROBE_MOST_CHARS, PROBE_STEP_MS, memoryProbeLines, runMemoryProbe } from "../../../../packages/ui/src/lib/memoryProbe";

/**
 * „Speicher messen“ (Über & Diagnose, both shells) reads generated notes of
 * growing size as the index reads them. It must find where a device stops
 * without stopping the app itself: until 2026-11 it read up to 16 MB, past
 * the size the note's budget is measured for, and under a heap of 128 MB it
 * ran out of memory on its first form.
 */

const DESKTOP = fileURLToPath(new URL("../..", import.meta.url));
const PROBE = fileURLToPath(new URL("../../../../packages/ui/src/lib/memoryProbe.ts", import.meta.url));
// The core's TypeScript loader, which reads the desktop's paths (`@plainva/core` from its sources).
const TSX = join(dirname(createRequire(fileURLToPath(new URL("../../../../packages/core/package.json", import.meta.url))).resolve("tsx")), "esm", "index.mjs");

describe("the memory probe", () => {
  it("ends on its own under a heap of 128 MB, every note it read no larger than its limit", () => {
    expect.hasAssertions();
    const script = `
      const store = new Map();
      globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
      const { runMemoryProbe } = await import(${JSON.stringify(PROBE)});
      const result = await runMemoryProbe(undefined, 150);
      console.log(JSON.stringify({ stopped: result.stopped, largest: result.largest, steps: result.steps.length }));`;
    const run = spawnSync(process.execPath, ["--max-old-space-size=128", "--import", TSX, "--input-type=module", "-e", script], { cwd: DESKTOP, encoding: "utf8", timeout: 300_000 });
    expect(run.status, run.stderr.slice(-400)).toBe(0);
    const result = JSON.parse(run.stdout.trim().split("\n").pop()!) as { stopped: string; largest: number; steps: number };
    expect(result.steps).toBeGreaterThan(3);
    expect(result.largest).toBeLessThanOrEqual(PROBE_MOST_CHARS);
  }, 320_000);

  it("stops where the engine says its heap is filling, and says so in the diagnostics", async () => {
    expect.hasAssertions();
    const performanceWithMemory = performance as unknown as { memory?: unknown };
    const had = Object.getOwnPropertyDescriptor(performance, "memory");
    Object.defineProperty(performance, "memory", { configurable: true, get: () => ({ usedJSHeapSize: 700e6, jsHeapSizeLimit: 1_000e6 }) });
    try {
      const result = await runMemoryProbe(undefined, 60);
      expect(result.stopped).toBe("heap");
      expect(result.steps).toHaveLength(1);
      expect(memoryProbeLines(result)).toContain("- Stopped: heap");
    } finally {
      if (had) Object.defineProperty(performance, "memory", had);
      else delete performanceWithMemory.memory;
    }
  });

  it("does not read the next note, twice the last, where twice the heap it left would pass the share", async () => {
    expect.hasAssertions();
    // At 35 % the heap was under the share of 60 %, and the next note — twice as large — began (review of L14, H4).
    const performanceWithMemory = performance as unknown as { memory?: unknown };
    const had = Object.getOwnPropertyDescriptor(performance, "memory");
    Object.defineProperty(performance, "memory", { configurable: true, get: () => ({ usedJSHeapSize: 350e6, jsHeapSizeLimit: 1_000e6 }) });
    try {
      const result = await runMemoryProbe(undefined, 60);
      expect(result.stopped).toBe("heap");
      expect(result.steps).toHaveLength(1);
    } finally {
      if (had) Object.defineProperty(performance, "memory", had);
      else delete performanceWithMemory.memory;
    }
  });

  it("ends a form at a step slower than its limit, and goes on with the next form", async () => {
    expect.hasAssertions();
    // A clock on which every note takes 6 s, over the 5 s a step may take; the probe is given 60 s. Each form ends
    // after its first note, and all three are read in time; read on, the first form alone used the time up.
    let clock = 0;
    const result = await runMemoryProbe(undefined, 60, () => (clock += 6_000));
    expect(result.steps.map((step) => step.form)).toEqual(["list", "prose", "table"]);
    expect(result.steps.every((step) => step.ms > PROBE_STEP_MS)).toBe(true);
    expect(result.stopped).toBe("all");
  });

  it("does not begin a note it would read past its time", async () => {
    expect.hasAssertions();
    // A clock on which every note takes 10 s; the probe is given 25 s. At 10 s the next note (about 20 s) would end at
    // 30 s: the probe ends after the first. Until 2026-11-26 it began a note whenever the time was not yet up.
    let clock = 0;
    const steps: number[] = [];
    const result = await runMemoryProbe(() => steps.push(clock), 25, () => {
      clock += 5_000;
      return clock;
    });
    expect(result.stopped).toBe("time");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].ms).toBe(5_000);
  });
});
