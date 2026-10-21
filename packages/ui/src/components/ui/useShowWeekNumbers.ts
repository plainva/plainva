import { useCallback, useSyncExternalStore } from "react";

/**
 * "Show week numbers" - one choice per device for every calendar on it (wish
 * from TestFlight, 2026-10-19): the desktop's sidebar calendar, its calendar
 * tab, the phone's calendar and the date pickers they open. It used to be the
 * sidebar calendar's own setting, so the calendar views never showed a week.
 * The key stays the sidebar's, so a choice made there carries over.
 *
 * ISO weeks begin on Monday: a surface shows them only when the week starts
 * on Monday (`weekNumbersShown`), as the sidebar always did.
 */
export const SHOW_WEEK_NUMBERS_KEY = "plainva-calendar-show-weeks";
const CHANGED = "plainva-show-week-numbers-changed";

export function getShowWeekNumbers(): boolean {
  try {
    return localStorage.getItem(SHOW_WEEK_NUMBERS_KEY) === "true";
  } catch {
    return false;
  }
}

export function setShowWeekNumbers(on: boolean): void {
  try {
    localStorage.setItem(SHOW_WEEK_NUMBERS_KEY, on ? "true" : "false");
  } catch {
    // Storage refused (private mode): the choice lasts for this session only.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  // Another window of the desktop app changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === SHOW_WEEK_NUMBERS_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Whether week numbers are shown on a calendar whose week starts on `weekStart`. */
export function weekNumbersShown(show: boolean, weekStart: number): boolean {
  return show && weekStart === 1;
}

/** The device's choice and its setter; every calendar re-renders together. */
export function useShowWeekNumbers(): [boolean, (on: boolean) => void] {
  const show = useSyncExternalStore(subscribe, getShowWeekNumbers, () => false);
  const set = useCallback((on: boolean) => setShowWeekNumbers(on), []);
  return [show, set];
}
