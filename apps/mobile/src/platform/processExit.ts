import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * The system's record of why this app last ended (Android 11+, plan
 * 2026-09-04 P1). Android 17's per-app memory limit kills an app that keeps
 * growing after it was squeezed into zRAM; the kill is invisible to the user
 * except as "the app was gone", and to the app except through this record.
 * Android, and iOS through MetricKit (`ProcessExitPlugin.swift`, release list
 * F51): a crash and a hang come back as exits with the reason codes Android
 * uses (4, 6), a memory kill only as a daily count. The desktop keeps no such
 * record.
 */
export interface ProcessExitInfo {
  /** `ApplicationExitInfo.getReason()` — see `classifyProcessExit`. */
  reason: number;
  /** Free text from the system; `MemoryLimiter:AnonSwap` marks the limiter. */
  description: string | null;
  /** ms since the epoch. */
  timestamp: number;
  importance: number;
  /** The build that ran then (`setProcessStateSummary`), e.g. `0.8.7.8 (154)`. */
  build?: string;
  /** A Java crash: the exception's class (never its message). */
  exception?: string;
  /** Frame lines: for an ANR the main thread's and "CapacitorPlugins", for a crash the exception's. */
  frames?: string[];
}

/** iOS: how often the system ended the app on one day, by cause - a daily count, no time of day. */
export interface ProcessExitDay {
  /** `yyyy-MM-dd`. */
  day: string;
  memory: number;
  other: number;
}

interface ProcessExitNative {
  lastExits(): Promise<{ exits: ProcessExitInfo[]; days?: ProcessExitDay[] }>;
}

const ProcessExit = registerPlugin<ProcessExitNative>("ProcessExit");

/** Newest first; empty everywhere the platform has no record. */
export async function lastProcessExits(): Promise<ProcessExitInfo[]> {
  return (await readNative()).exits;
}

/** iOS' daily counts, newest first; empty elsewhere. */
export async function lastProcessExitDays(): Promise<ProcessExitDay[]> {
  return (await readNative()).days;
}

async function readNative(): Promise<{ exits: ProcessExitInfo[]; days: ProcessExitDay[] }> {
  if (!Capacitor.isNativePlatform()) return { exits: [], days: [] };
  try {
    const answer = await ProcessExit.lastExits();
    return { exits: answer.exits ?? [], days: (answer.days ?? []).slice(0, 7) };
  } catch {
    return { exits: [], days: [] };
  }
}
