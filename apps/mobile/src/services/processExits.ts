/**
 * "Did the system end Plainva, and why?" — kept on the device and shown in
 * the sync diagnostics (plan 2026-09-04, P1).
 *
 * Android 17 kills an app that outgrows its per-app memory budget. Without
 * this record the only symptom is "the app was gone when I came back", and
 * the question whether Plainva has a leak can only be guessed at. The system
 * remembers the last exits of a package; on every start the new ones are
 * classified and appended to a short list in the settings store. Only exits
 * a person can act on are kept — a normal swipe-away or an update is noise.
 */
import { getPlatformServices } from "@plainva/ui";
import { lastProcessExits, type ProcessExitInfo } from "../platform/processExit";

export type ProcessExitKind = "memory-limiter" | "low-memory" | "excessive-resources" | "crash" | "anr";

export interface ProcessExitRecord {
  /** ISO timestamp of the exit. */
  at: string;
  kind: ProcessExitKind;
  /** The system's own words, when it had any (e.g. `MemoryLimiter:AnonSwap`). */
  description?: string;
}

/** `ApplicationExitInfo` reason codes this record cares about. */
const REASON_SIGNALED = 2;
const REASON_LOW_MEMORY = 3;
const REASON_CRASH = 4;
const REASON_CRASH_NATIVE = 5;
const REASON_ANR = 6;
const REASON_EXCESSIVE_RESOURCE_USAGE = 9;
const REASON_OTHER = 13;

const KEEP = 10;
const RECORDS_KEY = "process-exits";
const SEEN_KEY = "process-exits-seen";

/** What an exit was, or null for the ones nobody needs to know about. */
export function classifyProcessExit(info: { reason: number; description?: string | null }): ProcessExitKind | null {
  // The limiter names itself in the description, under REASON_OTHER or a
  // signal — the description is the reliable part.
  if (/MemoryLimiter/i.test(info.description ?? "")) return "memory-limiter";
  switch (info.reason) {
    case REASON_LOW_MEMORY: return "low-memory";
    case REASON_EXCESSIVE_RESOURCE_USAGE: return "excessive-resources";
    case REASON_CRASH:
    case REASON_CRASH_NATIVE: return "crash";
    case REASON_ANR: return "anr";
    case REASON_SIGNALED:
    case REASON_OTHER:
    default: return null;
  }
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
    if (!kind) continue;
    added.push({
      at: new Date(info.timestamp).toISOString(),
      kind,
      ...(info.description ? { description: info.description } : {}),
    });
  }
  const records = [...added, ...known]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, KEEP);
  return { records, seenUntil: newest };
}

export async function loadProcessExits(): Promise<ProcessExitRecord[]> {
  try {
    const store = await getPlatformServices().loadSettings();
    const raw = await store.get<ProcessExitRecord[]>(RECORDS_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** On every start: what the system says happened since the last look. */
export async function recordProcessExitsOnBoot(): Promise<ProcessExitRecord[]> {
  const fresh = await lastProcessExits();
  const store = await getPlatformServices().loadSettings();
  const known = await loadProcessExits();
  const seenUntil = (await store.get<number>(SEEN_KEY)) ?? 0;
  const merged = mergeProcessExits(known, fresh, seenUntil);
  if (merged.seenUntil !== seenUntil) {
    await store.set(RECORDS_KEY, merged.records);
    await store.set(SEEN_KEY, merged.seenUntil);
    await store.save();
  }
  return merged.records;
}

/** The i18n key that names an exit to the user. */
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
  }
}
