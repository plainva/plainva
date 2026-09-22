import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { localIsoKey, parseDailyNoteDate } from "../lib/dailyNotePath";
import {
  NO_JOURNAL_FILTER,
  journalCandidates,
  journalDayOf,
  journalTags,
  loadJournalWindow,
  withJournalDay,
  type JournalCandidate,
  type JournalDay,
  type JournalFeedSettings,
  type JournalFilter,
} from "../lib/journalFeed";

/**
 * State of the journal stream, for both shells (plan Journal, J5).
 *
 * Three rules it keeps:
 *   - the list STAYS while it reloads (the rule of A6 in the task plan): a new
 *     filter or a changed note replaces the days when the new ones are there,
 *     never with an empty list in between; only another vault empties it — and
 *     that by identity, not by an effect that resets state;
 *   - when a note changes, only ITS day is read again;
 *   - a late answer never wins: every load carries a ticket, and a result whose
 *     ticket is no longer the newest is dropped.
 */
export interface JournalFeedDeps {
  /** Identity of the vault; another vault empties the stream at once. */
  vaultKey: string;
  settings: JournalFeedSettings;
  /** Every note of the vault, from the index — the daily notes are picked out of these. */
  listNotePaths: () => Promise<string[]>;
  readTextFile: (path: string) => Promise<string>;
  /** Counts up whenever files changed … */
  version: number;
  /** … and these are the paths behind the latest change; `null` when that is not known. */
  changedPaths: readonly string[] | null;
  onError?: (error: unknown) => void;
}

export interface JournalFeedState {
  days: JournalDay[];
  /** Only the very first load of a vault; later loads keep the list. */
  loading: boolean;
  /** A window is being read — the "load older" button shows it. */
  busy: boolean;
  more: boolean;
  filter: JournalFilter;
  setFilter: Dispatch<SetStateAction<JournalFilter>>;
  loadOlder: () => void;
  /** Read one note's day again right now (after an own write, before the index says so). */
  refreshPath: (path: string) => void;
  /** The most frequent tags of what is loaded — the filter chips. */
  tags: string[];
  /** Day keys that have entries, for the date picker's marks. */
  dayKeys: ReadonlySet<string>;
  /** Which of these days have journal entries — the date picker's marks, whatever the stream has loaded. */
  loadMarkedDays: (dates: Date[]) => Promise<ReadonlySet<string>>;
  /** Loads older windows until the stream has reached `dayKey` — the date picker's jump. */
  loadThrough: (dayKey: string) => Promise<void>;
}

interface Loaded { vaultKey: string; key: string; days: JournalDay[]; more: boolean }

export function useJournalFeed(deps: JournalFeedDeps): JournalFeedState {
  const { vaultKey, settings, version, changedPaths } = deps;
  const { folder, format, heading } = settings;
  const moodProperty = settings.moodProperty ?? "";
  const [filter, setFilter] = useState<JournalFilter>(NO_JOURNAL_FILTER);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  /** What the stream is FOR. A loaded result belongs to exactly one of these. */
  const key = useMemo(() => JSON.stringify([vaultKey, folder, format, heading, moodProperty, filter.text, filter.tag, filter.tasksOnly]), [vaultKey, folder, format, heading, moodProperty, filter]);

  // The newest callbacks, for the effects below. Written in an effect, never
  // during render; it is declared first, so it has run before they do.
  const depsRef = useRef(deps);
  useEffect(() => { depsRef.current = deps; });
  const ticket = useRef(0);
  const through = useRef<number | null>(null);
  const candidates = useRef<JournalCandidate[]>([]);
  const report = useCallback((error: unknown) => depsRef.current.onError?.(error), []);

  // The first window — for a vault, for its settings, for a filter.
  useEffect(() => {
    const mine = ++ticket.current;
    void (async () => {
      try {
        const found = journalCandidates(await depsRef.current.listNotePaths(), { folder, format });
        const window = await loadJournalWindow(found, null, depsRef.current.readTextFile, heading, filter, moodProperty);
        if (mine !== ticket.current) return;
        candidates.current = found;
        through.current = window.through;
        setLoaded({ vaultKey, key, days: window.days, more: window.more });
      } catch (error) {
        if (mine !== ticket.current) return;
        report(error);
        // A failed load keeps the rows of this vault and ends the waiting.
        setLoaded((prev) => (prev && prev.vaultKey === vaultKey ? { ...prev, key } : { vaultKey, key, days: [], more: false }));
      }
    })();
  }, [vaultKey, folder, format, heading, moodProperty, filter, key, report]);

  const loadOlder = useCallback(() => {
    const mine = ticket.current;
    setOlderBusy(true);
    void (async () => {
      try {
        const window = await loadJournalWindow(candidates.current, through.current, depsRef.current.readTextFile, heading, filter, moodProperty);
        if (mine !== ticket.current) return;
        through.current = window.through;
        setLoaded((prev) => (prev && prev.key === key
          ? { ...prev, days: [...prev.days, ...window.days.filter((day) => !prev.days.some((p) => p.path === day.path))], more: window.more }
          : prev));
      } catch (error) {
        if (mine === ticket.current) report(error);
      } finally {
        setOlderBusy(false);
      }
    })();
  }, [heading, moodProperty, filter, key, report]);

  /** One note again. A day older than what the stream has reached stays out — "load older" brings it. */
  const refreshOne = useCallback(async (path: string, mine: number) => {
    const date = parseDailyNoteDate(path, format, folder);
    if (!date) return;
    const known = candidates.current.find((c) => c.path === path);
    const candidate: JournalCandidate = known ?? { path, date, key: localIsoKey(date) };
    if (!known) candidates.current = [...candidates.current, candidate].sort((a, b) => b.date.getTime() - a.date.getTime() || a.path.localeCompare(b.path));
    const reached = through.current;
    if (reached !== null && date.getTime() < reached) return;
    let day: JournalDay | null = null;
    try {
      day = journalDayOf(candidate, await depsRef.current.readTextFile(path), heading, filter, moodProperty);
    } catch {
      // Deleted or unreadable: the day leaves the stream.
      candidates.current = candidates.current.filter((c) => c.path !== path);
    }
    if (mine !== ticket.current) return;
    setLoaded((prev) => (prev && prev.key === key ? { ...prev, days: withJournalDay(prev.days, candidate, day) } : prev));
  }, [folder, format, heading, moodProperty, filter, key]);

  const refreshPath = useCallback((path: string) => { void refreshOne(path, ticket.current); }, [refreshOne]);

  // Files changed. Known paths: only their days. Unknown: the candidates again, and every day reached so far.
  const seenVersion = useRef(version);
  useEffect(() => {
    if (seenVersion.current === version) return;
    seenVersion.current = version;
    const mine = ticket.current;
    void (async () => {
      try {
        if (changedPaths) {
          for (const path of changedPaths) await refreshOne(path, mine);
          return;
        }
        const found = journalCandidates(await depsRef.current.listNotePaths(), { folder, format });
        if (mine !== ticket.current) return;
        const gone = candidates.current.filter((c) => !found.some((f) => f.path === c.path));
        candidates.current = found;
        if (gone.length) setLoaded((prev) => (prev && prev.key === key ? { ...prev, days: prev.days.filter((day) => !gone.some((g) => g.path === day.path)) } : prev));
        const reached = through.current;
        for (const candidate of found) {
          if (reached !== null && candidate.date.getTime() < reached) break;
          await refreshOne(candidate.path, mine);
        }
      } catch (error) {
        if (mine === ticket.current) report(error);
      }
    })();
  }, [version, changedPaths, folder, format, key, refreshOne, report]);

  const loadMarkedDays = useCallback(async (dates: Date[]): Promise<ReadonlySet<string>> => {
    const wanted = new Set(dates.map((date) => localIsoKey(date)));
    const found = new Set<string>();
    await Promise.all(candidates.current.filter((c) => wanted.has(c.key)).map(async (candidate) => {
      try {
        if (journalDayOf(candidate, await depsRef.current.readTextFile(candidate.path), heading)) found.add(candidate.key);
      } catch {
        /* an unreadable note carries no mark */
      }
    }));
    return found;
  }, [heading]);

  const loadThrough = useCallback(async (dayKey: string): Promise<void> => {
    const mine = ticket.current;
    const [year, month, day] = dayKey.split("-").map(Number);
    const wanted = new Date(year, month - 1, day).getTime();
    setOlderBusy(true);
    try {
      // Bounded: a jump ten years back reads at most this many windows.
      for (let round = 0; round < 40; round++) {
        const reached = through.current;
        // Nothing between what is loaded and the wanted day is left unread: done.
        if (!candidates.current.some((c) => (reached === null || c.date.getTime() < reached) && c.date.getTime() >= wanted)) break;
        const window = await loadJournalWindow(candidates.current, reached, depsRef.current.readTextFile, heading, filter, moodProperty);
        if (mine !== ticket.current) return;
        through.current = window.through;
        setLoaded((prev) => (prev && prev.key === key
          ? { ...prev, days: [...prev.days, ...window.days.filter((d) => !prev.days.some((p) => p.path === d.path))], more: window.more }
          : prev));
        if (!window.more) break;
      }
    } catch (error) {
      if (mine === ticket.current) report(error);
    } finally {
      setOlderBusy(false);
    }
  }, [heading, moodProperty, filter, key, report]);

  const sameVault = loaded !== null && loaded.vaultKey === vaultKey;
  const days = useMemo(() => (sameVault ? loaded.days : []), [sameVault, loaded]);
  const current = sameVault && loaded.key === key;
  const tags = useMemo(() => journalTags(days), [days]);
  const dayKeys = useMemo(() => new Set(days.map((day) => day.key)), [days]);
  return {
    days,
    loading: !sameVault,
    busy: olderBusy || !current,
    more: current ? loaded.more : false,
    filter, setFilter, loadOlder, refreshPath, tags, dayKeys, loadMarkedDays, loadThrough,
  };
}
