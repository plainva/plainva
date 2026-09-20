import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { JournalEntry } from "@plainva/core";
import { ICON, JournalDaySection, journalRowActions, loadImageBlob, setPendingSearchJump, useJournalActions, useJournalDay, useTodayKey, type JournalDay, type JournalRowCaps } from "@plainva/ui";
import { Browser } from "@capacitor/browser";
import { RowActionSheet } from "./RowActionSheet";
import { SwipeRow } from "./SwipeRow";
import { useLongPress } from "../lib/useLongPress";
import { captureJournalEntry, journalFailureText, journalFiles, journalHeading, onJournalWrite } from "../services/journalService";
import { getMobileSettings } from "../services/mobileSettings";
import { vaultOps, type MobileVault } from "../services/vaultService";

/**
 * "Journal" on the Today screen (plan Journal, J5): the entries of the selected
 * day with a field that writes into exactly that day, and the way to all days.
 * Rows, swipe, hold and sheet are the journal screen's — one list of actions,
 * one hook that runs them.
 */
export function TodayJournalSection({ vault, bump, dayKey, onOpenNote, onOpenJournal }: {
  vault: MobileVault;
  bump: number;
  /** The selected day, `YYYY-MM-DD`. */
  dayKey: string;
  onOpenNote: (path: string) => void;
  onOpenJournal: () => void;
}) {
  const { t } = useTranslation();
  const todayKey = useTodayKey();
  const ms = getMobileSettings();
  const heading = journalHeading();
  const settings = useMemo(() => ({ folder: ms.dailyFolder, format: ms.dailyFormat, heading }), [ms.dailyFolder, ms.dailyFormat, heading]);
  const files = useMemo(() => journalFiles(vault), [vault]);
  const readTextFile = useCallback((path: string) => vaultOps.read(vault, path), [vault]);
  const { path, date, entries, refresh } = useJournalDay({ vaultKey: vault.vaultId, dayKey, settings, readTextFile, version: bump });
  const day: JournalDay = useMemo(() => ({ key: dayKey, date, path, entries }), [dayKey, date, path, entries]);
  const [sheet, setSheet] = useState<{ title: string; caps: JournalRowCaps } | null>(null);

  // An own write — from here, the capture sheet or the journal screen — names its note.
  useEffect(() => onJournalWrite((changed) => { if (changed === path) refresh(); }), [path, refresh]);

  const showInNote = useCallback((target: Pick<JournalDay, "path">, entry: JournalEntry) => {
    setPendingSearchJump({ path: target.path, term: entry.source[0].slice(0, 80) });
    onOpenNote(target.path);
  }, [onOpenNote]);
  const actions = useJournalActions({ files, heading, failureText: journalFailureText, onChanged: refresh, onShowInNote: showInNote });

  const loadImage = useCallback((imagePath: string) => loadImageBlob(vault.adapter, imagePath), [vault]);
  const links = useMemo(() => ({
    onOpenNote: (target: string) => {
      void vaultOps.resolveWikiTarget(vault, target).then((resolved) => { if (resolved) onOpenNote(resolved); }).catch(() => undefined);
    },
    onOpenUrl: (url: string) => { void Browser.open({ url }).catch(() => undefined); },
    onOpenTag: onOpenJournal,
  }), [vault, onOpenNote, onOpenJournal]);

  const rowActions = (caps: JournalRowCaps) => journalRowActions(t, caps).map((s) => ({ icon: <s.icon size={ICON.head} />, label: s.label, danger: s.danger, swipe: s.swipe, testId: `journal-ctx-${s.id}`, onClick: s.run }));
  const rowPress = useLongPress<() => void>((show) => show());
  const startRowPress = (e: ReactPointerEvent, show: () => void) => {
    if ((e.target as HTMLElement).closest("button,a,input,select,textarea,label")) return;
    rowPress.start(show);
  };
  const sheetTitle = (entry: JournalEntry) => `${entry.time} ${entry.text.split("\n")[0]}`.slice(0, 80);

  return (
    <>
      <JournalDaySection
        day={day}
        todayKey={todayKey}
        actions={actions}
        enterSubmits={false}
        links={links}
        loadImage={loadImage}
        onCapture={async (text) => (await captureJournalEntry(vault, { text, task: false, date })) !== null}
        onOpenAll={onOpenJournal}
        onOpenEntry={(target, entry) => { if (rowPress.clicked()) showInNote(target, entry); }}
        onMenu={(target, entry) => setSheet({ title: sheetTitle(entry), caps: actions.capsOf(target, entry) })}
        wrapRow={(target, entry, element) => <SwipeRow actions={rowActions(actions.capsOf(target, entry)).filter((a) => a.swipe)}>{element}</SwipeRow>}
        rowProps={(target, entry) => ({
          onPointerDown: (e: ReactPointerEvent) => startRowPress(e, () => setSheet({ title: sheetTitle(entry), caps: actions.capsOf(target, entry) })),
          onPointerUp: rowPress.clear,
          onPointerLeave: rowPress.clear,
          onPointerCancel: rowPress.clear,
        })}
      />
      {sheet && (
        <RowActionSheet
          title={sheet.title}
          actions={rowActions(sheet.caps).map((a) => ({ ...a, onClick: () => { setSheet(null); a.onClick(); } }))}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}
