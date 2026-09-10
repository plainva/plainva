import { useEffect, useState } from "react";
import type { WeekStartDay } from "../../lib/calendarGrid";
import { getWeekStartSetting, WEEK_START_CHANGED_EVENT, weekStartDayOf } from "../../services/weekStart";

/**
 * The app-wide first day of the week, as a hook (plan Kalender 2026-09-10,
 * P1). Four surfaces carried the same ten lines — load the setting, listen
 * for the change event, unsubscribe — and the date field carried none and
 * started every week on Monday whatever the setting said. One hook, and the
 * fifth surface cannot forget the listener.
 */
export function useWeekStartDay(): WeekStartDay {
  const [day, setDay] = useState<WeekStartDay>(1);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void getWeekStartSetting()
        .then((s) => {
          if (alive) setDay(weekStartDayOf(s));
        })
        .catch(() => {});
    load();
    window.addEventListener(WEEK_START_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(WEEK_START_CHANGED_EVENT, load);
    };
  }, []);
  return day;
}
