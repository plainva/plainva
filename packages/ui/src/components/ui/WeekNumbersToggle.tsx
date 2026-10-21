import { useTranslation } from "react-i18next";
import { Checkbox } from "./Checkbox";
import { useShowWeekNumbers } from "./useShowWeekNumbers";

/**
 * The "Show week numbers" box at the foot of a calendar's date picker - the
 * sidebar calendar, the calendar tab and the phone's calendar carry the same
 * one (wish 2026-10-19). Nothing when the week does not start on Monday: ISO
 * weeks would not line up with the rows.
 */
export function WeekNumbersToggle({ weekStart, testId = "calendar-show-weeks" }: { weekStart: number; testId?: string }) {
  const { t } = useTranslation();
  const [show, setShow] = useShowWeekNumbers();
  if (weekStart !== 1) return null;
  return (
    <Checkbox className="pv-sidecal-weeks" data-testid={testId} checked={show} onChange={(e) => setShow(e.target.checked)}>
      {t("calendar.showWeeks")}
    </Checkbox>
  );
}
