/**
 * In-app performance metrics (hardening plan P1.1): a tiny local recorder
 * behind the measurement points named in docs/engineering/Performance_Notes.md
 * — initial index, incremental index, sidebar search, base query, and a
 * typing-latency sampler (keydown → next frame). Everything stays ON DEVICE:
 * the settings "About & diagnostics" section renders the table and offers a
 * JSON export via the OS save dialog; nothing is ever sent anywhere.
 *
 * Budgets are judged against PRODUCTION builds — dev-mode numbers are for
 * hotspot hunting only (the export marks the mode for that reason).
 */

const MAX_SAMPLES = 200;
const samples = new Map<string, number[]>();

export function perfRecord(name: string, ms: number): void {
  let arr = samples.get(name);
  if (!arr) {
    arr = [];
    samples.set(name, arr);
  }
  arr.push(ms);
  if (arr.length > MAX_SAMPLES) arr.shift();
}

/** Wraps an async operation and records its wall-clock duration. */
export async function perfMeasure<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    perfRecord(name, performance.now() - t0);
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function p95(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
}

export interface PerfStat {
  name: string;
  count: number;
  medianMs: number;
  p95Ms: number;
  lastMs: number;
}

export function perfStats(): PerfStat[] {
  const round = (n: number) => Math.round(n * 100) / 100;
  return Array.from(samples.entries())
    .map(([name, values]) => ({
      name,
      count: values.length,
      medianMs: round(median(values)),
      p95Ms: round(p95(values)),
      lastMs: round(values[values.length - 1] ?? 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function perfExportJson(): string {
  return JSON.stringify(
    {
      app: "plainva-desktop",
      mode: import.meta.env.PROD ? "production" : "development",
      exportedAt: new Date().toISOString(),
      stats: perfStats(),
      samples: Object.fromEntries(Array.from(samples.entries()).map(([k, v]) => [k, v.map((n) => Math.round(n * 100) / 100)])),
    },
    null,
    2
  );
}

/** Test/reset hook. */
export function perfReset(): void {
  samples.clear();
}

/**
 * Typing latency: keydown (printable keys inside the editor) → next animation
 * frame. Throttled to one sample per 100 ms so the listener itself stays
 * invisible. Approximates "keystroke to paint" (p50/p95 in the stats table).
 */
export function installTypingLatencySampler(): () => void {
  if (typeof document === "undefined") return () => {};
  let lastSampleAt = 0;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.(".cm-content")) return;
    const now = performance.now();
    if (now - lastSampleAt < 100) return;
    lastSampleAt = now;
    requestAnimationFrame(() => perfRecord("typing keystroke→frame", performance.now() - now));
  };
  document.addEventListener("keydown", onKeyDown, { capture: true, passive: true });
  return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
}
