import { parseMarkdownAst, parseMarkdownTree } from "@plainva/core";

/**
 * „Speicher messen“ (L14, Gesamtplan Leistung § 3a.4, decision 5): the note
 * budget assumes 128 MB of heap, measured on Node; what the phone's WebView
 * gives the app is not known. This reads generated notes of growing size —
 * a linked list, prose, a table — with the app's own parses, measures the
 * heap where the engine says (Chromium's `performance.memory`; WKWebView says
 * nothing), and keeps the largest note read. Before each note it writes down
 * which one it attempts: a WebView that ends the app's process for its memory
 * leaves that word behind, and the next start reports it as the size that did
 * not fit. The result goes into the diagnostics export; no note's content does.
 */

const ATTEMPT_KEY = "plainva.memoryProbe.attempt";
const RESULT_KEY = "plainva.memoryProbe.result";

export interface MemoryProbeStep {
  form: string;
  /** The note's size, in characters. */
  chars: number;
  ms: number;
  /** The heap after the parses, in MB, where the engine says. */
  heapMb?: number;
}

export interface MemoryProbeResult {
  at: string;
  steps: MemoryProbeStep[];
  /** The largest note read, in characters. */
  largest: number;
  /** The note a previous run attempted and never finished: the app was ended while it read it. */
  endedAt?: { form: string; chars: number };
  /** Where the probe stopped on its own: every size read, or the time it was given ran out. */
  stopped: "all" | "time";
}

const FORMS: Record<string, (n: number) => string> = {
  list: (n) => Array.from({ length: n }, (_, i) => `- item ${i} [[Note ${i}]]`).join("\n"),
  prose: (n) => Array.from({ length: n }, (_, i) => `A line of prose, number ${i}, with a few words in it and a link to [[Note ${i % 50}]].`).join("\n"),
  table: (n) => `| a | b | c |\n|---|---|---|\n${Array.from({ length: n }, (_, i) => `| ${i} | [[Note ${i}]] | some words |`).join("\n")}`,
};

const heapMb = (): number | undefined => {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1e6) : undefined;
};

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The last probe's result, with a note an earlier run never finished — read once at start. */
export function memoryProbeResult(): MemoryProbeResult | null {
  const store = storage();
  if (!store) return null;
  try {
    const result = store.getItem(RESULT_KEY);
    const attempt = store.getItem(ATTEMPT_KEY);
    const parsed = result ? (JSON.parse(result) as MemoryProbeResult) : null;
    if (attempt) {
      // The app was ended while it read this note.
      const endedAt = JSON.parse(attempt) as { form: string; chars: number };
      const ended: MemoryProbeResult = { ...(parsed ?? { at: new Date().toISOString(), steps: [], largest: 0, stopped: "all" }), endedAt };
      store.setItem(RESULT_KEY, JSON.stringify(ended));
      store.removeItem(ATTEMPT_KEY);
      return ended;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Reads notes of each form at doubling sizes, from about 50 KB up to 16 MB or
 * until `seconds` have passed, each through the index parse and the
 * note-source parse. Yields to the page between notes, so that it stays usable.
 */
export async function runMemoryProbe(onStep?: (step: MemoryProbeStep) => void, seconds = 60): Promise<MemoryProbeResult> {
  const store = storage();
  const started = performance.now();
  const steps: MemoryProbeStep[] = [];
  let largest = 0;
  let stopped: MemoryProbeResult["stopped"] = "all";
  for (const [form, make] of Object.entries(FORMS)) {
    for (let n = 1_000; ; n *= 2) {
      if (performance.now() - started > seconds * 1000) {
        stopped = "time";
        break;
      }
      const text = `# Probe\n\n${make(n)}\n`;
      if (text.length > 16_000_000) break;
      store?.setItem(ATTEMPT_KEY, JSON.stringify({ form, chars: text.length }));
      const begun = performance.now();
      parseMarkdownAst(text, { preserveObsidianSyntax: true });
      parseMarkdownTree(text);
      const step = { form, chars: text.length, ms: Math.round(performance.now() - begun), heapMb: heapMb() };
      store?.removeItem(ATTEMPT_KEY);
      steps.push(step);
      largest = Math.max(largest, text.length);
      onStep?.(step);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (stopped === "time") break;
  }
  const result: MemoryProbeResult = { at: new Date().toISOString(), steps, largest, stopped };
  try {
    store?.setItem(RESULT_KEY, JSON.stringify(result));
  } catch {
    /* a result that does not fit storage is still returned */
  }
  return result;
}

/** The probe's lines for the diagnostics export (English, as the export is). */
export function memoryProbeLines(result: MemoryProbeResult | null): string[] {
  if (!result) return [];
  const mb = (chars: number) => `${(chars / 1e6).toFixed(2)} MB`;
  const lines = ["", "## Memory probe (generated notes, no note content)", "", `- At: ${result.at}`, `- Largest note read: ${mb(result.largest)}`, `- Stopped: ${result.stopped}`];
  if (result.endedAt) lines.push(`- The app was ended while reading: ${result.endedAt.form}, ${mb(result.endedAt.chars)}`);
  for (const step of result.steps) lines.push(`- ${step.form} ${mb(step.chars)}: ${step.ms} ms${step.heapMb !== undefined ? `, heap ${step.heapMb} MB` : ""}`);
  return lines;
}
