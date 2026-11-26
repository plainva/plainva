/**
 * The modules the boot loads after the first picture — the sync, the calendars — tried until they are there
 * (review of L5, 2026-11-25). They are chunks of the app's own bundle; a load that fails once (a file the system
 * could not hand out in that moment) left the sync silently off until the next start. Now the failure is said once,
 * as a sync error, and the load is tried again — after 2 s, 10 s, then every 30 s — while the boot it belongs to is
 * still the current one.
 */
export const BOOT_MODULE_RETRY_MS = [2000, 10000, 30000] as const;

export async function loadBootModules<T>(options: {
  load: () => Promise<T>;
  /** Whether the boot that asked is still the current one; a stale boot stops trying. */
  current: () => boolean;
  /** Called once, at the first failure. */
  onFailure: (error: unknown) => void;
  wait?: (ms: number) => Promise<void>;
}): Promise<T | null> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await options.load();
    } catch (error) {
      if (!options.current()) return null;
      if (attempt === 0) options.onFailure(error);
      await wait(BOOT_MODULE_RETRY_MS[Math.min(attempt, BOOT_MODULE_RETRY_MS.length - 1)]!);
      if (!options.current()) return null;
    }
  }
}
