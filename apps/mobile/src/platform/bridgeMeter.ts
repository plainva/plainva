import { readDiagnosticsRecord, writeDiagnosticsRecord } from "./diagnosticsStore";

/**
 * The largest messages over the Capacitor bridge, per plugin method and
 * direction, in this run and in the one before (release list F51).
 *
 * The phone froze a few seconds after every start - without a network and
 * with no note open - and the system's record named an ANR: the main thread
 * blocked for five seconds. Every call's text is parsed on Android's UI thread
 * before a plugin runs, and every answer is turned into a JavaScript call on
 * the way back, so one large message is enough. This meter says which one:
 * each call of `window.Capacitor.toNative` (every plugin method of both
 * platforms goes through it) is measured on the way out, and its answer on
 * the way in. Only the largest few are kept, with the method's name, the size
 * and the time - never what the message held.
 *
 * A run that ends in a freeze cannot be exported, so the peaks are written
 * down soon after the kept list changes, and the next start keeps them as
 * "the run before" for the export. They are kept where no backup takes them
 * along (`diagnosticsStore.ts`), not in the settings.
 */

/** A message at least this large is kept (characters of its text, about bytes). */
const NOTEWORTHY = 64 * 1024;
/** How many peaks a run keeps. */
const KEEP = 12;
/** How long after a new peak it is written down: a freeze a few seconds later still finds it there. */
const WRITE_AFTER_MS = 1500;
const STORE_KEY = "bridge-peaks";

export interface BridgePeak {
  /** `Plugin.method`. */
  call: string;
  direction: "out" | "in";
  /** Characters of the message's text, about its bytes. */
  size: number;
  /** ISO time. */
  at: string;
}

export interface BridgeRun {
  /** ISO time the run began. */
  startedAt: string;
  peaks: BridgePeak[];
}

const run: BridgeRun = { startedAt: new Date().toISOString(), peaks: [] };
let previous: BridgeRun | null = null;
let installed = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
/** The run before is read before this run's first write, so it is never this run. */
let loaded: Promise<void> = Promise.resolve();

/**
 * About the length of a message's text, without making it: the sum of the
 * strings' lengths and a few characters per other value, the walk bounded.
 */
export function messageSize(value: unknown): number {
  let size = 0;
  let nodes = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0 && nodes < 500_000) {
    const item = stack.pop();
    nodes += 1;
    if (typeof item === "string") size += item.length + 2;
    else if (typeof item === "number" || typeof item === "boolean") size += 8;
    else if (item === null || item === undefined) size += 4;
    else if (Array.isArray(item)) {
      size += 2;
      for (const entry of item) stack.push(entry);
    } else if (typeof item === "object") {
      size += 2;
      for (const [key, entry] of Object.entries(item as Record<string, unknown>)) {
        size += key.length + 3;
        stack.push(entry);
      }
    }
  }
  return size;
}

/**
 * Records one message; pure enough to test (`run` is this lifetime's). True
 * only when the kept list changed - a message that does not make it among the
 * largest `KEEP` changes nothing, and nothing is written for it.
 */
export function noteBridgeMessage(call: string, direction: "out" | "in", size: number, target: BridgeRun = run): boolean {
  if (size < NOTEWORTHY) return false;
  const same = target.peaks.find((peak) => peak.call === call && peak.direction === direction);
  if (same) {
    if (same.size >= size) return false;
    same.size = size;
    same.at = new Date().toISOString();
    target.peaks.sort((a, b) => b.size - a.size);
    return true;
  }
  if (target.peaks.length >= KEEP && size <= target.peaks[target.peaks.length - 1].size) return false;
  target.peaks.push({ call, direction, size, at: new Date().toISOString() });
  target.peaks.sort((a, b) => b.size - a.size);
  target.peaks.length = Math.min(target.peaks.length, KEEP);
  return true;
}

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void loaded.then(() => writeDiagnosticsRecord(STORE_KEY, run)).catch(() => {
      // silent: a diagnostic that cannot be written is left out of the next export, never an error of its own.
    });
  }, WRITE_AFTER_MS);
}

interface BridgeCallbacks {
  resolve?: (data: unknown) => void;
  callback?: (data: unknown, error?: unknown) => void;
  [key: string]: unknown;
}

type ToNative = (pluginName: string, methodName: string, options: unknown, stored: BridgeCallbacks) => unknown;

/**
 * Measures every plugin call from now on. Installed first thing at start;
 * outside a native shell there is no bridge and nothing happens.
 */
export function installBridgeMeter(): void {
  if (installed) return;
  installed = true;
  loaded = readDiagnosticsRecord<BridgeRun>(STORE_KEY, STORE_KEY).then((last) => {
    if (last && Array.isArray(last.peaks)) previous = last;
  }).catch(() => {
    // silent: no earlier run to show.
  });
  const cap = (globalThis as { Capacitor?: { toNative?: ToNative } }).Capacitor;
  const toNative = cap?.toNative;
  if (!cap || typeof toNative !== "function") return;
  cap.toNative = (pluginName, methodName, options, stored) => {
    const call = `${pluginName}.${methodName}`;
    // Not the meter's own writes, and nothing from the console bridge.
    const measured = pluginName !== "Console";
    if (measured && noteBridgeMessage(call, "out", messageSize(options))) scheduleWrite();
    let wrapped = stored;
    if (measured && stored) {
      wrapped = { ...stored };
      if (typeof stored.resolve === "function") {
        const resolve = stored.resolve;
        wrapped.resolve = (data: unknown) => {
          if (noteBridgeMessage(call, "in", messageSize(data))) scheduleWrite();
          resolve(data);
        };
      }
      if (typeof stored.callback === "function") {
        const callback = stored.callback;
        wrapped.callback = (data: unknown, error?: unknown) => {
          if (noteBridgeMessage(call, "in", messageSize(data))) scheduleWrite();
          callback(data, error);
        };
      }
    }
    return toNative.call(cap, pluginName, methodName, options, wrapped);
  };
}

/** This run's peaks and the run's before, for the export. */
export function bridgePeaks(): BridgeRun[] {
  return [run, ...(previous ? [previous] : [])].map((entry) => ({ startedAt: entry.startedAt, peaks: entry.peaks.slice(0, KEEP) }));
}

/** Tests only. */
export function resetBridgeMeterForTests(): void {
  run.peaks.length = 0;
  previous = null;
  installed = false;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
}
