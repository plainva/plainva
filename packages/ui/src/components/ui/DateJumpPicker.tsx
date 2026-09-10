import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ChevronDown, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON } from "../../lib/iconSizes";
import { localIsoKey } from "../../lib/dailyNotePath";
import { buildMonthCells, isoWeeksForCells, monthShortNames, weekdayShortNames, type WeekStartDay } from "../../lib/calendarGrid";
import { IconButton } from "./IconButton";
import { Button } from "./Button";
import { cx } from "./cx";
import { useFixedPopover } from "./useFixedPopover";

/**
 * The date jump picker (plan "Kalender, Anker-Links, Dependabot", 2026-09-10,
 * P1): ONE day grid for every place a person picks a date to go to — the
 * calendar tab's title popover on the desktop and its sheet on the phone, the
 * sidebar calendar's month picker, the database calendars' title, and the
 * date field of a database cell or a property.
 *
 * Before this there were three hand-built grids: the sidebar widget's inline
 * popover (year + months), `CustomDatePicker` (its own 6x7 grid with German
 * weekday labels in every language and Monday hard-wired as the week start),
 * and nothing at all in the calendar tab, whose title was plain text. Month
 * and weekday names come from `Intl` in the app language, the week starts
 * where the setting says, and the grid is a single Tab stop with the arrow
 * keys moving inside it (roving tabindex).
 *
 * `showDays={false}` is the sidebar's variant: year and months only — the
 * month itself is drawn right underneath the picker there, so a second day
 * grid would repeat what the widget already shows.
 */
export interface DateJumpPickerProps {
  /** The day the caller shows or has selected (ISO `YYYY-MM-DD`). */
  value: string;
  /** A day was picked (ISO). The caller closes; the picker never assumes. */
  onPick: (dayKey: string) => void;
  /** With `showDays={false}` a month tile is the pick. */
  onPickMonth?: (year: number, month: number) => void;
  /** Present → a "Today" button in the foot. */
  onToday?: () => void;
  /** Escape inside the grid. */
  onClose?: () => void;
  weekStart: WeekStartDay;
  /** Days that carry a mark (daily notes, entries): a dot under the number. */
  markedDays?: ReadonlySet<string>;
  /** The range the caller currently shows (a week, three days): tinted as a band. */
  band?: { from: string; to: string } | null;
  /** ISO week numbers in a first column; only offered when the week starts on Monday. */
  showWeekNumbers?: boolean;
  /** Default true. False = year + months only (sidebar). */
  showDays?: boolean;
  /** `sheet` raises the rows to touch height. */
  size?: "ui" | "sheet";
  /** Focus the selected day on mount (a popover that just opened). */
  autoFocus?: boolean;
  /** Extra content under the grids (the sidebar's week-number checkbox). */
  footer?: ReactNode;
  /** Base for the test ids: `<testId>-year`, `-month-<i>`, `-day-<iso>`, `-today`. */
  testId?: string;
}

const isoOf = (y: number, m: number, d: number) => localIsoKey(new Date(y, m, d));
function parseIso(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y: y || new Date().getFullYear(), m: (m || 1) - 1, d: d || 1 };
}
function shiftDays(key: string, days: number): string {
  const { y, m, d } = parseIso(key);
  return isoOf(y, m, d + days);
}
/** Same day-of-month in another month, clamped to that month's length. */
function shiftMonths(key: string, months: number): string {
  const { y, m, d } = parseIso(key);
  const last = new Date(y, m + months + 1, 0).getDate();
  return isoOf(y, m + months, Math.min(d, last));
}

export function DateJumpPicker({
  value,
  onPick,
  onPickMonth,
  onToday,
  onClose,
  weekStart,
  markedDays,
  band,
  showWeekNumbers = false,
  showDays = true,
  size = "ui",
  autoFocus = false,
  footer,
  testId = "datejump",
}: DateJumpPickerProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "en";
  const todayKey = localIsoKey(new Date());
  const start = parseIso(value);
  const [cursor, setCursor] = useState({ y: start.y, m: start.m });
  const [focusKey, setFocusKey] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(false);

  // The opening focus runs AFTER the layout effects: the popover hull measures
  // and reveals itself in one (`useFixedPopover`), and a button that is still
  // `visibility: hidden` at that moment would refuse the focus.
  useEffect(() => {
    if (autoFocus) rootRef.current?.querySelector<HTMLButtonElement>(`[data-day="${value}"]`)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The caller's selection moved (a pick from outside, or a re-open with a
  // different day): follow it, so the grid never shows a stale month.
  useEffect(() => {
    const v = parseIso(value);
    setCursor({ y: v.y, m: v.m });
    setFocusKey(value);
  }, [value]);

  const monthNames = useMemo(() => monthShortNames(lang), [lang]);
  const weekdays = useMemo(() => weekdayShortNames(lang, weekStart), [lang, weekStart]);
  const cells = useMemo(() => buildMonthCells(new Date(cursor.y, cursor.m, 1), weekStart), [cursor, weekStart]);
  const weeks = showDays && showWeekNumbers && weekStart === 1 ? isoWeeksForCells(cells) : null;
  const fullDate = useMemo(() => new Intl.DateTimeFormat(lang, { dateStyle: "full" }), [lang]);

  // Roving tabindex: the arrow keys move the focus through the grid; once the
  // state has settled, the button that now carries tabindex 0 takes the focus.
  useLayoutEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusKey}"]`)?.focus();
  }, [focusKey, cursor]);

  const moveFocus = (next: string) => {
    const n = parseIso(next);
    wantFocus.current = true;
    setFocusKey(next);
    if (n.y !== cursor.y || n.m !== cursor.m) setCursor({ y: n.y, m: n.m });
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    let handled = true;
    if (k === "ArrowLeft") moveFocus(shiftDays(focusKey, -1));
    else if (k === "ArrowRight") moveFocus(shiftDays(focusKey, 1));
    else if (k === "ArrowUp") moveFocus(shiftDays(focusKey, -7));
    else if (k === "ArrowDown") moveFocus(shiftDays(focusKey, 7));
    else if (k === "PageUp") moveFocus(shiftMonths(focusKey, e.shiftKey ? -12 : -1));
    else if (k === "PageDown") moveFocus(shiftMonths(focusKey, e.shiftKey ? 12 : 1));
    else if (k === "Home" || k === "End") {
      const { y, m, d } = parseIso(focusKey);
      const offset = (new Date(y, m, d).getDay() - weekStart + 7) % 7;
      moveFocus(shiftDays(focusKey, k === "Home" ? -offset : 6 - offset));
    } else if (k === "Enter" || k === " ") onPick(focusKey);
    else if (k === "t" || k === "T") {
      if (onToday) onToday();
      else onPick(todayKey);
    } else if (k === "Escape") onClose?.();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const pickMonth = (i: number) => {
    if (!showDays) {
      onPickMonth?.(cursor.y, i);
      return;
    }
    const { d } = parseIso(focusKey);
    const last = new Date(cursor.y, i + 1, 0).getDate();
    setCursor({ y: cursor.y, m: i });
    setFocusKey(isoOf(cursor.y, i, Math.min(d, last)));
  };
  const stepYear = (dir: -1 | 1) => {
    setCursor((c) => ({ y: c.y + dir, m: c.m }));
    setFocusKey((k) => shiftMonths(k, dir * 12));
  };

  const inBand = (iso: string) => !!band && iso >= band.from && iso <= band.to;

  return (
    <div ref={rootRef} className={cx("pv-datejump", size === "sheet" && "pv-datejump--sheet")} data-testid={testId}>
      <div className="pv-datejump-row">
        <IconButton size="sm" label={t("calendar.prevYear")} onClick={() => stepYear(-1)} data-testid={`${testId}-prev-year`}>
          <ChevronsLeft size={ICON.ui} />
        </IconButton>
        <span className="pv-datejump-label" data-testid={`${testId}-year`}>
          {cursor.y}
        </span>
        <IconButton size="sm" label={t("calendar.nextYear")} onClick={() => stepYear(1)} data-testid={`${testId}-next-year`}>
          <ChevronsRight size={ICON.ui} />
        </IconButton>
      </div>
      <div className="pv-datejump-months" role="group" aria-label={t("calendar.pickMonth")}>
        {monthNames.map((name, i) => (
          <button
            key={i}
            type="button"
            className="pv-datejump-month"
            aria-pressed={i === cursor.m}
            data-testid={`${testId}-month-${i}`}
            onClick={() => pickMonth(i)}
          >
            {name}
          </button>
        ))}
      </div>
      {showDays && (
        <div
          className={cx("pv-datejump-days", weeks && "has-weeks")}
          role="group"
          aria-label={t("calendar.pickDay")}
          onKeyDown={onGridKey}
          data-testid={`${testId}-days`}
        >
          {weeks && <span className="pv-datejump-wk">{t("calendar.weekShort")}</span>}
          {weekdays.map((w, i) => (
            <span key={`wd-${i}`} className="pv-datejump-wd">
              {w}
            </span>
          ))}
          {Array.from({ length: 6 }, (_, row) => (
            <RowCells
              key={`row-${row}`}
              cells={cells.slice(row * 7, row * 7 + 7)}
              week={weeks ? weeks[row] : null}
              month={cursor.m}
              value={value}
              focusKey={focusKey}
              todayKey={todayKey}
              markedDays={markedDays}
              inBand={inBand}
              fullDate={fullDate}
              testId={testId}
              onPick={onPick}
              onFocus={setFocusKey}
            />
          ))}
        </div>
      )}
      {footer}
      {(onToday || (showDays && size === "ui")) && (
        <div className="pv-datejump-foot">
          {size === "ui" && showDays ? <span className="pv-datejump-hint">{t("calendar.pickerHint")}</span> : <span />}
          {onToday && (
            <Button variant="tonal" size="sm" onClick={onToday} data-testid={`${testId}-today`}>
              {t("calendar.today")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function RowCells({
  cells,
  week,
  month,
  value,
  focusKey,
  todayKey,
  markedDays,
  inBand,
  fullDate,
  testId,
  onPick,
  onFocus,
}: {
  cells: Date[];
  week: number | null;
  month: number;
  value: string;
  focusKey: string;
  todayKey: string;
  markedDays?: ReadonlySet<string>;
  inBand: (iso: string) => boolean;
  fullDate: Intl.DateTimeFormat;
  testId: string;
  onPick: (iso: string) => void;
  onFocus: (iso: string) => void;
}) {
  return (
    <>
      {week !== null && <span className="pv-datejump-wk">{week}</span>}
      {cells.map((d) => {
        const iso = localIsoKey(d);
        return (
          <button
            key={iso}
            type="button"
            className={cx(
              "pv-datejump-day",
              d.getMonth() !== month && "is-outside",
              iso === todayKey && "is-today",
              inBand(iso) && "in-band",
              markedDays?.has(iso) && "has-mark"
            )}
            aria-pressed={iso === value}
            aria-current={iso === todayKey ? "date" : undefined}
            aria-label={fullDate.format(d)}
            tabIndex={iso === focusKey ? 0 : -1}
            data-day={iso}
            data-testid={`${testId}-day-${iso}`}
            onFocus={() => onFocus(iso)}
            onClick={() => onPick(iso)}
          >
            {d.getDate()}
          </button>
        );
      })}
    </>
  );
}

/**
 * The title that opens the picker: the period label with a small chevron,
 * `aria-expanded` while the popover is up. One class for the calendar tab,
 * the sidebar widget and the database calendar, so the three read as the
 * same control.
 */
export function DateJumpTrigger({
  label,
  open,
  onClick,
  tip,
  testId,
  className,
  buttonRef,
}: {
  label: ReactNode;
  open: boolean;
  onClick: () => void;
  /** Tooltip; also what the button does, for a screen reader. */
  tip: string;
  testId?: string;
  className?: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={cx("pv-datejump-trigger", className)}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-tip={tip}
      data-testid={testId}
      onClick={onClick}
    >
      <span>{label}</span>
      <ChevronDown size={ICON.meta} aria-hidden="true" />
    </button>
  );
}

/**
 * The desktop hull: a fixed, viewport-clamped popover under the trigger with
 * a click catcher behind it; Escape closes. Callers put a `DateJumpPicker`
 * inside and decide what a pick means.
 */
export function DateJumpPopover({
  open,
  anchorRef,
  onClose,
  ariaLabel,
  testId,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  ariaLabel: string;
  testId?: string;
  children: ReactNode;
}) {
  const ref = useFixedPopover(open, anchorRef, { minWidth: 280 });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="pv-click-catch" style={{ zIndex: "var(--z-menu)" }} onMouseDown={onClose} />
      <div ref={ref} role="dialog" aria-label={ariaLabel} className="pv-popover pv-popover--fixed pv-datejump-pop" data-testid={testId}>
        {children}
      </div>
    </>
  );
}
