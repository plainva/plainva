import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, NotebookPen, NotebookText } from "lucide-react";
import type { JournalEntry } from "@plainva/core";
import {
  Button, Chip, DateJumpPicker, EmptyState, Fab, ICON, IconButton, JournalCaptureField, JournalDayList, SearchField,
  errorText, isJournalFiltered, journalRowActions, loadImageBlob, NO_JOURNAL_FILTER, setPendingSearchJump, toast,
  useJournalActions, useJournalFeed, useTodayKey, useWeekStartDay,
  type JournalDay, type JournalRowCaps,
} from "@plainva/ui";
import { Browser } from "@capacitor/browser";
import { AppBar } from "../components/AppBar";
import { RowActionSheet } from "../components/RowActionSheet";
import { SheetGrip } from "../components/SheetGrip";
import { SwipeRow } from "../components/SwipeRow";
import { useLongPress } from "../lib/useLongPress";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { journalFailureText, journalFiles, journalHeading, onJournalWrite } from "../services/journalService";
import { getMobileSettings } from "../services/mobileSettings";
import { vaultOps, type MobileVault } from "../services/vaultService";

/**
 * The journal as a screen (plan Journal, J5) — the phone's twin of the desktop
 * tab: every day's entries as one stream, the newest on top. Swipe and hold
 * read the same list of actions as the desktop's context menu
 * (`journalRowActions`), the "more" button of a row opens the same sheet, and
 * every action runs through the hook the desktop uses (`useJournalActions`).
 */
export function JournalScreen({
  vault,
  bump,
  onBack,
  onMenu,
  onOpenNote,
  onNewEntry,
}: {
  vault: MobileVault;
  bump: number;
  onBack?: () => void;
  onMenu?: () => void;
  onOpenNote: (path: string) => void;
  /** Opens the capture sheet (the app hosts it, so the FAB and the shortcut share it). */
  onNewEntry: () => void;
}) {
  const { t } = useTranslation();
  const todayKey = useTodayKey();
  const weekStart = useWeekStartDay();
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);
  const files = useMemo(() => journalFiles(vault), [vault]);
  const ms = getMobileSettings();
  const heading = journalHeading();
  const settings = useMemo(() => ({ folder: ms.dailyFolder, format: ms.dailyFormat, heading }), [ms.dailyFolder, ms.dailyFormat, heading]);
  const [sheet, setSheet] = useState<{ title: string; caps: JournalRowCaps } | null>(null);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [pendingJump, setPendingJump] = useState<string | null>(null);

  const feed = useJournalFeed({
    vaultKey: vault.vaultId,
    settings,
    listNotePaths: useCallback(async () => (vault.queryService ? (await vault.queryService.listNotes()).map((n) => n.path) : []), [vault]),
    readTextFile: useCallback((path: string) => vaultOps.read(vault, path), [vault]),
    version: bump,
    changedPaths: null,
    onError: (error) => toast.error(errorText(error)),
  });
  const { filter, setFilter, refreshPath, loadThrough, days, busy } = feed;

  // An own write names its note: only that day is read again, at once.
  useEffect(() => onJournalWrite(refreshPath), [refreshPath]);

  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setFilter((f) => (f.text === query ? f : { ...f, text: query })), 220);
    return () => clearTimeout(timer);
  }, [query, setFilter]);

  const showInNote = useCallback((day: Pick<JournalDay, "path">, entry: JournalEntry) => {
    setPendingSearchJump({ path: day.path, term: entry.source[0].slice(0, 80) });
    onOpenNote(day.path);
  }, [onOpenNote]);

  const actions = useJournalActions({ files, heading, failureText: journalFailureText, onChanged: refreshPath, onShowInNote: showInNote });

  const loadImage = useCallback((path: string) => loadImageBlob(vault.adapter, path), [vault]);
  const links = useMemo(() => ({
    onOpenNote: (target: string) => {
      void vaultOps.resolveWikiTarget(vault, target).then((path) => { if (path) onOpenNote(path); }).catch(() => undefined);
    },
    onOpenUrl: (url: string) => { void Browser.open({ url }).catch(() => undefined); },
    onOpenTag: (tag: string) => setFilter((f) => ({ ...f, tag })),
  }), [vault, onOpenNote, setFilter]);

  // The list of actions lives in @plainva/ui (Design-Runde E2): the desktop's
  // context menu reads the same one.
  const rowActions = (caps: JournalRowCaps) => journalRowActions(t, caps).map((s) => ({ icon: <s.icon size={ICON.head} />, label: s.label, danger: s.danger, swipe: s.swipe, testId: `journal-ctx-${s.id}`, onClick: s.run }));

  const rowPress = useLongPress<() => void>((show) => show());
  const startRowPress = (e: ReactPointerEvent, show: () => void) => {
    if ((e.target as HTMLElement).closest("button,a,input,select,textarea,label")) return;
    rowPress.start(show);
  };
  const sheetTitle = (entry: JournalEntry) => `${entry.time} ${entry.text.split("\n")[0]}`.slice(0, 80);

  // A picked day: load as far back as it lies, then bring it — or the nearest
  // older day that has entries — into view.
  useEffect(() => {
    if (!pendingJump || busy) return;
    const target = days.find((day) => day.key <= pendingJump);
    if (target) ptrRef.current?.querySelector(`[data-day="${target.key}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    setPendingJump(null);
  }, [pendingJump, busy, days]);
  const jumpTo = (dayKey: string) => {
    setJumpOpen(false);
    void loadThrough(dayKey).then(() => setPendingJump(dayKey));
  };

  const filtered = isJournalFiltered(filter);
  const empty = !feed.loading && days.length === 0;

  return (
    <div className="m-page" ref={ptrRef} data-testid="journal-screen">
      <AppBar
        large={!onBack}
        onBack={onBack}
        onMenu={onMenu}
        title={t("journal.title")}
        actions={
          <IconButton label={t("journal.jumpToDay")} onClick={() => setJumpOpen(true)} data-testid="journal-jump">
            <CalendarDays size={ICON.head} />
          </IconButton>
        }
      />
      {ptrIndicator}
      <SearchField value={query} onValueChange={setQuery} placeholder={t("journal.search")} aria-label={t("journal.search")} clearLabel={t("journal.clearFilter")} data-testid="journal-search" />
      <div className="pv-journal-filters" role="group" aria-label={t("journal.filterLabel")}>
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

      {feed.loading ? (
        <p className="m-hint" role="status">{t("journal.loading")}</p>
      ) : empty ? (
        <EmptyState
          icon={<NotebookText size={ICON.empty} />}
          title={t(filtered ? "journal.emptyFilteredTitle" : "journal.emptyTitle")}
          action={filtered
            ? <Button variant="secondary" onClick={() => { setQuery(""); setFilter(NO_JOURNAL_FILTER); }}>{t("journal.clearFilter")}</Button>
            : <Button variant="primary" onClick={onNewEntry}>{t("journal.newEntry")}</Button>}
        >
          {filtered ? t("journal.emptyFilteredText") : t("journal.emptyText", { heading })}
        </EmptyState>
      ) : (
        <JournalDayList
          compact
          days={days}
          todayKey={todayKey}
          links={links}
          loadImage={loadImage}
          onToggleTask={actions.toggle}
          onOpenNote={(day) => onOpenNote(day.path)}
          onOpenEntry={(day, entry) => { if (rowPress.clicked()) showInNote(day, entry); }}
          onMenu={(day, entry) => setSheet({ title: sheetTitle(entry), caps: actions.capsOf(day, entry) })}
          wrapRow={(day, entry, element) => <SwipeRow actions={rowActions(actions.capsOf(day, entry)).filter((a) => a.swipe)}>{element}</SwipeRow>}
          rowProps={(day, entry) => ({
            onPointerDown: (e: ReactPointerEvent) => startRowPress(e, () => setSheet({ title: sheetTitle(entry), caps: actions.capsOf(day, entry) })),
            onPointerUp: rowPress.clear,
            onPointerLeave: rowPress.clear,
            onPointerCancel: rowPress.clear,
          })}
          editing={actions.editing}
          renderEditor={(day, entry) => (
            <JournalCaptureField
              testId="journal-edit"
              autoFocus
              enterSubmits={false}
              time={entry.time}
              value={actions.editing?.text ?? ""}
              onChange={(text) => actions.setEditing((draft) => (draft ? { ...draft, text } : draft))}
              asTask={actions.editing?.asTask ?? false}
              onAsTask={(asTask) => actions.setEditing((draft) => (draft ? { ...draft, asTask } : draft))}
              onSubmit={() => actions.saveEdit(day, entry)}
              hint={null}
              extras={
                <>
                  <Button variant="ghost" size="sm" onClick={() => actions.setEditing(null)}>{t("common.cancel")}</Button>
                  <Button variant="primary" size="sm" data-testid="journal-edit-save" onClick={() => actions.saveEdit(day, entry)}>{t("journal.editSave")}</Button>
                </>
              }
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

      {/* The screen's own capture button: the app's "+" menu stays out of the way
          here (`showsCaptureFab`), and the strip under the list is reserved
          (`reservesFabStrip`), so the last row's menu is never under it. */}
      <Fab
        className="m-fab-float m-fab-float--above-tabs"
        aria-label={t("journal.newEntry")}
        icon={<NotebookPen size={ICON.touch} />}
        onClick={onNewEntry}
        data-testid="journal-new-entry"
      />

      {sheet && (
        <RowActionSheet
          title={sheet.title}
          actions={rowActions(sheet.caps).map((a) => ({ ...a, onClick: () => { setSheet(null); a.onClick(); } }))}
          onClose={() => setSheet(null)}
        />
      )}

      {jumpOpen && (
        <div className="m-sheet-backdrop" onClick={() => setJumpOpen(false)}>
          <div className="pv-sheet m-sheet" data-testid="journal-jump-sheet" onClick={(e) => e.stopPropagation()}>
            <SheetGrip onClose={() => setJumpOpen(false)} />
            <p className="m-sheet-title">{t("journal.jumpToDay")}</p>
            <DateJumpPicker
              value={todayKey}
              weekStart={weekStart}
              loadMarkedDays={feed.loadMarkedDays}
              marksRevision={bump}
              onPick={jumpTo}
              onToday={() => jumpTo(todayKey)}
              onClose={() => setJumpOpen(false)}
              size="sheet"
              testId="journal-jump-grid"
            />
          </div>
        </div>
      )}
    </div>
  );
}
