import { expect } from "vitest";

/**
 * A time budget measured on the core the test runs on (Sammelplan § 3.129
 * Nr. 4, § 3.151 Nr. 5, § 3.162 Nr. 2).
 *
 * The linear-time tests give a pathological input a budget on the wall clock:
 * a scan that turned quadratic takes seconds or minutes where the budget says
 * one. A fixed number of milliseconds, though, measures the core as much as
 * the code. On a laptop with efficiency cores the same parse took between 0.7
 * and 5.9 s depending on the core it ran on, and under a commit hook with
 * twenty sessions side by side every test's thread is slower: budgets that
 * held in CI failed there, a different test each time, with nothing wrong in
 * the code.
 *
 * So a budget is a number of milliseconds on a reference core, and where a
 * run goes over it the core is measured: a fixed piece of linear work — split
 * lines, a regular expression, a map, a loop over characters, the kind of work
 * the scanners do — timed right after the run, against what it costs on the
 * core the budgets were written on. A core that is four times slower right
 * now gets four times the budget, up to `MAX_SLOWDOWN`. The run is then timed
 * once more, so a burst of load that came and went during the first run does
 * not decide alone. A scan that turned quadratic stays caught: it costs a
 * hundred to ten thousand times its budget, far beyond any core's slowdown.
 *
 * A run within its budget costs nothing extra.
 */

/** What the reference work costs on the core the budgets were written on, in ms (measured warm, 2026-11-02). */
const REFERENCE_MS = 6;
/** The most a budget grows: an efficiency core under load measured 8× slower than a performance core. */
export const MAX_SLOWDOWN = 16;

const LINE = "- [ ] a task with [[a link|alias]] and #tag and **bold** text 12345\n";
const TEXT = LINE.repeat(16_000);
const LINK = /\[\[([^\]|]*)(?:\|[^\]]*)?\]\]/;
let sink = 0;

function referenceOnce(): number {
  const start = performance.now();
  const counts = new Map<string, number>();
  for (const line of TEXT.split("\n")) {
    const match = LINK.exec(line);
    const key = match ? match[1] : line.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    for (let i = 0; i < line.length; i++) sink = (sink * 31 + line.charCodeAt(i)) | 0;
  }
  sink += counts.size;
  return performance.now() - start;
}

let warm = false;

/** How much slower this core is right now than the reference core: at least 1, at most `MAX_SLOWDOWN`. */
export function coreSlowdown(): number {
  if (!warm) {
    referenceOnce();
    referenceOnce();
    warm = true;
  }
  const runs = [referenceOnce(), referenceOnce(), referenceOnce()].sort((a, b) => a - b);
  return Math.min(MAX_SLOWDOWN, Math.max(1, runs[1] / REFERENCE_MS));
}

function verdict(budgetMs: number, first: number, again: number, slowdown: number): void {
  const took = Math.min(first, again);
  expect(
    took,
    `took ${first.toFixed(0)} ms and ${again.toFixed(0)} ms; the budget is ${budgetMs} ms on the reference core, ` +
      `${(budgetMs * slowdown).toFixed(0)} ms on this one (${slowdown.toFixed(1)}× slower right now)`,
  ).toBeLessThan(budgetMs * slowdown);
}

/**
 * `run` finishes within `budgetMs` on the reference core — scaled to this
 * core when it does not. Returns what `run` returned (its second run's, where
 * it ran twice); `run` must therefore be work that can be repeated.
 */
export function within<T>(budgetMs: number, run: () => T): T {
  let start = performance.now();
  let result = run();
  const first = performance.now() - start;
  if (first < budgetMs) return result;
  const slowdown = coreSlowdown();
  start = performance.now();
  result = run();
  verdict(budgetMs, first, performance.now() - start, slowdown);
  return result;
}

/** The same for work that is awaited. */
export async function withinAsync<T>(budgetMs: number, run: () => T | Promise<T>): Promise<T> {
  let start = performance.now();
  let result = await run();
  const first = performance.now() - start;
  if (first < budgetMs) return result;
  const slowdown = coreSlowdown();
  start = performance.now();
  result = await run();
  verdict(budgetMs, first, performance.now() - start, slowdown);
  return result;
}
