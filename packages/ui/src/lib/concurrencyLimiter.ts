/**
 * Minimal bounded-concurrency runner: at most `limit` async functions run at
 * once; the rest queue and start as slots free up. Results resolve in the order
 * each `run()` call is made (per-call), independent of completion order.
 *
 * Used by the vault directory walk to overlap network `stat()` latency without
 * flooding the Tauri IPC bridge, but it is deliberately generic.
 */
export interface ConcurrencyLimiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createLimiter(limit: number): ConcurrencyLimiter {
  let active = 0;
  const queue: (() => void)[] = [];
  const pump = () => {
    if (active >= limit || queue.length === 0) return;
    active++;
    queue.shift()!();
  };
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          fn().then(resolve, reject).finally(() => {
            active--;
            pump();
          });
        });
        pump();
      });
    },
  };
}
