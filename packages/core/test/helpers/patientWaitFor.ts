/**
 * `vi.waitFor` waits ten seconds unless a test says otherwise (Sammelplan
 * § 3.160 Nr. 3), in the core, the desktop and the phone alike — each suite's
 * setup file hands its own `vi` here.
 *
 * Its own default is one second. A wait for what a test set going — a copy
 * written beside a file, a toast after a refused write — took that alone; with
 * the three suites side by side under a commit hook it did not, and the test
 * failed, a different one each time (`notTextFiles.test.ts` on 28.10.). The
 * wait ends as soon as its check holds, so a longer limit costs nothing where
 * the code works and still ends a wait for something that never comes, well
 * inside the 20 s a test has.
 */
export const WAIT_FOR_TIMEOUT_MS = 10_000;

type WaitForOptions = number | { timeout?: number; interval?: number } | undefined;

export function makeWaitForPatient<V extends { waitFor: (callback: never, options?: never) => unknown }>(vi: V): void {
  const original = vi.waitFor as unknown as (callback: unknown, options?: WaitForOptions) => unknown;
  (vi as unknown as { waitFor: unknown }).waitFor = (callback: unknown, options?: WaitForOptions) =>
    original(callback, typeof options === "number" ? options : { ...options, timeout: options?.timeout ?? WAIT_FOR_TIMEOUT_MS });
}
