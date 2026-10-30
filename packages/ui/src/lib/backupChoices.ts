/**
 * What the pickers of "Backup & version history" offer, in both shells
 * (Sammelplan § 3.169 Nr. 3).
 *
 * The values are vault settings and travel with the settings profile, but each
 * shell offered its own list: the desktop 30 seconds and 180 days, the phone a
 * minute and neither of those; the desktop any number of versions, the phone
 * four. A value chosen on one device was then a value the other could show
 * but not choose again — and the desktop's select showed none at all for the
 * phone's minute. One list here, and a value from elsewhere is always one of
 * the choices (`choicesWith`), so no picker answers with a blank.
 */

/** Snapshot interval in seconds; 0 = a version at every change. */
export const VERSION_INTERVAL_CHOICES: readonly number[] = [0, 30, 60, 120, 300, 600];

/** Oldest version kept, in days; 0 = no limit. */
export const VERSION_MAX_AGE_CHOICES: readonly number[] = [30, 90, 180, 365, 0];

/** Versions kept per file (the desktop's field takes any number from 5 to 1000). */
export const VERSION_MAX_COUNT_CHOICES: readonly number[] = [20, 50, 100, 200, 500];

/** ZIP archives kept (the desktop's field takes any number from 1 to 50). */
export const ZIP_KEEP_CHOICES: readonly number[] = [3, 7, 14, 30];

/**
 * The choices, with `current` among them where it is not: a value another
 * device set stays visible and selectable here. `zero` says where 0 stands —
 * first ("at every change") or last ("no limit").
 */
export function choicesWith(choices: readonly number[], current: number, zero: "first" | "last" = "first"): number[] {
  const all = choices.includes(current) || !Number.isFinite(current) ? [...choices] : [...choices, current];
  const rank = (n: number) => (n === 0 ? (zero === "first" ? -Infinity : Infinity) : n);
  return all.sort((a, b) => rank(a) - rank(b));
}

/** How an interval reads: "every change", seconds below a minute, else minutes. */
export function versionIntervalLabel(seconds: number, everyChange: string): string {
  if (seconds === 0) return everyChange;
  if (seconds < 60 || seconds % 60 !== 0) return `${seconds} s`;
  return `${seconds / 60} min`;
}
