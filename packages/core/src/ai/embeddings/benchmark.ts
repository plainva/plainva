/**
 * The device check of search by meaning measures this device against the
 * budgets of the embedding spike (plan KI-Harness P2a-6, §10.5): the first
 * run over 5,000 sections, a changed note found again, a question answered
 * over 20,000 sections, the app's memory at its peak, the download.
 *
 * It measures with sample text, never with the vault's notes: nothing of a
 * note leaves the device for a measurement, and two devices measure the same
 * thing. The query runs over a synthetic space of 20,000 sections — brute
 * force costs the same per row whatever the rows mean.
 */
import { GOLDEN_TEXT } from "./catalog.js";
import type { EmbeddingEngine } from "./engine.js";
import { EMBEDDING_SETTLE_MS } from "./schedule.js";
import { VectorIndex } from "./search.js";
import { quantizeInt8, type QuantizedVector } from "./vectors.js";

export type DeviceClass = "desktop" | "phone";

export interface EmbeddingBudget {
  firstRunMinutes: number;
  changedNoteSeconds: number;
  queryMs: number;
  memoryBytes: number;
  downloadBytes: number;
}

/** The spike report's proposal for the P2a gate (2026-09-30). */
export const EMBEDDING_BUDGETS: Record<DeviceClass, EmbeddingBudget> = {
  desktop: { firstRunMinutes: 30, changedNoteSeconds: 5, queryMs: 100, memoryBytes: 1024 * 1024 * 1024, downloadBytes: 150e6 },
  phone: { firstRunMinutes: 60, changedNoteSeconds: 5, queryMs: 100, memoryBytes: 500 * 1024 * 1024, downloadBytes: 150e6 },
};

/** The yardsticks: a first run over 5,000 sections, a question over 20,000, a changed note of four sections. */
export const FIRST_RUN_SECTIONS = 5_000;
export const QUERY_SECTIONS = 20_000;
export const CHANGED_NOTE_SECTIONS = 4;

/** Sections of about 700 characters, two scripts in each, like a note's section on average. */
export const SAMPLE_SECTIONS: readonly string[] = Array.from({ length: 16 }, (_, i) => `${i + 1}. ${`${GOLDEN_TEXT} `.repeat(14)}`.trim());

const QUESTIONS: readonly string[] = [
  "wie teilen wir die Drehtage auf",
  "split the shoot into two blocks",
  "compte rendu de la réunion",
  "会議の議事録はどこ",
  "项目的下一步是什么",
];

export interface EmbeddingMeasurement {
  engine: string;
  /** Sections embedded per second, as the pipeline hands them over. */
  sectionsPerSecond: number;
  /** A question embedded and searched over 20,000 sections, 95th percentile. */
  queryP95Ms: number;
  /** The app's memory at its peak, where the shell can say. */
  peakMemoryBytes: number | null;
  /** The package's size; null for an own provider. */
  downloadBytes: number | null;
}

export type BudgetKey = "firstRun" | "changedNote" | "query" | "memory" | "download";

export interface BudgetCheck {
  key: BudgetKey;
  value: number;
  budget: number;
  ok: boolean;
}

/** Minutes for the first run, seconds for a changed note (its wait after the last change included), ms, bytes. */
export function checkBudgets(measurement: EmbeddingMeasurement, budget: EmbeddingBudget): BudgetCheck[] {
  const rate = Math.max(measurement.sectionsPerSecond, 1e-9);
  const firstRun = FIRST_RUN_SECTIONS / rate / 60;
  const changed = EMBEDDING_SETTLE_MS / 1000 + CHANGED_NOTE_SECTIONS / rate;
  const checks: BudgetCheck[] = [
    { key: "firstRun", value: firstRun, budget: budget.firstRunMinutes, ok: firstRun <= budget.firstRunMinutes },
    { key: "changedNote", value: changed, budget: budget.changedNoteSeconds, ok: changed <= budget.changedNoteSeconds },
    { key: "query", value: measurement.queryP95Ms, budget: budget.queryMs, ok: measurement.queryP95Ms <= budget.queryMs },
  ];
  if (measurement.peakMemoryBytes !== null) {
    checks.push({ key: "memory", value: measurement.peakMemoryBytes, budget: budget.memoryBytes, ok: measurement.peakMemoryBytes <= budget.memoryBytes });
  }
  if (measurement.downloadBytes !== null) {
    checks.push({ key: "download", value: measurement.downloadBytes, budget: budget.downloadBytes, ok: measurement.downloadBytes <= budget.downloadBytes });
  }
  return checks;
}

/** A space of `rows` sections in `dim` dimensions, filled deterministically: only its size matters. */
export function syntheticIndex(engine: string, dim: number, rows: number): VectorIndex {
  const index = new VectorIndex(engine, dim);
  let seed = 0x9e3779b9;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 0xffffffff) * 2 - 1;
  };
  const perNote = 10;
  for (let note = 0; note * perNote < rows; note++) {
    const chunks: { ordinal: number; hash: string; vector: QuantizedVector }[] = [];
    for (let ordinal = 0; ordinal < perNote && note * perNote + ordinal < rows; ordinal++) {
      const vector = new Float32Array(dim);
      for (let i = 0; i < dim; i++) vector[i] = random();
      chunks.push({ ordinal, hash: `${note}:${ordinal}`, vector: quantizeInt8(vector) });
    }
    index.setNote(`sample/${note}.md`, `${note}`, chunks);
  }
  return index;
}

function percentile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))] ?? 0;
}

/**
 * Throughput and query time of an engine on this device. The sections go in
 * one call, the way the pipeline hands a step to the engine (a package embeds
 * them one by one natively, a provider in batches); every question is
 * embedded and searched on its own.
 */
export async function measureEngine(
  engine: EmbeddingEngine,
  options: { now?: () => number; signal?: AbortSignal; queries?: number; rows?: number } = {},
): Promise<Pick<EmbeddingMeasurement, "engine" | "sectionsPerSecond" | "queryP95Ms">> {
  const now = options.now ?? (() => performance.now());
  const start = now();
  await engine.embed(SAMPLE_SECTIONS, "document", options.signal);
  const seconds = Math.max((now() - start) / 1000, 1e-6);
  const index = syntheticIndex(engine.id, engine.dim, options.rows ?? QUERY_SECTIONS);
  // The first search packs the space; that happens once, when the vectors load, not per question.
  index.search(new Float32Array(engine.dim), 1);
  const times: number[] = [];
  for (let i = 0; i < (options.queries ?? 20); i++) {
    options.signal?.throwIfAborted();
    const began = now();
    const [question] = await engine.embed([QUESTIONS[i % QUESTIONS.length]!], "query", options.signal);
    index.search(question!, 10);
    times.push(now() - began);
  }
  return { engine: engine.id, sectionsPerSecond: SAMPLE_SECTIONS.length / seconds, queryP95Ms: percentile(times, 0.95) };
}
