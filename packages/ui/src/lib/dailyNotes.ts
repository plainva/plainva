/**
 * Daily notes, the shell-neutral part (TestFlight feedback Build 91, P4).
 *
 * The phone's Today card asked "does today's note exist?" with a hard ISO
 * name (`Tagebuch/2026-08-31.md`) while the tap went through the configured
 * format and opened `Tagebuch/26.08.31.md` — so the button said "create"
 * for a note that existed, and the strip's dots compared raw file names
 * against ISO keys and never lit. The desktop had the right rule in its own
 * service (forward-build the expected path per day, ask the disk); this is
 * that rule, for both shells.
 */
import { buildDailyNotePath, localIsoKey } from "./dailyNotePath";

export interface DailyNoteSettings {
  /** Vault-relative folder, "" for the root. */
  folder: string;
  /** Moment-style format, e.g. `YYYY-MM-DD` or `YY.MM.DD`; empty falls back to ISO. */
  format: string;
}

export const DEFAULT_DAILY_NOTE_FORMAT = "YYYY-MM-DD";

/** The vault-relative path the daily note for `date` has under these settings. */
export function dailyNotePathFor(date: Date, settings: DailyNoteSettings): string {
  return buildDailyNotePath(date, settings.format?.trim() || DEFAULT_DAILY_NOTE_FORMAT, (settings.folder ?? "").trim()).fullPath;
}

/**
 * Which of `dates` already have a daily note: the local ISO keys (YYYY-MM-DD)
 * of the days whose expected path exists. Format-agnostic by construction —
 * it builds the path the app would open, so it matches however the notes
 * were named. An unreadable path counts as absent.
 */
export async function existingDailyNoteDays(
  dates: readonly Date[],
  settings: DailyNoteSettings,
  exists: (path: string) => Promise<boolean>,
): Promise<Set<string>> {
  const out = new Set<string>();
  await Promise.all(
    dates.map(async (d) => {
      try {
        if (await exists(dailyNotePathFor(d, settings))) out.add(localIsoKey(d));
      } catch {
        /* absent */
      }
    }),
  );
  return out;
}

/**
 * What a typed daily-note format may contain (decision E4, 2026-09-07):
 * slashes and backslashes would make folders out of a file name and become
 * hyphens; dots stay — `YY.MM.DD` is a common Obsidian choice, and the
 * desktop used to rewrite it to `YY-MM-DD` while the phone kept it, so one
 * profile carried two formats.
 */
export function sanitizeDailyNoteFormat(raw: string): string {
  return raw.replace(/[/\\]/g, "-");
}
