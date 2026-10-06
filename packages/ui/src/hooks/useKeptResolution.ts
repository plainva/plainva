import { useEffect, useState } from "react";
import { sameStoredValue } from "@plainva/core";

/**
 * An answer that is looked up for a key and looked up AGAIN whenever `version`
 * moves — and that stays on screen in between (plan Befunde 2026-10-06, R5).
 *
 * The properties panel asks which database governs a note; the answer decides
 * how a row is drawn (a `tags` value is tag pills on its own, and option chips
 * once a database declares the column a multi-select). The panel used to
 * FORGET the answer at the start of every lookup and ask again — and a lookup
 * starts with every index update, that is with every save and every sync
 * cycle. In between, the row fell back to the other renderer. That was the
 * flicker between two colours.
 *
 * The rule here: never "forget, then look up". The last answer for a key
 * stands until the new one has arrived, and it is replaced only if the new one
 * is actually different — an equal answer keeps its identity, so nothing that
 * depends on it re-renders. `memory` remembers the answer per key beyond this
 * component, so coming back to a note draws it right on the first frame.
 */
export function useKeptResolution<T>(
  key: string | null,
  version: unknown,
  resolve: (key: string) => Promise<T | null>,
  memory?: Map<string, T | null>,
): T | null {
  const [held, setHeld] = useState<{ key: string | null; value: T | null }>(() => ({
    key,
    value: key !== null ? memory?.get(key) ?? null : null,
  }));

  useEffect(() => {
    if (key === null) return;
    let alive = true;
    resolve(key)
      .then((value) => {
        if (!alive) return;
        memory?.set(key, value);
        setHeld((prev) => (prev.key === key && sameStoredValue(prev.value, value) ? prev : { key, value }));
      })
      .catch(() => {
        // A failed lookup is not an answer: what stood there keeps standing.
      });
    return () => {
      alive = false;
    };
  }, [key, version, resolve, memory]);

  // Another key is another question. Its remembered answer, if any, applies at
  // once; the old key's answer never does.
  if (held.key === key) return held.value;
  return key !== null ? memory?.get(key) ?? null : null;
}
