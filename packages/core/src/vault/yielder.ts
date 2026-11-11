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
 * not free, and these loops are hot. It is a parameter so a test can hold it
 * still or move it: measured on the wall clock, forty calls "within 5 ms"
 * failed on loaded CI runners (Sammelplan § 3.129 Nr. 4, § 3.151 Nr. 5).
 */
export type Yielder = () => Promise<void> | void;

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();

/**
 * One turn of the event loop, the cheapest way the host has (performance plan
 * L3).
 *
 * The turn used to be a `setTimeout(…, 0)`. A browser clamps a timer set from
 * inside a timer to 4 ms after a few levels, and in a window that is hidden or
 * minimised it runs a timer at most once a second: a first index of 10 000
 * notes that let go every tenth file waited about four seconds for nothing in
 * a visible window, and in a minimised one it all but stood still. A message
 * on a `MessageChannel` is a task like a timer's — input and painting get
 * their turn before it — without the clamp and without the throttling of
 * background timers. Node (the core's tests and measurements) has
 * `setImmediate` for the same; a host with neither falls back to the timer.
 */
export function nextMacrotask(): Promise<void> {
  return new Promise<void>((resolve) => scheduleMacrotask(resolve));
}

type Task = () => void;
let schedule: ((task: Task) => void) | null = null;

function scheduleMacrotask(task: Task): void {
  if (!schedule) schedule = pickScheduler();
  schedule(task);
}

function pickScheduler(): (task: Task) => void {
  const g = globalThis as { setImmediate?: (task: Task) => unknown; MessageChannel?: typeof MessageChannel; document?: unknown };
  // Node, and a test environment that runs on it. Asked first: a port of a
  // MessageChannel keeps a Node process alive for as long as it listens.
  if (typeof g.setImmediate === "function") {
    const immediate = g.setImmediate;
    return (task) => { immediate(task); };
  }
  if (typeof g.MessageChannel === "function") {
    // One channel for every turn: the tasks waiting for it run in the order
    // they asked, one message each.
    const channel = new g.MessageChannel();
    const waiting: Task[] = [];
    channel.port1.onmessage = () => {
      const task = waiting.shift();
      if (task) task();
    };
    return (task) => {
      waiting.push(task);
      channel.port2.postMessage(null);
    };
  }
  return (task) => { setTimeout(task, 0); };
}

export function createYielder(budgetMs = 8, every = 64, clock: () => number = now): Yielder {
  let last = clock();
  let calls = 0;
  return () => {
    if (++calls % every !== 0) return;
    if (clock() - last < budgetMs) return;
    return nextMacrotask().then(() => {
      last = clock();
    });
  };
}
