import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * The system's record of why this app last ended (Android 11+, plan
 * 2026-09-04 P1). Android 17's per-app memory limit kills an app that keeps
 * growing after it was squeezed into zRAM; the kill is invisible to the user
 * except as "the app was gone", and to the app except through this record.
 * Android only: iOS keeps no comparable list, and the desktop has no limiter.
 */
export interface ProcessExitInfo {
  /** `ApplicationExitInfo.getReason()` — see `classifyProcessExit`. */
  reason: number;
  /** Free text from the system; `MemoryLimiter:AnonSwap` marks the limiter. */
  description: string | null;
  /** ms since the epoch. */
  timestamp: number;
  importance: number;
}

interface ProcessExitNative {
  lastExits(): Promise<{ exits: ProcessExitInfo[] }>;
}

const ProcessExit = registerPlugin<ProcessExitNative>("ProcessExit");

/** Newest first; empty everywhere the platform has no record. */
export async function lastProcessExits(): Promise<ProcessExitInfo[]> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return [];
  try {
    return (await ProcessExit.lastExits()).exits ?? [];
  } catch {
    return [];
  }
}
