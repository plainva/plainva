import { useMemo, useRef } from "react";
import { useStableHandler } from "./useStableHandler";

/**
 * Wraps an asynchronous handler so that a call for the SAME operation arriving
 * while an earlier one is still running is dropped (it resolves to `undefined`
 * without running).
 *
 * The case it exists for (issue 170): a name field that submits on Enter AND
 * when it loses focus. When the submit itself moves the focus — a template opens
 * its dialog, a confirmation asks — the blur arrives while the first run is still
 * awaiting, and the same create or rename ran twice: a second dialog, a second
 * write over the file the first run had just made.
 *
 * `key` names the operation, read from the latest render when the call comes
 * in (the new item's folder and name, the renamed path). Only a call with the
 * key of a run still in flight is dropped: a second item renamed while the
 * first one's follow-up work (re-index, link rewrite) still runs goes through.
 * Without a key every call is the same operation. Once a run has settled, also
 * with an error shown in the field, the next call for that key runs again.
 *
 * Stable like `useStableHandler`: the latest render's closure runs.
 */
export function useSingleFlightHandler<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  key?: () => string,
): (...args: A) => Promise<R | undefined> {
  const latest = useStableHandler(fn);
  const latestKey = useStableHandler(() => (key ? key() : ""));
  const running = useRef(new Set<string>());
  return useMemo(
    () =>
      async (...args: A): Promise<R | undefined> => {
        const k = latestKey();
        if (running.current.has(k)) {
          // A form event still has its default stopped, or the browser reloads.
          const first = args[0] as { preventDefault?: () => void } | undefined;
          if (first && typeof first.preventDefault === "function") first.preventDefault();
          return undefined;
        }
        running.current.add(k);
        try {
          return await latest(...args);
        } finally {
          running.current.delete(k);
        }
      },
    [latest, latestKey],
  );
}
