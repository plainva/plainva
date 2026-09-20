import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@plainva/ui";
import { COMPARISON_PREFIX } from "../services/comparisonWindow";
const ComparisonWindow = lazy(() => import("./ComparisonWindow").then(m => ({ default: m.ComparisonWindow })));
import { CALENDAR_TAB_PATH, COMMENTS_TAB_PATH, GRAPH_TAB_PATH, JOURNAL_TAB_PATH, MAIL_TAB_PATH, TASKS_TAB_PATH } from "./graph/virtualPaths";

const Editor = lazy(() => import("./Editor").then((m) => ({ default: m.Editor })));
const BaseViewer = lazy(() => import("./BaseViewer").then((m) => ({ default: m.BaseViewer })));
const VaultGraphView = lazy(() => import("./graph/VaultGraphView").then((m) => ({ default: m.VaultGraphView })));
const TasksView = lazy(() => import("./tasks/TasksView").then((m) => ({ default: m.TasksView })));
const CalendarView = lazy(() => import("./pimcal/CalendarView").then((m) => ({ default: m.CalendarView })));
const MailView = lazy(() => import("./mail/MailView").then((m) => ({ default: m.MailView })));
const CommentsOverview = lazy(() => import("./comments/CommentsOverview").then((m) => ({ default: m.CommentsOverview })));
const JournalView = lazy(() => import("./journal/JournalView").then((m) => ({ default: m.JournalView })));

interface Props {
  path: string;
  onCloseTab: () => void;
  /** True for the pane the user last worked in — drives the status channel. */
  isActivePane: boolean;
  onOpenPath: (path: string) => void;
  /** Open in the OTHER pane of this window (graph "open in split"). */
  onOpenInSplit?: (path: string) => void;
  onToggleBookmark?: (path: string) => void;
  isBookmarked?: boolean;
  /** Split this window's editor area; absent when the window is already split. */
  onSplit?: (direction: "vertical" | "horizontal") => void;
  activeSplitDirection?: "vertical" | "horizontal";
}

/**
 * What one pane of an auxiliary window shows (multi-window P4).
 *
 * The same switch the central window makes, minus the chrome an auxiliary
 * window does not have: no image viewer toolbar wired to bookmarks and
 * cascade delete, no peek. Extracted from `AuxApp` so the shell stays about
 * panes, tabs and the bus, and the content mapping lives in one place.
 */
export function AuxPane({ path, onCloseTab, isActivePane, onOpenPath, onOpenInSplit, onToggleBookmark, isBookmarked, onSplit, activeSplitDirection }: Props) {
  const { t } = useTranslation();
  const fallback = <EmptyState>{t("common.loading")}</EmptyState>;

  return (
    <Suspense fallback={fallback}>
      {path.startsWith(COMPARISON_PREFIX) ? <ComparisonWindow key={path} path={path} onClose={onCloseTab} /> : path === GRAPH_TAB_PATH ? (
        <VaultGraphView
          onOpenPath={(p) => onOpenPath(p)}
          onOpenInSplit={(p) => (onOpenInSplit ?? onOpenPath)(p)}
          onToggleBookmark={onToggleBookmark}
        />
      ) : path === TASKS_TAB_PATH ? (
        <TasksView onOpenPath={(p) => onOpenPath(p)} />
      ) : path === CALENDAR_TAB_PATH ? (
        <CalendarView onOpenPath={(p) => onOpenPath(p)} isActivePane={isActivePane} />
      ) : path === MAIL_TAB_PATH ? (
        <MailView onOpenPath={(p) => onOpenPath(p)} isActivePane={isActivePane} />
      ) : path === COMMENTS_TAB_PATH ? (
        <CommentsOverview onOpenPath={(p) => onOpenPath(p)} />
      ) : path === JOURNAL_TAB_PATH ? (
        <JournalView onOpenPath={(p) => onOpenPath(p)} />
      ) : path.endsWith(".base") ? (
        <BaseViewer key={path} activePath={path} onOpenPath={(p) => onOpenPath(p)} />
      ) : (
        <Editor
          key={path}
          activePath={path}
          isBookmarked={isBookmarked}
          onToggleBookmark={onToggleBookmark ? () => onToggleBookmark(path) : undefined}
          onOpenPath={(p) => onOpenPath(p)}
          onSplit={onSplit}
          activeSplitDirection={activeSplitDirection}
          isActivePane={isActivePane}
        />
      )}
    </Suspense>
  );
}
