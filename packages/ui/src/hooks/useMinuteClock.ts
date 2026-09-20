import { useSyncExternalStore } from "react";

/**
 * The current local time as `HH:mm`, as state (plan Journal, J4).
 *
 * The capture field shows the time an entry WILL be stamped with. One store for
 * the whole app: a timer to the next full minute, and a re-check whenever the
 * window comes back — a machine that slept fires no timer on time.
 */
// Formatted HERE rather than through @plainva/core: this line runs while the
// module loads, and module-init work must not cross a package boundary (C20).
const clockOf = (date: Date): string => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
let current = clockOf(new Date());
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function refresh(): void {
  const next = clockOf(new Date());
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

function arm(): void {
  clearTimeout(timer);
  const now = new Date();
  timer = setTimeout(() => {
    refresh();
    arm();
  }, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    refresh();
    arm();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", refresh);
    window.removeEventListener("focus", refresh);
  };
}

const snapshot = (): string => current;

export function useMinuteClock(): string {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
