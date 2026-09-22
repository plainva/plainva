import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CalendarDays, ChevronRight, NotebookPen, NotebookText, Sun } from "lucide-react";
import type { JournalEntry } from "@plainva/core";
import {
  Button, Chip, DateJumpPicker, DateJumpPopover, DateJumpTrigger, EmptyState, GroupCard, ICON, JournalCaptureField, JournalDayList, MenuItem, MenuSurface, Row, RowList,
  RowActionList, SearchField, buildDailyNotePath, errorText, isJournalFiltered, journalRowActions, loadImageBlob, NO_JOURNAL_FILTER, setPendingSearchJump, toast,
  useJournalActions, useJournalFeed, useTodayKey, useWeekStartDay,
  type JournalDay, type JournalFeedSettings, type JournalRowCaps, type JournalWriteFailure,
} from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { journalFailureKey, readJournalHeading, useJournalFiles } from "../../hooks/useJournal";
import { readDailyNoteConfig } from "../../services/dailyNotes";
import { JournalCaptureDialog } from "./JournalCaptureDialog";

/**
 * The journal as a tab (plan Journal, J5): every day's entries as one stream,
 * the newest on top. The entries live in the daily notes — this view reads
 * them, and every change it makes is a change to a line of a note. What an
 * entry can do comes from `journalRowActions`, how it is done from
 * `useJournalActions`; the phone's screen reads the same two.
 */
export function JournalView({ onOpenPath, onHandoverTask }: {
  onOpenPath: (path: string, newTab?: boolean) => void;
  /** The capture dialog's kind switch; a window without the tasks view leaves it out. */
  onHandoverTask?: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { vaultPath, vaultAdapter, queryService, fileTreeVersion, fileTreeVersionPaths } = useVault();
  const files = useJournalFiles();
  const todayKey = useTodayKey();
  const weekStart = useWeekStartDay();
  const [settings, setSettings] = useState<JournalFeedSettings | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; caps: JournalRowCaps } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const jumpRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const heading = settings?.heading ?? "Journal";

  // Folder, format and heading of this vault. Read again when files changed: a
  // settings profile that syncs in arrives as a change, too.
  useEffect(() => {
    if (!vaultPath) return;
    let alive = true;
    void (async () => {
      const [config, name] = await Promise.all([readDailyNoteConfig(vaultPath), readJournalHeading(vaultPath)]);
      if (alive) setSettings((prev) => (prev && prev.folder === config.folder && prev.format === config.format && prev.heading === name ? prev : { folder: config.folder, format: config.format, heading: name }));
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [vaultPath, fileTreeVersion]);

  const feed = useJournalFeed({
    // Not before the settings are read: they usually EQUAL the defaults, and a
    // stream that loaded without them would have no reason to load again.
    vaultKey: settings && vaultPath ? vaultPath : "",
    settings: settings ?? { folder: "", format: "YYYY-MM-DD", heading: "Journal" },
    listNotePaths: useCallback(async () => (settings && queryService ? (await queryService.listNotes()).map((n) => n.path) : []), [settings, queryService]),
    readTextFile: useCallback((path: string) => (vaultAdapter ? vaultAdapter.readTextFile(path) : Promise.reject(new Error("no vault"))), [vaultAdapter]),
    version: fileTreeVersion,
    changedPaths: fileTreeVersionPaths,
    onError: (error) => toast.error(errorText(error)),
  });
  const { filter, setFilter, refreshPath, loadThrough, days, busy } = feed;

  // The search field answers at once; the stream reloads when the typing pauses —
  // every new text reads the window's notes again.
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setFilter((f) => (f.text === query ? f : { ...f, text: query })), 220);
    return () => clearTimeout(timer);
  }, [query, setFilter]);

  const showInNote = useCallback((day: Pick<JournalDay, "path">, entry: JournalEntry) => {
    setPendingSearchJump({ path: day.path, term: entry.source[0].slice(0, 80) });
    onOpenPath(day.path, false);
  }, [onOpenPath]);

  const actions = useJournalActions({
    files,
    heading,
    failureText: useCallback((reason: JournalWriteFailure) => t(journalFailureKey(reason)), [t]),
    onChanged: refreshPath,
    onShowInNote: showInNote,
  });

  const loadImage = useMemo(() => (vaultAdapter ? (path: string) => loadImageBlob(vaultAdapter, path) : undefined), [vaultAdapter]);
  const links = useMemo(() => ({
    // A wiki link names a note, not a path: the index resolves it as the editor does.
    onOpenNote: (target: string, newTab: boolean) => {
      void (queryService ? queryService.resolveNotePath(target) : Promise.resolve(null))
        .then((path) => onOpenPath(path ?? target, newTab))
        .catch(() => onOpenPath(target, newTab));
    },
    onOpenUrl: (url: string) => { void openUrl(url).catch((error) => toast.error(errorText(error))); },
    onOpenTag: (tag: string) => setFilter((f) => ({ ...f, tag })),
  }), [onOpenPath, queryService, setFilter]);

  // A picked day: load as far back as it lies, then bring it — or the nearest
  // older day that has entries — into view.
  useEffect(() => {
    if (!pendingJump || busy) return;
    const target = days.find((day) => day.key <= pendingJump);
    if (target) scrollRef.current?.querySelector(`[data-day="${target.key}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    setPendingJump(null);
  }, [pendingJump, busy, days]);

  const jumpTo = (dayKey: string) => {
    setJumpOpen(false);
    void loadThrough(dayKey).then(() => setPendingJump(dayKey));
  };

  const filtered = isJournalFiltered(filter);
  // Until the vault's settings are read there is nothing to judge: no "empty" in between.
  const loading = feed.loading || !settings;
  const empty = !loading && days.length === 0;
  const monthLabel = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(new Date(Number(todayKey.slice(0, 4)), Number(todayKey.slice(5, 7)) - 1, 1));

  return (
    <div className="pv-journal-view" data-testid="journal-view">
      <div className="pv-journal-head">
        <h2 className="pv-journal-head-title">{t("journal.title")}</h2>
        <SearchField
          className="pv-journal-head-search"
          value={query}
          onValueChange={setQuery}
          placeholder={t("journal.search")}
          aria-label={t("journal.search")}
          clearLabel={t("journal.clearFilter")}
          data-testid="journal-search"
        />
        <DateJumpTrigger
          label={<><CalendarDays size={ICON.ui} /> {monthLabel}</>}
          open={jumpOpen}
          onClick={() => setJumpOpen((o) => !o)}
          tip={t("journal.jumpToDay")}
          testId="journal-jump"
          buttonRef={jumpRef}
        />
        <DateJumpPopover open={jumpOpen} anchorRef={jumpRef} onClose={() => setJumpOpen(false)} ariaLabel={t("journal.jumpToDay")} testId="journal-jump-picker">
          <DateJumpPicker
            value={todayKey}
            weekStart={weekStart}
            loadMarkedDays={feed.loadMarkedDays}
            marksRevision={fileTreeVersion}
            onPick={jumpTo}
            onToday={() => jumpTo(todayKey)}
            onClose={() => setJumpOpen(false)}
            autoFocus
            testId="journal-jump-grid"
          />
        </DateJumpPopover>
        <Button variant="primary" size="sm" icon={<NotebookPen size={ICON.ui} />} onClick={() => setCapturing(true)} data-testid="journal-new-entry">
          {t("journal.newEntry")}
        </Button>
      </div>
      <div className="pv-filterrow" role="group" aria-label={t("journal.filterLabel")}>
        <Chip selected={!filter.tasksOnly && filter.tag === null} onClick={() => setFilter((f) => ({ ...f, tasksOnly: false, tag: null }))} testId="journal-filter-all">
          {t("journal.filterAll")}
        </Chip>
        <Chip selected={filter.tasksOnly} onClick={() => setFilter((f) => ({ ...f, tasksOnly: !f.tasksOnly }))} testId="journal-filter-tasks">
          {t("journal.filterTasks")}
        </Chip>
        {[...new Set([...(filter.tag ? [filter.tag] : []), ...feed.tags])].map((tag) => (
          <Chip key={tag} selected={filter.tag === tag} onClick={() => setFilter((f) => ({ ...f, tag: f.tag === tag ? null : tag }))} testId="journal-filter-tag">
            #{tag}
          </Chip>
        ))}
      </div>
      <div className="pv-journal-scroll" ref={scrollRef}>
        {/* The journal is the home of the day (finding 2026-09-22, E18): the
            daily note is one row at the top, the way the phone's Today screen
            has always shown it. With a filter or a query running it would be
            noise, so it stands only over the unfiltered stream. */}
        {!loading && !filtered && settings && (
          <GroupCard className="pv-journal-daily">
            <RowList>
              <Row
                icon={<Sun size={ICON.ui} />}
                title={t("journal.dailyCard", { date: new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "long" }).format(new Date()) })}
                end={<ChevronRight size={ICON.ui} />}
                onClick={() => onOpenPath(buildDailyNotePath(new Date(), settings.format, settings.folder).fullPath, false)}
                data-testid="journal-daily-card"
              />
            </RowList>
          </GroupCard>
        )}
        {loading ? (
          <p className="pv-capture-hint" role="status">{t("journal.loading")}</p>
        ) : empty ? (
          <EmptyState
            icon={<NotebookText size={ICON.empty} />}
            title={t(filtered ? "journal.emptyFilteredTitle" : "journal.emptyTitle")}
            action={filtered
              ? <Button variant="secondary" onClick={() => { setQuery(""); setFilter(NO_JOURNAL_FILTER); }}>{t("journal.clearFilter")}</Button>
              : <Button variant="primary" onClick={() => setCapturing(true)}>{t("journal.newEntry")}</Button>}
          >
            {filtered ? t("journal.emptyFilteredText") : t("journal.emptyText", { heading })}
          </EmptyState>
        ) : (
          <JournalDayList
            days={days}
            todayKey={todayKey}
            links={links}
            loadImage={loadImage}
            onToggleTask={actions.toggle}
            onOpenNote={(day) => onOpenPath(day.path, false)}
            onOpenEntry={showInNote}
            onMenu={(day, entry, at) => setMenu({ at, caps: actions.capsOf(day, entry) })}
            editing={actions.editing}
            renderEditor={(day, entry) => (
              <JournalCaptureField
                testId="journal-edit"
                autoFocus
                time={entry.time}
                value={actions.editing?.text ?? ""}
                onChange={(text) => actions.setEditing((draft) => (draft ? { ...draft, text } : draft))}
                asTask={actions.editing?.asTask ?? false}
                onAsTask={(asTask) => actions.setEditing((draft) => (draft ? { ...draft, asTask } : draft))}
                onCancel={() => actions.setEditing(null)}
                onSubmit={() => actions.saveEdit(day, entry)}
                extras={<Button variant="ghost" size="sm" onClick={() => actions.setEditing(null)}>{t("common.cancel")}</Button>}
              />
            )}
          />
        )}
        {feed.more && (
          <div className="pv-journal-more">
            <Button variant="secondary" onClick={feed.loadOlder} disabled={busy} data-testid="journal-load-older">
              {t("journal.loadOlder")}
            </Button>
          </div>
        )}
      </div>

      {capturing && (
        <JournalCaptureDialog
          onClose={() => setCapturing(false)}
          onHandoverTask={onHandoverTask ? (text) => { setCapturing(false); onHandoverTask(text); } : undefined}
        />
      )}

      {menu && (
        <MenuSurface open onClose={() => setMenu(null)} at={menu.at} ariaLabel={t("common.moreActions")}>
          <RowActionList build={(tt) => journalRowActions(tt, menu.caps)}>
            {(a) => (
              <MenuItem key={a.id} icon={<a.icon size={ICON.ui} />} danger={a.danger} data-testid={`journal-ctx-${a.id}`} onSelect={a.run}>
                {a.label}
              </MenuItem>
            )}
          </RowActionList>
        </MenuSurface>
      )}
    </div>
  );
}
