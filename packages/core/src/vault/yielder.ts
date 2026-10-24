/**
 * Keeps a long loop from holding the thread it shares with the user's typing
 * (issue #122).
 *
 * A full vault scan compares every file on disk with every indexed row. That
 * is plain synchronous work — tens of thousands of map lookups — and on the
 * desktop and the phone alike it runs on the one thread that also handles
 * keystrokes and paints. `await yielder()` inside such a loop is free until
 * the loop has run for `budgetMs` since it last let go; then it gives the
 * event loop one turn, so a queued key press is handled within a frame
 * instead of after the scan.
 *
 * The clock is read only every `every` calls: `performance.now()` is cheap,
 * not free, and these loops are hot.
 */
export type Yielder = () => Promise<void> | void;

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();

export function createYielder(budgetMs = 8, every = 64): Yielder {
  let last = now();
  let calls = 0;
  return () => {
    if (++calls % every !== 0) return;
    if (now() - last < budgetMs) return;
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        last = now();
        resolve();
      }, 0);
    });
  };
}
