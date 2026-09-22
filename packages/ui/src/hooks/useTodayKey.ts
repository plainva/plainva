import { useSyncExternalStore } from "react";
import { calendarDay, dayBoundary, journalDay, onDayBoundaryChange } from "../lib/today";

/**
 * Today's day key (`YYYY-MM-DD`) as state (plan Aufgaben-Oberfläche, B1;
 * boundary added by plan Journal-Erweiterungen, X2).
 *
 * "Today" and "Overdue" are judgements against a day, and a view that stays
 * open overnight must not keep yesterday's answer. One store per question: a
 * timer to the next turn of the day, and a re-check whenever the window comes
 * back — a laptop that slept through it fires no timer on time.
 *
 * Two days, two questions (see `lib/today.ts`): the CALENDAR turns at
 * midnight, the DIARY at the vault's boundary. Both are kept here because both
 * turn while a window is open, and the second one moves when the setting does.
 */
type Kind = "calendar" | "journal";

const keyOf = (kind: Kind): string => (kind === "calendar" ? calendarDay() : journalDay(new Date(), dayBoundary()));

/** When this day next turns over, as a moment. */
function nextTurn(kind: Kind): number {
  const now = new Date();
  const turn = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 1);
  if (kind === "journal") turn.setMinutes(turn.getMinutes() + dayBoundary());
  if (turn.getTime() <= now.getTime()) turn.setDate(turn.getDate() + 1);
  return turn.getTime() - now.getTime();
}

function makeDayStore(kind: Kind) {
  let current = keyOf(kind);
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopBoundaryWatch: (() => void) | undefined;

  const refresh = (): void => {
    const next = keyOf(kind);
    if (next === current) return;
    current = next;
    listeners.forEach((listener) => listener());
  };

  const arm = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      refresh();
      arm();
    }, Math.max(1, nextTurn(kind)));
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      refresh();
      arm();
      document.addEventListener("visibilitychange", refresh);
      window.addEventListener("focus", refresh);
      // A changed boundary moves both the answer and the next turn.
      if (kind === "journal") stopBoundaryWatch = onDayBoundaryChange(() => { refresh(); arm(); });
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      stopBoundaryWatch?.();
      stopBoundaryWatch = undefined;
    };
  };

  return { subscribe, snapshot: (): string => current };
}

const calendarStore = makeDayStore("calendar");
const journalStore = makeDayStore("journal");

/** Today on the CALENDAR: due dates, overdue, the day a grid highlights. */
export function useTodayKey(): string {
  return useSyncExternalStore(calendarStore.subscribe, calendarStore.snapshot, calendarStore.snapshot);
}

/** Today in the DIARY: which daily note is "today", which day a capture joins. */
export function useJournalDayKey(): string {
  return useSyncExternalStore(journalStore.subscribe, journalStore.snapshot, journalStore.snapshot);
}

/**
 * The vault's day boundary in minutes, as state — for the surfaces that SAY it
 * ("until 04:00" in the day head). Switching it on at three in the afternoon
 * changes no day key, so a view that only watched the key would keep the old
 * sentence until midnight.
 */
export function useDayBoundaryMinutes(): number {
  return useSyncExternalStore(onDayBoundaryChange, dayBoundary, dayBoundary);
}
