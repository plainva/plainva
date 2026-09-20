import { useSyncExternalStore } from "react";
import { localIsoKey } from "../lib/dailyNotePath";

/**
 * Today's local day key (`YYYY-MM-DD`) as state (plan Aufgaben-Oberfläche, B1).
 *
 * "Today" and "Overdue" are judgements against the calendar day, and a view
 * that stays open overnight must not keep yesterday's answer. One store for the
 * whole app: a timer to the next midnight, and a re-check whenever the window
 * comes back — a laptop that slept through midnight fires no timer on time.
 */
let current = localIsoKey(new Date());
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function refresh(): void {
  const next = localIsoKey(new Date());
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

function arm(): void {
  clearTimeout(timer);
  const now = new Date();
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  timer = setTimeout(() => {
    refresh();
    arm();
  }, nextDay.getTime() - now.getTime());
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

export function useTodayKey(): string {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
