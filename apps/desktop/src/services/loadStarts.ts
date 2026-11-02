import { noteVaultTeardown } from "./vaultTeardown";

/** Something a vault load starts: a sync worker, the PIM worker, the settings-only sync, the index queue. */
export interface LoadStarted {
  /** Stops its clock at once; nothing new begins after this. */
  stop(): void;
  /** Resolves once what was under way has finished, where the thing knows how to wait for that. */
  stopAndDrain?(): Promise<void>;
}

/**
 * What one vault load has started, so a load that is called off takes it back
 * (open-items plan 3.120).
 *
 * Opening a vault starts workers along the way - the PIM worker before the
 * first index run, the sync worker after it. When another vault is opened in
 * between, the load ends at its next look at the abort signal, and until now
 * it simply returned: what it had started never reached the state the next
 * teardown stops, so it ran on for a vault nobody had open, and opening that
 * vault again put a second sync worker on the same queue.
 *
 * `start` asks the signal before each start and does not start anything for a
 * load that is called off; `abandon` stops the clocks of everything started at
 * once, then drains it, and parks the drain like a teardown so the next open
 * of this vault waits for it (`awaitVaultTeardown`).
 */
export class LoadStarts {
  private readonly started: LoadStarted[] = [];

  constructor(
    private readonly vaultPath: string,
    private readonly signal: AbortSignal,
  ) {}

  /** Starts `what` with `begin` unless the load has been called off; returns whether it started. */
  start(what: LoadStarted, begin: () => void): boolean {
    if (this.signal.aborted) return false;
    begin();
    this.started.push(what);
    return true;
  }

  /** Remembers something that was started elsewhere and belongs to this load. */
  adopt(what: LoadStarted): void {
    this.started.push(what);
  }

  /** Hands everything started so far to the open vault: the load went through, the teardown owns it now. */
  settle(): void {
    this.started.length = 0;
  }

  /** The load was called off: stops what it started, newest first, and parks the drain. */
  abandon(): Promise<void> {
    const all = this.started.splice(0).reverse();
    for (const what of all) {
      try {
        what.stop();
      } catch (e) {
        console.warn("[VaultContext] stopping what a called-off load started failed", e);
      }
    }
    const drain = (async () => {
      for (const what of all) {
        await what.stopAndDrain?.().catch((e: unknown) =>
          console.warn("[VaultContext] draining what a called-off load started failed", e),
        );
      }
    })();
    noteVaultTeardown(this.vaultPath, drain);
    return drain;
  }
}
