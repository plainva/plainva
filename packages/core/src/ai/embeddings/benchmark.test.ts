import { describe, expect, it } from "vitest";
import { EMBEDDING_BUDGETS, SAMPLE_SECTIONS, checkBudgets, measureEngine, syntheticIndex } from "./benchmark.js";
import { createTrigramEmbeddingEngine, type EmbeddingEngine } from "./engine.js";

/** The trigram engine on a clock that only moves while it embeds: 100 ms per section, 40 ms per question. */
function timedEngine() {
  const inner = createTrigramEmbeddingEngine(32);
  let clock = 0;
  const engine: EmbeddingEngine = {
    id: inner.id,
    dim: inner.dim,
    async embed(texts, kind, signal) {
      clock += texts.length * (kind === "query" ? 40 : 100);
      return inner.embed(texts, kind, signal);
    },
    dispose: () => inner.dispose(),
  };
  return { engine, now: () => clock };
}

/** Plan KI-Harness P2a-6: the device check measures against the spike's budgets. */
describe("measuring search by meaning on a device", () => {
  it("measures sections per second and the query time over 20,000 sections, with sample text only", async () => {
    const { engine, now } = timedEngine();
    const measured = await measureEngine(engine, { now, queries: 10 });
    expect(measured.sectionsPerSecond).toBeCloseTo(10, 6);
    expect(measured.queryP95Ms).toBe(40);
    expect(SAMPLE_SECTIONS).toHaveLength(16);
    for (const section of SAMPLE_SECTIONS) expect(section.length).toBeGreaterThan(600);
  });

  it("builds the synthetic space in the size asked", () => {
    const index = syntheticIndex("test", 8, 25);
    expect(index.chunkCount).toBe(25);
    expect(index.search(new Float32Array(8).fill(0.1), 3)).toHaveLength(3);
  });

  it("judges a measurement against the budgets of its device class", () => {
    const fast = { engine: "e", sectionsPerSecond: 10, queryP95Ms: 60, peakMemoryBytes: 600 * 1024 * 1024, downloadBytes: 123e6 };
    const desktop = checkBudgets(fast, EMBEDDING_BUDGETS.desktop);
    expect(desktop.map((check) => [check.key, check.ok])).toEqual([
      ["firstRun", true],
      ["changedNote", true],
      ["query", true],
      ["memory", true],
      ["download", true],
    ]);
    expect(desktop[0]!.value).toBeCloseTo(5000 / 10 / 60, 6);
    // The phone's memory budget is half a gigabyte.
    expect(checkBudgets(fast, EMBEDDING_BUDGETS.phone).find((check) => check.key === "memory")!.ok).toBe(false);
    const slow = checkBudgets({ ...fast, sectionsPerSecond: 1, queryP95Ms: 250, peakMemoryBytes: null, downloadBytes: null }, EMBEDDING_BUDGETS.phone);
    expect(slow.map((check) => [check.key, check.ok])).toEqual([
      ["firstRun", false],
      ["changedNote", false],
      ["query", false],
    ]);
  });
});
