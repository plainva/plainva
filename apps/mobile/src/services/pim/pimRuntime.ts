import { PimCacheRepository, PimWorker, type IPimTarget, type PimAccountRow, type PimCycleInfo, type PimStatus } from "@plainva/core";
import { isDevicePimSupported, onDevicePimChanged } from "../../platform/devicePim";
import { startTaskSyncRuntime, stopTaskSyncRuntime, runMobileTaskSync } from "./taskSyncRuntime";
import type { MobileVault } from "../vaultService";

/**
 * The phone's PIM runtime (calendar and tasks): one cache repository and one
 * pull worker per open vault, the status store the calendar screen's chip
 * reads, and the triggers that ask the worker for a cycle. Status and data
 * travel over window events so screens just re-query:
 *   m-pim-changed  — cache has fresh data, re-query
 *
 * Split from pimService (Befunde 2026-09-24, Z2). The runtime needs the core's
 * worker and cache and nothing else; what reaches for the stored sign-ins, the
 * provider clients and the diagnostics log — and through them the whole shared
 * UI package, half a minute of module loading in a unit test — is handed in by
 * pimService as `PimRuntimeWiring`. pimService re-exports everything here, so
 * the app keeps importing from one place.
 */

/** What the runtime needs from the phone and cannot load itself without the
 * sign-in store and the provider clients (pimService supplies it). */
export interface PimRuntimeWiring {
  /** A ready provider target for the account, built per cycle from its stored
   * sign-in — never cached, a rotated token must be read again. */
  buildTarget(vaultId: string, account: PimAccountRow): Promise<IPimTarget | null>;
  /** The opaque sign-in revision of an account, never a token. */
  accountAuthRevision(vaultId: string, account: PimAccountRow): Promise<string | undefined>;
  /** What the status says when every account sits on a dead sign-in (N1/S2),
   * already translated. */
  parkedMessage: string;
  /** One line per finished cycle for the diagnostics log. */
  onCycle(info: PimCycleInfo): void;
  /** The device's calendar/reminder store reported a change (diagnostics only). */
  onDeviceChanged?(): void;
}

type PimUiStatus = "off" | "idle" | "syncing" | "error";

export interface PimState {
  status: PimUiStatus;
  message: string | null;
  lastSyncAt: number | null;
}

export interface PimRuntime {
  cache: PimCacheRepository;
  worker: PimWorker;
  vaultId: string;
  buildTarget: (account: PimAccountRow) => Promise<IPimTarget | null>;
}

/**
 * The runtime of the open vault: null before it booted and after it stopped.
 * A live binding, assigned only here — pimService reads it after every await
 * exactly as it read its own variable before the split, so a vault switch in
 * between is seen by the next read.
 */
export let runtime: PimRuntime | null = null;
let stopDeviceTrigger: (() => void) | null = null;
let state: PimState = { status: "off", message: null, lastSyncAt: null };
const listeners = new Set<() => void>();

/** Sets the status the calendar chip shows; a cycle that ends stamps `lastSyncAt`. */
export function setPimState(next: Partial<PimState>): void {
  const finished = state.status === "syncing" && next.status === "idle";
  state = { ...state, ...next, lastSyncAt: finished ? Date.now() : state.lastSyncAt };
  for (const l of listeners) l();
}

export function subscribePimStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPimStatus(): PimState {
  return state;
}

/** Boots the PIM runtime for the active vault; starts the worker only when at
 * least one account is configured. No-op without an index DB (web dev server). */
export async function startPimRuntime(vault: MobileVault, wiring: PimRuntimeWiring): Promise<void> {
  if (runtime || !vault.db) return;
  const buildTarget = (account: PimAccountRow) => wiring.buildTarget(vault.vaultId, account);
  const cache = new PimCacheRepository(vault.db);
  const worker = new PimWorker({
    cache,
    buildTarget,
    accountAuthRevision: (account) => wiring.accountAuthRevision(vault.vaultId, account),
    // What the status says when every account sits on a dead sign-in (N1/S2):
    // asking again costs a network round and answers the same way every time.
    parkedMessage: wiring.parkedMessage,
    // Why each cycle ran and how long it took — the desktop's pimRuntime writes
    // the same line (finding 2026-09-20: a second pull nobody could explain).
    onCycle: (info) => wiring.onCycle(info),
    onDataChanged: () => {
      window.dispatchEvent(new CustomEvent("m-pim-changed"));
      // A finished cycle is the only moment the phone learns about new or moved
      // appointments — so it is also the moment its reminders can go stale
      // (S10). Lazily imported so the notification plugin never loads for a
      // vault without a calendar.
      void import("../reminderScheduler").then((m) => m.rescheduleReminders()).catch(() => {});
    },
    onStatusChange: (status: PimStatus, message?: string) => {
      setPimState({ status: status === "syncing" ? "syncing" : status === "error" ? "error" : "idle", message: message ?? null });
      // The end of a cycle — idle OR error — is the reconciler's hook, NOT
      // `onDataChanged`. That one only fires when the provider wrote something,
      // so a task ticked off here while the provider is quiet would never be
      // pushed. Same wiring as the desktop's pimRuntime, same reason.
      if (status !== "syncing") void runMobileTaskSync();
    },
  });
  runtime = { cache, worker, vaultId: vault.vaultId, buildTarget };
  startTaskSyncRuntime({ vault, cache, buildTarget });
  const accounts = await cache.listAccounts();
  if (accounts.some((a) => a.enabled)) {
    setPimState({ status: "idle", message: null });
    worker.start();
    // "Something changed" from the device's store is the trigger the plan
    // names instead of a change feed: the next cycle runs now, not in N minutes.
    if (isDevicePimSupported()) stopDeviceTrigger = onDevicePimChanged(() => { wiring.onDeviceChanged?.(); void worker.triggerImmediate(); });
  } else {
    setPimState({ status: "off", message: null });
  }
  // Boot: the OS may hold reminders from a previous run whose appointments have
  // since moved or gone. Rebuilt from what the cache holds right now.
  void import("../reminderScheduler").then((m) => m.rescheduleReminders()).catch(() => {});
  // And tell the surfaces that the cache is readable NOW.
  //
  // A screen asks once when it mounts, and `listPimEvents`/`listPimCalendars`
  // answer `[]` until this runtime exists — the same empty answer they give for
  // "no appointments", so the calendar drew an empty week and had no reason to
  // ask again: `m-pim-changed` fires only when a cycle WROTE something, and a
  // vault whose events are already cached writes nothing. The runtime boots
  // behind the vault (SQLite has to open first), so a screen mounted at app
  // start regularly won the race and then kept the empty answer until the user
  // triggered a sync by hand — maintainer finding 2026-08-24, from the iPad.
  //
  // Same class as the resume trigger in `1ad9b995` ("a cycle without news fires
  // no event"), one step earlier: there it was the missing cycle, here the
  // missing answer that the cycle's data is reachable at all.
  // Guarded like every other dispatch in this layer (accountLogin fires the
  // SAME event that way): mobile vitest runs in node, where there is no window,
  // and a service must not need a DOM to boot.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-pim-changed"));
}

export function stopPim(): void {
  runtime?.worker.stop();
  stopDeviceTrigger?.();
  stopDeviceTrigger = null;
  stopTaskSyncRuntime();
  runtime = null;
  setPimState({ status: "off", message: null });
}

export function getPimCache(): PimCacheRepository | null {
  return runtime?.cache ?? null;
}

/**
 * Whether the account cache is actually up.
 *
 * `listPimAccounts()` answers `[]` both when there are no accounts AND when the
 * runtime has not booted yet — indistinguishable, and the sync worker starts in
 * parallel with it. Anything that would DELETE based on an empty list has to ask
 * this first (see mobileSecretsPort: tombstones).
 */
export function isPimRuntimeReady(): boolean {
  return runtime !== null;
}

export function pimSyncNow(): void {
  void runtime?.worker.triggerImmediate();
}

/**
 * Throttle for the triggers that fire on their own — returning to the app,
 * opening a screen that shows PIM data (plan Mobile-PIM-Auffrischung, P1/P3).
 *
 * A phone runs no timers in the background, so the worker's two-minute interval
 * is dead for exactly as long as the app is away and the cycle resumes at some
 * unpredictable later point. That is why an appointment or a task created
 * elsewhere took so long to appear, and why task reminders never got planned at
 * all: the reminder run reads the task DATABASE, which is only filled by the
 * mirror at the END of a cycle.
 *
 * The file sync learned this on 2026-08-10 and got `foregroundSync()`; the PIM
 * cycle was never brought along. Deliberately its OWN counter rather than a
 * shared one: the two cycles cost different things and answer to different
 * triggers, and one shared counter would let either suppress the other.
 */
const PIM_FOREGROUND_THROTTLE_MS = 60_000;
let lastForegroundPimAt = 0;

export function pimForegroundSync(now: number = Date.now()): void {
  if (!runtime) return;
  if (now - lastForegroundPimAt < PIM_FOREGROUND_THROTTLE_MS) return;
  lastForegroundPimAt = now;
  void runtime.worker.triggerImmediate();
  // The clock moved on even when the cycle finds nothing new: the rolling
  // reminder window slid, and the OS may have dropped what was scheduled. A
  // quiet cycle fires no `onDataChanged`, so this cannot wait for one.
  void import("../reminderScheduler").then((m) => m.rescheduleReminders()).catch(() => {});
}

/** Test seam: lets a suite start from a known throttle state. */
export function resetPimForegroundThrottle(): void {
  lastForegroundPimAt = 0;
}

/** Reconnect only wakes the worker belonging to the captured vault. A closed
 * vault reads the new credential when its own runtime starts later. */
export async function restartPimAccountAfterLogin(vaultId: string, accountId: string): Promise<void> {
  const target = runtime;
  if (!target || target.vaultId !== vaultId) return;
  try { await target.cache.setScopeState(accountId, "account", { lastError: null }); }
  catch (error) { if (runtime === target) throw error; }
  if (runtime !== target) return;
  if (state.status === "off") setPimState({ status: "idle", message: null });
  target.worker.start();
  target.worker.triggerImmediate();
}
