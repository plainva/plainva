import { useLayoutEffect, useMemo, useRef } from "react";

/**
 * Returns a referentially STABLE function that always calls the latest render's
 * closure (the ref-forwarding pattern editorSession uses for its host
 * callbacks). Handlers wrapped with this can be passed to React.memo children
 * without defeating the memo and without useCallback dependency lists — the
 * inner closure is fresh every render, so there is no stale-state risk (P2.12:
 * TreeNodeView is memoized and receives a dozen handlers).
 *
 * The ref updates in useLayoutEffect (writing it during render violates the
 * react-hooks compiler rules). Not for render-time use: the returned function
 * must only be invoked from events/effects, like every handler it wraps —
 * those always fire after the commit, when the ref is current.
 */
export function useStableHandler<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useMemo(() => (...args: A) => ref.current(...args), []);
}
