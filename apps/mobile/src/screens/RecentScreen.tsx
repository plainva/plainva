import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import {
  EmptyState,
  GroupCard,
  ICON,
  RECENTS_MAX,
  Row,
  RowList,
  SectionLabel,
  groupRecentsByDay,
  recentDayLabel,
  recentTimeLabel,
  type RecentDayGroup,
} from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { SwipeRow } from "../components/SwipeRow";
import { loadRecentList, type RecentListEntry } from "../lib/recentList";
import { fileRowKind, useFileRowSheet } from "../lib/useFileRowSheet";
import { vaultFileIcon } from "../lib/vaultFileIcon";
import { vaultOps, type MobileVault } from "../services/vaultService";

/**
 * "Recent" as a whole list (plan Rückmeldungen 2026-10-24, E8).
 *
 * The home screen shows the notes opened last as a band that scrolls
 * sideways — a few at a glance, and too many swipes to the end (TestFlight,
 * 22.10.). Its heading opens this list: every entry, newest first, under the
 * day it was opened (Today, Yesterday, then the dates), each row with its
 * folder and the time.
 *
 * The rows are the file list's rows: a tap opens, a hold opens the same sheet,
 * a swipe offers the same actions (`useFileRowSheet`). The one entry a list
 * that is not the vault adds is "Remove from list" — the desktop's Recently
 * opened menu has it, and it drops the entry, never the file.
 */
export function RecentScreen({
  vault,
  bump,
  onBack,
  onOpenNote,
  onOpenFolder,
  onOpenBase,
}: {
  vault: MobileVault;
  bump: number;
  onBack: () => void;
  onOpenNote: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onOpenBase: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  // The clock is read where the list is read: labels such as "Today" are
  // computed against it in render, which must stay pure for the React compiler.
  const [shown, setShown] = useState<{ groups: Array<RecentDayGroup<RecentListEntry>>; now: number; opened: boolean } | null>(null);
  const [docIcons, setDocIcons] = useState<Map<string, { icon: string; color?: string }>>(new Map());

  useEffect(() => {
    let stale = false;
    const read = () =>
      void loadRecentList(vault, RECENTS_MAX).then(({ entries, opened }) => {
        if (stale) return;
        const now = Date.now();
        setShown({ groups: groupRecentsByDay(entries, (e) => e.at, new Date(now)), now, opened });
      });
    read();
    window.addEventListener("m-recents-changed", read);
    void vault.queryService
      ?.getDocumentIcons()
      .then((m) => {
        if (!stale) setDocIcons(m);
      })
      .catch(() => {});
    return () => {
      stale = true;
      window.removeEventListener("m-recents-changed", read);
    };
  }, [vault, bump]);

  const { press, basePress, setSheet, swipeFor, sheetLayer } = useFileRowSheet({
    vault,
    bump,
    onOpenNote,
    onOpenFolder,
    onOpenBase,
    // Only a note that was OPENED is on the list; a first run shows recently
    // changed notes instead, and there is nothing to take off.
    onRemoveFromList: shown?.opened ? (path) => void vaultOps.forgetRecent(vault, path).catch(() => {}) : undefined,
  });

  const words = { today: t("mobile.today"), yesterday: t("mobile.yesterday"), earlier: t("mobile.recentEarlier") };
  const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : t("mobile.vaultRoot"));

  const row = (entry: RecentListEntry) => {
    const kind = fileRowKind(entry.path);
    const hold = kind === "base" ? basePress : press;
    const target = { path: entry.path, title: entry.title };
    const subtitle = [folderOf(entry.path), entry.at ? recentTimeLabel(entry.at, i18n.language) : null].filter(Boolean).join(" · ");
    return (
      <SwipeRow actions={swipeFor(target, kind)} key={entry.path}>
        <Row
          data-recent-path={entry.path}
          icon={vaultFileIcon(entry.path, docIcons)}
          onClick={() => {
            if (!hold.clicked()) return;
            if (kind === "base") onOpenBase(entry.path);
            else onOpenNote(entry.path);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setSheet({ ...target, isBase: kind === "base" });
          }}
          onPointerCancel={hold.clear}
          onPointerDown={() => hold.start(target)}
          onPointerLeave={hold.clear}
          onPointerUp={hold.clear}
          subtitle={subtitle}
          title={entry.title}
        />
      </SwipeRow>
    );
  };

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("mobile.recent")} />
      {shown !== null && shown.groups.length === 0 && (
        <EmptyState icon={<Clock size={ICON.empty} />}>{t("mobile.recentEmpty")}</EmptyState>
      )}
      {shown !== null && shown.groups.length > 0 && (
        <div data-testid="recent-list">
          {shown.groups.map((group) => (
            <Fragment key={group.key}>
              <SectionLabel>{recentDayLabel(group, words, i18n.language, new Date(shown.now))}</SectionLabel>
              <GroupCard>
                <RowList>{group.items.map(row)}</RowList>
              </GroupCard>
            </Fragment>
          ))}
        </div>
      )}
      {sheetLayer}
    </div>
  );
}
