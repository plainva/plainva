/**
 * When a vault's vectors are brought up to date (plan KI-Harness P2a-2): one
 * run at a time, newest notes first, a few notes per step. Told that the
 * index changed, it plans again after the current step. A note changed in the
 * last few seconds waits — it is probably still being typed, and every save
 * would embed it again; it follows a few seconds after the last one. The shells set the pace through `ready`: the desktop
 * steps when idle, the phone only in the foreground.
 *
 * A note that fails alone is skipped until its text changes, so one odd note
 * cannot hold up the rest; when several fail in a row the engine itself is at
 * fault, and the run stops with the error.
 */
import type { EmbeddingIndexer, EmbeddingOutcome, EmbeddingWork } from "./pipeline.js";

export interface EmbeddingProgress {
  state: "idle" | "working" | "paused" | "failed";
  /** Notes in the index. */
  total: number;
  /** Notes with vectors for their current text. */
  current: number;
  /** Notes waiting because they changed a moment ago or failed alone. */
  deferred: number;
  /** Notes the privacy rules keep from this engine (a cloud): they count neither as missing nor as done. */
  withheld: number;
  /** The note being embedded now. */
  working?: string;
  /** Why the run stopped, when it failed. */
  error?: string;
}

export interface EmbeddingSchedulerOptions {
  indexer: Pick<EmbeddingIndexer, "plan" | "embed" | "forget">;
  /** Resolves when the device may take the next step (desktop: idle; phone: in the foreground). */
  ready?: (signal: AbortSignal) => Promise<void>;
  onProgress?: (progress: EmbeddingProgress) => void;
  /** Notes per step. */
  stepNotes?: number;
  /** How long after its last change a note waits. */
  settleMs?: number;
  now?: () => number;
  /** Calls `run` after `ms`; returns how to cancel. */
  later?: (run: () => void, ms: number) => () => void;
}

const STEP_NOTES = 4;
export const EMBEDDING_SETTLE_MS = 5_000;
/** Notes failing one after another before the engine, not the notes, is blamed. */
const FAILURES_IN_A_ROW = 3;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class EmbeddingScheduler {
  private progress: EmbeddingProgress = { state: "idle", total: 0, current: 0, deferred: 0, withheld: 0 };
  private running: Promise<void> | null = null;
  private again = false;
  private paused = false;
  private readonly controller = new AbortController();
  /** Notes that failed alone, by the text they failed with. */
  private readonly failed = new Map<string, string>();
  private cancelWake: (() => void) | null = null;

  constructor(private readonly options: EmbeddingSchedulerOptions) {}

  get status(): EmbeddingProgress {
    return this.progress;
  }

  /** Plans and embeds until nothing is left, or it is paused or stopped. Call it as often as the index changes. */
  kick(): Promise<void> {
    this.again = true;
    if (this.controller.signal.aborted || this.paused) return this.running ?? Promise.resolve();
    this.running ??= this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  pause(): void {
    this.paused = true;
    if (!this.running) this.emit({ state: "paused", working: undefined });
  }

  resume(): Promise<void> {
    this.paused = false;
    return this.kick();
  }

  /** Stops for good (vault closed, model removed); the step under way is abandoned. */
  stop(): void {
    this.controller.abort();
    this.cancelWake?.();
  }

  private emit(change: Partial<EmbeddingProgress>): void {
    this.progress = { ...this.progress, ...change };
    this.options.onProgress?.(this.progress);
  }

  /** Wakes the scheduler when the first held-back note has settled. */
  private wakeAt(at: number): void {
    const later = this.options.later ?? ((run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
    this.cancelWake?.();
    this.cancelWake = later(() => {
      this.cancelWake = null;
      void this.kick();
    }, Math.max(0, at - (this.options.now ?? Date.now)()));
  }

  private async loop(): Promise<void> {
    const { indexer } = this.options;
    const signal = this.controller.signal;
    const now = this.options.now ?? Date.now;
    const settle = this.options.settleMs ?? EMBEDDING_SETTLE_MS;
    const step = this.options.stepNotes ?? STEP_NOTES;
    /** Notes that failed one after another since the last success. */
    const streak: string[] = [];
    try {
      while (this.again && !this.paused && !signal.aborted) {
        this.again = false;
        const plan = await indexer.plan();
        await indexer.forget(plan.orphans);
        const ripe: EmbeddingWork[] = [];
        let settling = Infinity;
        let deferred = 0;
        for (const work of plan.pending) {
          const age = now() - work.mtime;
          if (this.failed.get(work.path) === work.sha256) deferred++;
          // A time in the future is another device's clock, not a note being typed.
          else if (age >= 0 && age < settle) {
            deferred++;
            settling = Math.min(settling, work.mtime + settle);
          } else ripe.push(work);
        }
        if (settling !== Infinity) this.wakeAt(settling);
        let current = plan.total - plan.pending.length - plan.withheld;
        let withheld = plan.withheld;
        this.emit({ state: "working", total: plan.total, current, deferred, withheld, error: undefined });
        for (let i = 0; i < ripe.length; i += step) {
          // A changed index means a new plan — but only after one step, so a busy index cannot starve the run.
          if (this.paused || signal.aborted || (i > 0 && this.again)) break;
          await this.options.ready?.(signal);
          signal.throwIfAborted();
          const works = ripe.slice(i, i + step);
          this.emit({ working: works[0]!.path });
          for (const outcome of (await this.embedStep(works, signal, streak)).values()) {
            if (outcome === "embedded") current++;
            else if (outcome === "failed") deferred++;
            else if (outcome === "withheld") withheld++;
          }
          this.emit({ current, deferred, withheld, working: undefined });
        }
      }
      if (!signal.aborted) this.emit({ state: this.paused ? "paused" : "idle", working: undefined });
    } catch (error) {
      if (!signal.aborted) this.emit({ state: "failed", working: undefined, error: errorText(error) });
    }
  }

  /**
   * One step. When it fails, its notes go one by one, so only a note at fault
   * waits; the third failure in a row blames the engine instead, releases the
   * notes of the streak and ends the run with the error.
   */
  private async embedStep(works: EmbeddingWork[], signal: AbortSignal, streak: string[]): Promise<Map<string, EmbeddingOutcome | "failed">> {
    try {
      const outcomes = await this.options.indexer.embed(works, signal);
      if ([...outcomes.values()].includes("embedded")) streak.length = 0;
      return outcomes;
    } catch (error) {
      if (signal.aborted) throw error;
      if (works.length > 1) {
        const out = new Map<string, EmbeddingOutcome | "failed">();
        for (const work of works) for (const [path, outcome] of await this.embedStep([work], signal, streak)) out.set(path, outcome);
        return out;
      }
      const work = works[0]!;
      this.failed.set(work.path, work.sha256);
      streak.push(work.path);
      if (streak.length >= FAILURES_IN_A_ROW) {
        for (const blameless of streak) this.failed.delete(blameless);
        streak.length = 0;
        throw error;
      }
      return new Map([[work.path, "failed"]]);
    }
  }
}
