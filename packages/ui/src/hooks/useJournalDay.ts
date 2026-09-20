import { useCallback, useEffect, useMemo, useState } from "react";
import { parseJournal, type JournalEntry } from "@plainva/core";
import { dailyNotePathFor } from "../lib/dailyNotes";
import type { JournalFeedSettings } from "../lib/journalFeed";

/**
 * The journal of ONE day (plan Journal, J5) — what the "Today" screen and the
 * calendar sidebar show for the selected day. The entries come from that day's
 * note, read when the day, the vault or the files change; a day without a note
 * simply has none.
 */
export interface JournalDayDeps {
  vaultKey: string;
  /** Local day `YYYY-MM-DD`. */
  dayKey: string;
  settings: JournalFeedSettings;
  readTextFile: (path: string) => Promise<string>;
  /** Counts up whenever files changed. */
  version: number;
}

export interface JournalDayState {
  /** The daily note of the day, whether it exists or not. */
  path: string;
  date: Date;
  entries: JournalEntry[];
  /** Read the day again right now (after an own write). */
  refresh: () => void;
}

export function useJournalDay(deps: JournalDayDeps): JournalDayState {
  const { vaultKey, dayKey, settings, readTextFile, version } = deps;
  const { folder, format, heading } = settings;
  const [tick, setTick] = useState(0);
  // The result remembers what it was read FOR: another day or vault never shows
  // the previous one's entries, and no effect has to reset anything.
  const [loaded, setLoaded] = useState<{ key: string; entries: JournalEntry[] } | null>(null);
  const date = useMemo(() => {
    const [year, month, day] = dayKey.split("-").map(Number);
    return new Date(year, month - 1, day);
  }, [dayKey]);
  const path = useMemo(() => dailyNotePathFor(date, { folder, format }), [date, folder, format]);
  const key = `${vaultKey}|${path}|${heading}`;

  useEffect(() => {
    let alive = true;
    readTextFile(path)
      .then((raw) => { if (alive) setLoaded({ key, entries: parseJournal(raw, { heading }).entries }); })
      // No daily note for that day (yet): no entries.
      .catch(() => { if (alive) setLoaded({ key, entries: [] }); });
    return () => { alive = false; };
  }, [key, path, heading, readTextFile, version, tick]);

  const refresh = useCallback(() => setTick((x) => x + 1), []);
  const entries = useMemo(() => (loaded && loaded.key === key ? loaded.entries : []), [loaded, key]);
  return { path, date, entries, refresh };
}
