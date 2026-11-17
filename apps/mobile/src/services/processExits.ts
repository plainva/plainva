/**
 * "Did the system end Plainva, and why?" — kept on the device and shown in
 * the sync diagnostics (plan 2026-09-04, P1).
 *
 * Android 17 kills an app that outgrows its per-app memory budget. Without
 * this record the only symptom is "the app was gone when I came back", and
 * the question whether Plainva has a leak can only be guessed at. The system
 * remembers the last exits of a package; on every start the new ones are
 * classified and appended to a short list in the settings store.
 *
 * Every exit is kept now (release list F51: an ANR every minute left nothing
 * in the diagnostics export), with the build that ran, and for an ANR or a
 * Java crash the frames the system or the app's own handler kept - scrubbed of
 * paths, addresses and file names and bounded (`boundedProcessExit`). The
 * screen still shows only the exits a person can act on; the export carries
 * all of them, newest first, at most ten.
 */
import { boundedProcessExit, getPlatformServices, type DiagnosticsProcessExit } from "@plainva/ui";
import { lastProcessExits, type ProcessExitInfo } from "../platform/processExit";
import { readDiagnosticsRecord, writeDiagnosticsRecord } from "../platform/diagnosticsStore";

export type ProcessExitKind = "memory-limiter" | "low-memory" | "excessive-resources" | "crash" | "anr" | "hang" | "user" | "other";

/** One exit as kept; its `description`, `exception` and `frames` are scrubbed. */
export interface ProcessExitRecord extends DiagnosticsProcessExit {
  kind: ProcessExitKind;
}

/** `ApplicationExitInfo` reason codes this record cares about. */
const REASON_LOW_MEMORY = 3;
const REASON_CRASH = 4;
const REASON_CRASH_NATIVE = 5;
const REASON_ANR = 6;
const REASON_EXCESSIVE_RESOURCE_USAGE = 9;
const REASON_USER_REQUESTED = 10;
const REASON_USER_STOPPED = 11;
/** iOS (MetricKit): a hang of the main thread - Android has no such code (`ProcessExitPlugin.swift`). */
const REASON_HANG = 100;

const KEEP = 10;
/** Of the exits nobody acts on (closed by the person, an update, …), the most that are kept. */
const OTHERS = 3;
/** Where an older version kept them, in the settings. */
const RECORDS_KEY = "process-exits";
const SEEN_KEY = "process-exits-seen";
const EXITS_FILE = "process-exits";

/** What an exit was. */
export function classifyProcessExit(info: { reason: number; description?: string | null }): ProcessExitKind {
  // The limiter names itself in the description, under REASON_OTHER or a
  // signal — the description is the reliable part.
  if (/MemoryLimiter/i.test(info.description ?? "")) return "memory-limiter";
  switch (info.reason) {
    case REASON_LOW_MEMORY: return "low-memory";
    case REASON_EXCESSIVE_RESOURCE_USAGE: return "excessive-resources";
    case REASON_CRASH:
    case REASON_CRASH_NATIVE: return "crash";
    case REASON_ANR: return "anr";
    case REASON_HANG: return "hang";
    case REASON_USER_REQUESTED:
    case REASON_USER_STOPPED: return "user";
    default: return "other";
  }
}

/** Whether the diagnostics screen names this exit: the ones a person can act on. */
export function isShownProcessExit(kind: ProcessExitKind): boolean {
  return kind !== "user" && kind !== "other";
}

/**
 * Folds the system's list into what is already known: only exits newer than
 * `seenUntil` are added, newest first, at most `KEEP`. Pure, so the boot
 * path is one line and the folding is testable.
 */
export function mergeProcessExits(
  known: readonly ProcessExitRecord[],
  fresh: readonly ProcessExitInfo[],
  seenUntil: number,
): { records: ProcessExitRecord[]; seenUntil: number } {
  let newest = seenUntil;
  const added: ProcessExitRecord[] = [];
  for (const info of fresh) {
    if (!(info.timestamp > seenUntil)) continue;
    newest = Math.max(newest, info.timestamp);
    const kind = classifyProcessExit(info);
    added.push(boundedProcessExit({
      at: new Date(info.timestamp).toISOString(),
      kind,
      ...(info.description ? { description: info.description } : {}),
      ...(info.build ? { build: info.build } : {}),
      ...(info.exception ? { exception: info.exception } : {}),
      ...(info.frames?.length ? { frames: info.frames } : {}),
    }) as ProcessExitRecord);
  }
  // Newest first, at most KEEP - and a closed app or an update never pushes a
  // crash, an ANR or a memory kill out: of those, at most OTHERS are kept.
  let others = 0;
  const records = [...added, ...known]
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((record) => isShownProcessExit(record.kind) || ++others <= OTHERS)
    .slice(0, KEEP);
  return { records, seenUntil: newest };
}

/** What is kept: the exits, and the newest time already looked at (`diagnosticsStore.ts`, outside every backup). */
interface KeptExits {
  records: ProcessExitRecord[];
  seenUntil: number;
}

async function readKept(): Promise<KeptExits> {
  const kept = await readDiagnosticsRecord<KeptExits>(EXITS_FILE);
  if (kept && Array.isArray(kept.records)) return { records: kept.records, seenUntil: Number(kept.seenUntil) || 0 };
  // An older version kept them in the settings, which the system backup takes along: moved here once.
  const store = await getPlatformServices().loadSettings();
  const records = (await store.get<ProcessExitRecord[]>(RECORDS_KEY)) ?? [];
  const seenUntil = (await store.get<number>(SEEN_KEY)) ?? 0;
  const moved = { records: Array.isArray(records) ? records.map((record) => boundedProcessExit(record) as ProcessExitRecord) : [], seenUntil };
  await writeDiagnosticsRecord(EXITS_FILE, moved);
  await store.delete(RECORDS_KEY);
  await store.delete(SEEN_KEY);
  await store.save();
  return moved;
}

export async function loadProcessExits(): Promise<ProcessExitRecord[]> {
  try {
    // Scrubbed again as read: a record an older build kept had the system's words unscrubbed.
    return (await readKept()).records.map((record) => boundedProcessExit(record) as ProcessExitRecord);
  } catch {
    return [];
  }
}

/** On every start: what the system says happened since the last look - and only that is read. */
export async function recordProcessExitsOnBoot(): Promise<ProcessExitRecord[]> {
  const kept = await readKept();
  const fresh = await lastProcessExits(kept.seenUntil);
  const merged = mergeProcessExits(kept.records, fresh, kept.seenUntil);
  if (merged.seenUntil !== kept.seenUntil) await writeDiagnosticsRecord(EXITS_FILE, merged);
  return merged.records;
}

/** The i18n key that names an exit to the user (only for `isShownProcessExit` kinds). */
export function processExitLabelKey(kind: ProcessExitKind): string {
  switch (kind) {
    case "memory-limiter":
    case "low-memory":
    case "excessive-resources":
      return "settingsSync.diagExitMemory";
    case "crash":
      return "settingsSync.diagExitCrash";
    case "anr":
      return "settingsSync.diagExitAnr";
    case "hang":
      return "settingsSync.diagExitHang";
    case "user":
    case "other":
      // Not shown on the screen (`isShownProcessExit`); the section's own name.
      return "settingsSync.diagProcessExits";
  }
}

/**
 * The frames a screenshot needs: the exception's class, then for an ANR the
 * main thread's - its Java frames first. A real dump begins with the
 * runtime's native frames (`libc.so`, `libart.so` ...); the lines that name
 * the place (`JSONTokener.nextString`, `MessageHandler.postMessage`) come
 * after them and would not fit in eight lines. The export keeps the full order.
 */
export function topFrames(exit: Pick<ProcessExitRecord, "exception" | "frames">): string[] {
  const frames = exit.frames ?? [];
  const main = frames.filter((frame) => frame.startsWith("main: "));
  // Each method once: a parser that recurses (`JSONTokener.nextValue`, `readObject` ...) would fill the lines.
  const seen = new Set<string>();
  const mainJava = main.filter((frame) => {
    if (!frame.startsWith("main: at ")) return false;
    const bracket = frame.indexOf("(");
    const method = bracket < 0 ? frame : frame.slice(0, bracket);
    if (seen.has(method)) return false;
    seen.add(method);
    return true;
  });
  const ordered = main.length > 0
    ? [...(mainJava.length > 0 ? [...mainJava, ...main.filter((frame) => !frame.startsWith("main: at "))] : main), ...frames.filter((frame) => !frame.startsWith("main: "))]
    : frames;
  return [...(exit.exception ? [exit.exception] : []), ...ordered].slice(0, 8);
}
