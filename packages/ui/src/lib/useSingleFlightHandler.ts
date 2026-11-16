import { useMemo, useRef } from "react";
import { useStableHandler } from "./useStableHandler";

/**
 * Wraps an asynchronous handler so that a call arriving while an earlier one is
 * still running is dropped (it resolves to `undefined` without running).
 *
 * The case it exists for (issue 170): a name field that submits on Enter AND
 * when it loses focus. When the submit itself moves the focus — a template opens
 * its dialog, a confirmation asks — the blur arrives while the first run is still
 * awaiting, and the same create or rename ran twice: a second dialog, a second
 * write over the file the first run had just made. One action, one run; once it
 * has settled (also with an error shown in the field), the next call runs again.
 *
 * Stable like `useStableHandler`: the latest render's closure runs.
 */
export function useSingleFlightHandler<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | undefined> {
  const latest = useStableHandler(fn);
  const running = useRef(false);
  return useMemo(
    () =>
      async (...args: A): Promise<R | undefined> => {
        if (running.current) {
          // A form event still has its default stopped, or the browser reloads.
          const first = args[0] as { preventDefault?: () => void } | undefined;
          if (first && typeof first.preventDefault === "function") first.preventDefault();
          return undefined;
        }
        running.current = true;
        try {
          return await latest(...args);
        } finally {
          running.current = false;
        }
      },
    [latest],
  );
}
