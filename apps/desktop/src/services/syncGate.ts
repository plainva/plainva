import { closingAtSyncPlace, waitForClosingSyncPlace, type SyncStateBinding } from "@plainva/ui";

/**
 * Who may reach a vault's sync folder at the provider, and when.
 *
 * Two rules meet here:
 *
 * - Never two runtimes at one place: while another vault bound to the same
 *   folder still closes, nothing of this vault's sync touches the folder —
 *   no worker, no reconcile of the encrypted workspace, no look at a held
 *   folder (text 8). The vault itself opens; only its sync waits.
 * - A step that stops the sync to work on the vault (`workspaceSteps.ts`)
 *   takes the sync for its whole length (`takeVaultSync`): no start runs
 *   meanwhile — not one of this runtime, not one of the runtime the step
 *   opened anew, not one that still waited for the folder — and on every way
 *   out, an error included, the sync is given back and starts again.
 *
 * A load makes one gate (`createSyncGate`) and starts everything of its sync
 * through it: `start` for what may be started again after a step (a worker,
 * the settings-only sync; their `start` does nothing where they run already),
 * `once` for what runs one time (the reconcile at the open, the look at a
 * held folder).
 */

const taken = new Map<string, number>();
/** What of a vault's sync runs now outside its worker — the reconcile at the open — and can be stopped (`stoppable`). */
const running = new Map<string, { stop(): void; ended: Promise<void> }>();

/**
 * What of the vault's sync runs now without a worker yet: the reconcile of an
 * encrypted workspace at the open. A step stops it as it stops a worker —
 * within the same deadline — and it runs again once the step gives the sync
 * back (`stoppable`).
 */
export function runningVaultSyncStep(path: string): { stop(): void; stopAndDrain(): Promise<void> } | null {
  const now = running.get(path);
  return now ? { stop: () => now.stop(), stopAndDrain: () => now.ended } : null;
}
const wakers = new Map<string, Set<() => void>>();

/** Whether a step holds the sync of this vault now. */
export function vaultSyncTaken(path: string): boolean {
  return (taken.get(path) ?? 0) > 0;
}

/**
 * A step takes the vault's sync: until the returned function is called, no
 * gate of this vault starts anything. Called (once), every gate of the vault
 * starts what it holds — a worker the step stopped included.
 */
export function takeVaultSync(path: string): () => void {
  taken.set(path, (taken.get(path) ?? 0) + 1);
  let given = false;
  return () => {
    if (given) return;
    given = true;
    const left = (taken.get(path) ?? 1) - 1;
    if (left > 0) {
      taken.set(path, left);
      return;
    }
    taken.delete(path);
    for (const wake of [...(wakers.get(path) ?? [])]) wake();
  };
}

export interface SyncGate {
  /** Starts `begin` once the folder is free, no step holds the sync and the load is not called off; again after every step. */
  start(begin: () => void): void;
  /** Runs `run` one time, as soon as the folder is free and no step holds the sync; never once the load is called off. */
  once<T>(run: () => Promise<T>): Promise<T | undefined>;
  /**
   * As `once`, for work a step may stop while it runs (the reconcile at the
   * open): it is handed a signal, `runningVaultSyncStep` finds it, and one a
   * step stopped runs again — from its start — once the step gives the sync
   * back. Answers its result, or undefined where the load was called off.
   */
  stoppable<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T | undefined>;
  /** Whether nothing of another vault closes at the folder right now (an open can then go on at once). */
  freeNow(): boolean;
}

/**
 * The gates of each load, by its signal: a step that began to tear the
 * runtime's workspace down retires them (`retireSyncGates`) — that runtime
 * gets nothing of its sync back, whether the vault then opens anew or not.
 */
const gatesOfLoad = new WeakMap<AbortSignal, Set<() => void>>();

/**
 * The runtime of the load `signal` gets nothing of its sync back: every gate
 * it made starts nothing any more — not a worker a step stopped, not a
 * reconcile a step stopped, not one still waiting for its folder. The next
 * load of the vault makes its own gates.
 */
export function retireSyncGates(signal: AbortSignal): void {
  for (const retire of [...(gatesOfLoad.get(signal) ?? [])]) retire();
}

export function createSyncGate(options: { path: string; place: SyncStateBinding | null; signal: AbortSignal }): SyncGate {
  const { path, place, signal } = options;
  let free = !place || closingAtSyncPlace(place).length === 0;
  let retired = false;
  const starts = new Set<() => void>();
  const waiting = new Set<() => void>();
  const allowed = () => free && !signal.aborted && !retired && !vaultSyncTaken(path);
  const over = () => signal.aborted || retired;
  const wake = () => {
    if (!allowed()) return;
    for (const begin of [...starts]) begin();
    for (const go of [...waiting]) {
      waiting.delete(go);
      go();
    }
  };
  const own = wakers.get(path) ?? new Set<() => void>();
  wakers.set(path, own);
  own.add(wake);
  const unhook = () => {
    own.delete(wake);
    if (own.size === 0 && wakers.get(path) === own) wakers.delete(path);
    for (const go of [...waiting]) go();
    waiting.clear();
  };
  if (signal.aborted) unhook();
  else signal.addEventListener("abort", unhook, { once: true });
  const ofLoad = gatesOfLoad.get(signal) ?? new Set<() => void>();
  gatesOfLoad.set(signal, ofLoad);
  ofLoad.add(() => {
    if (retired) return;
    retired = true;
    starts.clear();
    unhook();
  });
  if (!free && place) {
    // The notice of text 8 lives as long as this load (`signal`).
    void waitForClosingSyncPlace(place, { signal }).then(() => {
      free = true;
      wake();
    });
  }
  return {
    start(begin) {
      if (over()) return;
      starts.add(begin);
      if (allowed()) begin();
    },
    once<T>(run: () => Promise<T>): Promise<T | undefined> {
      if (allowed()) return run();
      if (over()) return Promise.resolve(undefined);
      return new Promise<void>((go) => waiting.add(go)).then(() => (over() ? undefined : run()));
    },
    stoppable<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
      const once = this.once.bind(this);
      const go = async (): Promise<T | undefined> => {
        const outcome = await once(async () => {
          const stopped = new AbortController();
          const off = () => stopped.abort();
          signal.addEventListener("abort", off, { once: true });
          let byStep = false;
          const work = run(stopped.signal);
          const entry = { stop: () => { byStep = true; stopped.abort(); }, ended: work.then(() => undefined, () => undefined) };
          running.set(path, entry);
          try {
            const result = await work;
            return { result, byStep };
          } catch (error) {
            if (byStep) return { result: undefined, byStep };
            throw error;
          } finally {
            if (running.get(path) === entry) running.delete(path);
            signal.removeEventListener("abort", off);
          }
        });
        if (!outcome) return undefined;
        // Stopped by a step: again from its start, once the step gives the sync back (`once` waits for that) — never
        // on a runtime the step retired (`retireSyncGates`).
        if (outcome.byStep && !over()) return go();
        return outcome.result;
      };
      return go();
    },
    freeNow: () => free,
  };
}

/** Tests only. */
export function resetVaultSyncTakenForTests(): void {
  taken.clear();
  wakers.clear();
  running.clear();
}
