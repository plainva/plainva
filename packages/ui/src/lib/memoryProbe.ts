import { extractLinksAndTags, parseMarkdownAst, parseMarkdownTree } from "@plainva/core";

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
  /** Where the probe stopped on its own: every size read, the time it was given ran out, or the engine's heap filled. */
  stopped: "all" | "time" | "heap";
}

const FORMS: Record<string, (n: number) => string> = {
  list: (n) => Array.from({ length: n }, (_, i) => `- item ${i} [[Note ${i}]]`).join("\n"),
  prose: (n) => Array.from({ length: n }, (_, i) => `A line of prose, number ${i}, with a few words in it and a link to [[Note ${i % 50}]].`).join("\n"),
  table: (n) => `| a | b | c |\n|---|---|---|\n${Array.from({ length: n }, (_, i) => `| ${i} | [[Note ${i}]] | some words |`).join("\n")}`,
};

const memory = (): { usedJSHeapSize: number; jsHeapSizeLimit?: number } | undefined => (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit?: number } }).memory;
const heapMb = (): number | undefined => {
  const known = memory();
  return known ? Math.round(known.usedJSHeapSize / 1e6) : undefined;
};

/**
 * The largest note the probe reads: the note's budget is measured for notes
 * up to 10 MB (`perf:notes`, Performance_Notes.md); beyond, a note's text
 * alone, read as one line of stand-ins, outgrows a small heap. Until
 * 2026-11 the probe read up to 16 MB and could end the app itself, under
 * 128 MB on the first form.
 */
export const PROBE_MOST_CHARS = 8_000_000;
/** A step slower than this ends its form: the page is held while a note is read, and the next would take twice as long. */
export const PROBE_STEP_MS = 5_000;
/** Where the engine says how full its heap is: a step that leaves it fuller than this share ends the probe. */
export const PROBE_HEAP_SHARE = 0.6;

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
 * Reads notes of each form at doubling sizes, from about 50 KB up to
 * `PROBE_MOST_CHARS` or until `seconds` have passed, each as the index reads
 * it — the parse and the reading of its links and tags, a block read as text
 * in pieces — and through the note-source parse. Yields to the page between
 * notes, so that it stays usable. A form ends at a step slower than
 * `PROBE_STEP_MS`; the probe ends where the next note, twice the last, would
 * leave the heap fuller than `PROBE_HEAP_SHARE` by what the engine says of it
 * (Chromium; WKWebView says nothing, and there the size limit alone holds it),
 * and where it would end after `seconds`.
 */
export async function runMemoryProbe(onStep?: (step: MemoryProbeStep) => void, seconds = 60, now: () => number = () => performance.now()): Promise<MemoryProbeResult> {
  const store = storage();
  const started = now();
  const steps: MemoryProbeStep[] = [];
  let largest = 0;
  let stopped: MemoryProbeResult["stopped"] = "all";
  forms: for (const [form, make] of Object.entries(FORMS)) {
    let last = 0;
    let lastMs = 0;
    for (let n = 1_000; ; n *= 2) {
      // The next note is twice the last, and takes about twice its time: it is begun only where it ends in time
      // (review of L14, 2026-11-26: a step could begin at 59 s of 60).
      if (now() - started + 2 * lastMs > seconds * 1000) {
        stopped = "time";
        break forms;
      }
      // Twice the last size, at least: a note that would be too large is not made.
      if (last * 2 > PROBE_MOST_CHARS) break;
      const text = `# Probe\n\n${make(n)}\n`;
      const chars = text.length;
      last = chars;
      if (chars > PROBE_MOST_CHARS) break;
      store?.setItem(ATTEMPT_KEY, JSON.stringify({ form, chars }));
      const begun = now();
      const ast = parseMarkdownAst(text, { preserveObsidianSyntax: true });
      extractLinksAndTags(ast, text);
      parseMarkdownTree(text);
      const step = { form, chars, ms: Math.round(now() - begun), heapMb: heapMb() };
      store?.removeItem(ATTEMPT_KEY);
      steps.push(step);
      largest = Math.max(largest, chars);
      onStep?.(step);
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastMs = step.ms;
      // The next note is twice as large: it is read only where twice the heap it left stays within the share.
      const known = memory();
      if (known?.jsHeapSizeLimit && 2 * known.usedJSHeapSize > PROBE_HEAP_SHARE * known.jsHeapSizeLimit) {
        stopped = "heap";
        break forms;
      }
      if (step.ms > PROBE_STEP_MS) break;
    }
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
