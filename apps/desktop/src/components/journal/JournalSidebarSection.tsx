import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { JournalEntry } from "@plainva/core";
import {
  ICON, JournalDaySection, MenuItem, MenuSurface, RowActionList, errorText, journalRowActions, loadImageBlob, localIsoKey, setPendingSearchJump, toast,
  useJournalActions, useJournalDay, useTodayKey,
  type JournalDay, type JournalFeedSettings, type JournalRowCaps, type JournalWriteFailure,
} from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { journalFailureKey, readJournalHeading, useJournalCapture, useJournalFiles } from "../../hooks/useJournal";
import { readDailyNoteConfig } from "../../services/dailyNotes";

/**
 * "Journal" under the sidebar calendar (plan Journal, J5): the entries of the
 * day the sidebar is about — the open daily note's day, otherwise today — with
 * a field that writes into exactly that day. The phone's twin sits on its Today
 * screen; both draw the shared `JournalDaySection`.
 */
export function JournalSidebarSection({ activeDate, onOpenPath, onOpenJournal }: {
  /** Date of the open daily note; `null` = today. */
  activeDate: Date | null;
  onOpenPath: (path: string, newTab?: boolean) => void;
  onOpenJournal: () => void;
}) {
  const { t } = useTranslation();
  const { vaultPath, vaultAdapter, queryService, fileTreeVersion } = useVault();
  const files = useJournalFiles();
  const capture = useJournalCapture();
  const todayKey = useTodayKey();
  const dayKey = activeDate ? localIsoKey(activeDate) : todayKey;
  const [settings, setSettings] = useState<JournalFeedSettings | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; caps: JournalRowCaps } | null>(null);

  useEffect(() => {
    if (!vaultPath) return;
    let alive = true;
    void (async () => {
      const [config, heading] = await Promise.all([readDailyNoteConfig(vaultPath), readJournalHeading(vaultPath)]);
      if (alive) setSettings((prev) => (prev && prev.folder === config.folder && prev.format === config.format && prev.heading === heading ? prev : { folder: config.folder, format: config.format, heading }));
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [vaultPath, fileTreeVersion]);

  const readTextFile = useCallback((path: string) => (vaultAdapter ? vaultAdapter.readTextFile(path) : Promise.reject(new Error("no vault"))), [vaultAdapter]);
  const heading = settings?.heading ?? "Journal";
  const { path, date, entries, refresh } = useJournalDay({
    vaultKey: vaultPath ?? "",
    dayKey,
    settings: settings ?? { folder: "", format: "YYYY-MM-DD", heading: "Journal" },
    readTextFile,
    version: fileTreeVersion,
  });
  const day: JournalDay = useMemo(() => ({ key: dayKey, date, path, entries }), [dayKey, date, path, entries]);

  const showInNote = useCallback((target: Pick<JournalDay, "path">, entry: JournalEntry) => {
    setPendingSearchJump({ path: target.path, term: entry.source[0].slice(0, 80) });
    onOpenPath(target.path, false);
  }, [onOpenPath]);
  const actions = useJournalActions({
    files,
    heading,
    failureText: useCallback((reason: JournalWriteFailure) => t(journalFailureKey(reason)), [t]),
    onChanged: refresh,
    onShowInNote: showInNote,
  });

  const loadImage = useMemo(() => (vaultAdapter ? (imagePath: string) => loadImageBlob(vaultAdapter, imagePath) : undefined), [vaultAdapter]);
  const links = useMemo(() => ({
    onOpenNote: (target: string, newTab: boolean) => {
      void (queryService ? queryService.resolveNotePath(target) : Promise.resolve(null))
        .then((resolved) => onOpenPath(resolved ?? target, newTab))
        .catch(() => onOpenPath(target, newTab));
    },
    onOpenUrl: (url: string) => { void openUrl(url).catch((error) => toast.error(errorText(error))); },
    onOpenTag: onOpenJournal,
  }), [onOpenPath, onOpenJournal, queryService]);

  if (!settings || !vaultPath) return null;
  return (
    <>
      <JournalDaySection
        day={day}
        todayKey={todayKey}
        actions={actions}
        links={links}
        loadImage={loadImage}
        onCapture={async (text) => (await capture({ text, task: false, date })) !== null}
        onOpenAll={onOpenJournal}
        onOpenEntry={showInNote}
        onMenu={(target, entry, at) => setMenu({ at, caps: actions.capsOf(target, entry) })}
      />
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
    </>
  );
}
