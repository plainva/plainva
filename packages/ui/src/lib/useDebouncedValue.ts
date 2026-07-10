import { useEffect, useState } from "react";

/** Returns `value` trailing-delayed by `delayMs`. The sidebar search keeps the
 *  input state immediate (controlled field) and feeds the debounced value to
 *  the query consumers, so typing does not fire one FTS query per keystroke. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
