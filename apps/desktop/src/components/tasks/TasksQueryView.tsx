import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import { resolveTaskOrdinal, setChecklistTaskDone, setChecklistTaskDue, setChecklistTaskPriority, setChecklistTaskState, type ChecklistMutationResult, type TaskBoxState } from "@plainva/core";
import {
  calendarDay,
  DateJumpPopover,
  DuePicker,
  errorText,
  ICON,
  isOpenState,
  MenuItem,
  MenuLabel,
  MenuSurface,
  plannerRowCaps,
  RowActionList,
  setPendingSearchJump,
  TASKS_PLUGIN_SETTINGS_PATH,
  TaskStateIcon,
  TasksQueryBlock,
  taskRowActions,
  toast,
  useTasksForQueries,
  useTasksPluginSettings,
  useTodayKey,
  useWeekStartDay,
  type DuePick,
  type InlineLinkHandlers,
  type PlannerRow,
  type TaskPriority,
  type TaskRowSheet,
} from "@plainva/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useVault } from "../../contexts/VaultContext";
import { writeTaskNote } from "../../services/taskCompletion";
import { openLink } from "../../services/openLink";
import { useWikiResolver } from "../../hooks/useWikiResolver";

/**
 * A ```tasks block on the desktop (plan Tasks-Abfragen, T4/T5): the shared
 * `TasksQueryBlock` with the desktop's ways — the vault's tasks loaded once
 * per index state for every block (E3), a tick and the row menu (Done/Open,
 * due date, priority, state — the menu of the Tasks tab for a checkbox), and
 * a click that opens the note at the task's line.
 *
 * A change to a task in the SAME note goes through `changeNote` — the
 * editor's own transaction — when the block stands in the editor; every other
 * change through the vault's chain (`writeTaskNote`), after which an editor
 * that holds that note is told to reload it.
 */
export interface TasksQueryViewProps {
  source: string;
  notePath: string;
  /** An embedded note: the list only to look at. */
  readOnly?: boolean;
  onOpenPath?: (path: string, newTab: boolean) => void;
  onEditQuery?: (line: number | null) => void;
  changeNote?: (change: (text: string) => string | null) => boolean;
}

const NO_ANCHOR: { current: HTMLElement | null } = { current: null };
type LineChange = (text: string, ordinal: number) => ChecklistMutationResult;

export function TasksQueryView({ source, notePath, readOnly, onOpenPath, onEditQuery, changeNote }: TasksQueryViewProps) {
  const { t } = useTranslation();
  const { queryService, vaultAdapter, fileTreeVersion, indexer, triggerFileTreeUpdate } = useVault();
  const today = useTodayKey();
  const weekStart = useWeekStartDay();
  const key = String(fileTreeVersion);
  const loadTasks = useMemo(() => (queryService ? () => queryService.listTasks() : null), [queryService]);
  const { tasks } = useTasksForQueries(queryService, key, loadTasks);
  const readSettings = useMemo(() => (vaultAdapter ? () => vaultAdapter.readTextFile(TASKS_PLUGIN_SETTINGS_PATH).catch(() => null) : null), [vaultAdapter]);
  const pluginSettings = useTasksPluginSettings(vaultAdapter, key, readSettings);
  const linkLookup = useWikiResolver();
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; caps: TaskRowSheet } | null>(null);
  const [stateMenu, setStateMenu] = useState<{ at: { x: number; y: number }; row: PlannerRow } | null>(null);
  const [priorityMenu, setPriorityMenu] = useState<{ at: { x: number; y: number }; row: PlannerRow } | null>(null);
  const [dueTarget, setDueTarget] = useState<{ anchorRef: { current: HTMLElement | null }; row: PlannerRow } | null>(null);

  const links = useMemo<InlineLinkHandlers>(() => ({
    onOpenNote: (target, newTab, kind, fromPath) => {
      if (!onOpenPath) return;
      void openLink({ text: target, kind: kind ?? "wiki", sourcePath: fromPath }, { queryService, vaultAdapter, onOpenPath, newTab, t });
    },
    onOpenUrl: (url) => {
      void openUrl(url).catch((error) => toast.error(errorText(error)));
    },
  }), [onOpenPath, queryService, vaultAdapter, t]);

  /** One change to a task's line, found again in the note as it is now. */
  const writeLine = useCallback(
    async (row: PlannerRow, change: LineChange) => {
      const line = row.line;
      if (!line) return;
      const apply = (text: string): string | null => {
        const ordinal = resolveTaskOrdinal(text, line);
        if (ordinal < 0) return null;
        const result = change(text, ordinal);
        return result.changed ? result.content : null;
      };
      if (row.path === notePath && changeNote) {
        if (!changeNote(apply)) toast.info(t("tasks.promoteStale"));
        return;
      }
      if (!vaultAdapter) return;
      try {
        const update = await writeTaskNote({ vaultAdapter, indexer, triggerFileTreeUpdate }, row.path, apply);
        // An editor that holds that note takes the new text.
        if (update.changed) window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path: row.path } }));
      } catch (error) {
        console.error("[TasksQueryView] writing a task line failed", row.path, error);
        toast.error(errorText(error));
      }
    },
    [notePath, changeNote, vaultAdapter, indexer, triggerFileTreeUpdate, t],
  );

  const toggle = (row: PlannerRow) => {
    const done = isOpenState(row.state);
    void writeLine(row, (text, ordinal) => setChecklistTaskDone(text, ordinal, done, { today: calendarDay() }));
  };
  const open = (row: PlannerRow) => {
    if (!onOpenPath) return;
    if (row.line) setPendingSearchJump({ path: row.path, term: row.line.text.slice(0, 80) });
    onOpenPath(row.path, false);
  };
  const anchorAt = (at: { x: number; y: number }) => ({ current: (document.elementFromPoint(at.x, at.y) as HTMLElement | null) ?? document.body });
  const onMenu = (row: PlannerRow, at: { x: number; y: number }) => {
    // The actions a checkbox has in the Tasks tab that need no database or calendar.
    const caps = plannerRowCaps(
      row,
      {
        open,
        toggle,
        due: (r) => setDueTarget({ anchorRef: anchorAt(at), row: r }),
        priority: (r) => setPriorityMenu({ at, row: r }),
        state: (r) => setStateMenu({ at, row: r }),
      },
      { databaseTickable: false, databaseDue: false },
    );
    setMenu({ at, caps });
  };
  const pickDue = (pick: DuePick) => {
    const target = dueTarget;
    setDueTarget(null);
    if (!target || pick.day === target.row.due) return;
    void writeLine(target.row, (text, ordinal) => setChecklistTaskDue(text, ordinal, pick.day));
  };
  const applyPriority = (rank: TaskPriority) => {
    const target = priorityMenu;
    setPriorityMenu(null);
    if (target) void writeLine(target.row, (text, ordinal) => setChecklistTaskPriority(text, ordinal, rank));
  };
  const applyState = (state: TaskBoxState) => {
    const target = stateMenu;
    setStateMenu(null);
    if (target) void writeLine(target.row, (text, ordinal) => setChecklistTaskState(text, ordinal, state));
  };

  return (
    <>
      <TasksQueryBlock
        source={source}
        notePath={notePath}
        tasks={tasks}
        today={today}
        pluginSettings={pluginSettings}
        readOnly={readOnly}
        onToggle={toggle}
        onOpen={open}
        onMenu={onMenu}
        links={links}
        linkLookup={linkLookup}
        onEditQuery={onEditQuery}
      />
      {menu && (
        <MenuSurface open onClose={() => setMenu(null)} at={menu.at} ariaLabel={t("tasks.rowActions")}>
          <RowActionList build={(tt) => taskRowActions(tt, menu.caps)}>
            {(a) => (
              <MenuItem key={a.id} icon={<a.icon size={ICON.ui} />} danger={a.danger} data-testid={`tasks-query-ctx-${a.id}`} onSelect={() => { setMenu(null); a.run(); }}>
                {a.label}
              </MenuItem>
            )}
          </RowActionList>
        </MenuSurface>
      )}
      {stateMenu && (
        <MenuSurface open onClose={() => setStateMenu(null)} at={stateMenu.at} ariaLabel={t("tasks.setState")}>
          <MenuLabel>{t("tasks.setState")}</MenuLabel>
          {(["open", "progress", "done", "cancelled"] as const).map((state) => (
            <MenuItem key={state} icon={<TaskStateIcon state={state} size={ICON.ui} />} data-testid={`tasks-query-state-${state}`} onSelect={() => applyState(state)}>
              {t(state === "open" ? "tasks.open" : state === "progress" ? "tasks.stateProgress" : state === "done" ? "tasks.done" : "tasks.stateCancelled")}
            </MenuItem>
          ))}
        </MenuSurface>
      )}
      {priorityMenu && (
        <MenuSurface open onClose={() => setPriorityMenu(null)} at={priorityMenu.at} ariaLabel={t("tasks.prioritySet")}>
          <MenuLabel>{t("tasks.priority")}</MenuLabel>
          {([1, 2, 3, 0] as const).map((rank) => (
            <MenuItem key={rank} icon={<Flag size={ICON.ui} />} data-testid={`tasks-query-priority-${rank}`} onSelect={() => applyPriority(rank)}>
              {t(rank === 1 ? "tasks.priorityHigh" : rank === 2 ? "tasks.priorityMedium" : rank === 3 ? "tasks.priorityLow" : "tasks.priorityNone")}
            </MenuItem>
          ))}
        </MenuSurface>
      )}
      <DateJumpPopover open={dueTarget !== null} anchorRef={dueTarget?.anchorRef ?? NO_ANCHOR} onClose={() => setDueTarget(null)} ariaLabel={t("tasks.dueChange")} testId="tasks-query-due-picker">
        {dueTarget && (
          <DuePicker
            day={dueTarget.row.due}
            time={null}
            timeAllowed={false}
            todayKey={today}
            weekStart={weekStart}
            onPick={pickDue}
            onClose={() => setDueTarget(null)}
            autoFocus
            testId="tasks-query-due"
          />
        )}
      </DateJumpPopover>
    </>
  );
}
