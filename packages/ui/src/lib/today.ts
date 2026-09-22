/**
 * Which day is it — asked once, for the whole app (plan Journal-Erweiterungen, X1).
 *
 * There was no such function. Three rebuilds of the same local day key stood
 * side by side — `localIsoKey`, `dayKey` and the phone's `isoOf` — and around
 * twenty places read `new Date()` raw. A day boundary that held at only some of
 * them would be worse than none, so this module is the one place that answers
 * the question, and the two names say WHICH question is being asked.
 *
 * **The distinction is the point.** A diary day may end after midnight: someone
 * writing at 01:30 is still finishing Tuesday, and their entry belongs in
 * Tuesday's note. An appointment at 01:30 on Wednesday is on Wednesday, and so
 * is a task due then. So:
 *
 * - `calendarDay` — the calendar's answer. Calendars, due dates, timelines.
 * - `journalDay` — the diary's answer, shifted by the vault's boundary. The
 *   daily note, the journal stream, journal capture.
 *
 * Both return a local `YYYY-MM-DD` key, never UTC: a vault is read where its
 * owner stands, and `toISOString()` would move the day across the date line.
 */

const pad = (n: number): string => String(n).padStart(2, "0");

/** The local calendar day of a moment, as `YYYY-MM-DD`. */
export function calendarDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The DIARY day of a moment as a Date: the calendar day, minus one while the
 * clock is still before the vault's boundary.
 *
 * `boundaryMinutes` is minutes after midnight, 0 to 360 (settings offer up to
 * 06:00). Zero — the default — makes this the calendar day, so a vault that
 * never sets a boundary behaves as it always did.
 *
 * The shift is done on the CALENDAR, not on the timestamp: subtracting six
 * hours from a moment lands two days back on a night that lost an hour and
 * does not move at all on one that gained one. Asking the calendar for "the
 * day before" is right through both.
 *
 * **Only the day is meaningful** — the result is anchored at midday, far from
 * either edge, because callers format it into a file name or a title. The
 * moment of writing travels separately (`JournalCapture.now`), so an entry at
 * 01:30 goes into yesterday's note and is still stamped `01:30`.
 */
export function journalDate(now: Date = new Date(), boundaryMinutes = 0): Date {
  const boundary = clampBoundary(boundaryMinutes);
  const minutesOfDay = now.getHours() * 60 + now.getMinutes();
  const shift = boundary > 0 && minutesOfDay < boundary ? -1 : 0;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + shift, 12);
}

/** The diary day of a moment as a key; see {@link journalDate}. */
export function journalDay(now: Date = new Date(), boundaryMinutes = 0): string {
  return calendarDay(journalDate(now, boundaryMinutes));
}

/** Minutes after midnight the diary day may end at: whole minutes, 0 to 06:00. */
export function clampBoundary(minutes: unknown): number {
  const n = typeof minutes === "number" && Number.isFinite(minutes) ? Math.round(minutes) : 0;
  return Math.min(Math.max(n, 0), 6 * 60);
}

/**
 * What the setting offers: midnight, then every half hour to 06:00.
 *
 * Half hours because people who keep one say things like "my day ends at half
 * three", and a list of seven whole hours would make them round. Six is the
 * far end: past that the shift would start eating into the next morning, and
 * an entry written at seven would land on the day before.
 */
export const DAY_END_CHOICES: readonly number[] = Object.freeze(
  Array.from({ length: 13 }, (_unused, index) => index * 30),
);

/** `HH:mm` of a boundary, for the settings row and the day heading. */
export function boundaryLabel(minutes: number): string {
  const n = clampBoundary(minutes);
  return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
}

/**
 * The boundary in force for the open vault, as one value per window.
 *
 * Every way into the journal would otherwise have to carry the setting down to
 * the call — the tray, the share sheet, a keyboard shortcut, a pending intent
 * the app replays at startup. Each shell puts the vault's value here when
 * settings load and when they change; a window shows one vault, so one value
 * is the whole truth. `0` until a shell says otherwise, which is also what a
 * vault without the setting means.
 */
let vaultBoundary = 0;
const boundaryListeners = new Set<(minutes: number) => void>();

export function setDayBoundary(minutes: unknown): void {
  const next = clampBoundary(minutes);
  if (next === vaultBoundary) return;
  vaultBoundary = next;
  boundaryListeners.forEach((listener) => listener(next));
}

export function dayBoundary(): number {
  return vaultBoundary;
}

/** Runs `listener` on every change of the vault's boundary; returns the unsubscribe. */
export function onDayBoundaryChange(listener: (minutes: number) => void): () => void {
  boundaryListeners.add(listener);
  return () => void boundaryListeners.delete(listener);
}

/** Today's DIARY day for the open vault — what "the daily note" and a capture mean. */
export function journalToday(now: Date = new Date()): Date {
  return journalDate(now, vaultBoundary);
}

/** Today's diary day as a key; see {@link journalToday}. */
export function journalTodayKey(now: Date = new Date()): string {
  return journalDay(now, vaultBoundary);
}
