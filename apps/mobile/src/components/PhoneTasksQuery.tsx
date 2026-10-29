import { useCallback, useMemo, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Browser } from "@capacitor/browser";
import { resolveTaskOrdinal, setChecklistTaskDone, setChecklistTaskDue } from "@plainva/core";
import {
  calendarDay,
  errorText,
  isOpenState,
  setPendingSearchJump,
  TASKS_PLUGIN_SETTINGS_PATH,
  TasksQueryBlock,
  toast,
  useTasksForQueries,
  useTasksPluginSettings,
  useTodayKey,
  type InlineLinkHandlers,
  type PlannerRow,
  type TaskRowSheet,
} from "@plainva/ui";
import { TaskDueSheet } from "./TaskDueSheet";
import { SwipeRow } from "./SwipeRow";
import { useTaskRowActions, type MutateCheckbox } from "./useTaskRowActions";
import { taskJumpTerm } from "../services/dueTasks";
import { openLink } from "../services/openLink";
import { syncSoon } from "../services/syncService";
import { getVaultVersion, subscribeVaultVersion } from "../services/vaultVersion";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { useLinkTargetLookup } from "../lib/useLinkTargetLookup";

/**
 * A ```tasks block on the phone (plan Tasks-Abfragen, T6): the shared
 * `TasksQueryBlock` with the phone's ways. Reading is the editor without
 * input, so the same block stands in both modes.
 *
 * - The tasks: one load per vault state for every block (E3).
 * - A tap on the box ticks; a tap on the row opens the note at the task.
 * - Holding a row opens the sheet of the Tasks tab, the swipe its strip — for
 *   a checkbox in a query: Done/Open, due date, priority, state. Moving it into
 *   the database and blocking time stay with the Tasks tab, as on the desktop.
 * - A change to a task in the SAME note goes through the editor (`changeNote`);
 *   every other change through the vault's chain.
 * - "Edit query" switches to writing first (`editQuery` of the host).
 */
export interface PhoneTasksQueryProps {
  vault: MobileVault;
  source: string;
  notePath: string;
  onOpenNote: (path: string) => void;
  /** Absent: no "Edit query" (a note that cannot be written). */
  onEditQuery?: (line: number | null) => void;
  changeNote: (change: (text: string) => string | null) => boolean;
}

export function PhoneTasksQuery({ vault, source, notePath, onOpenNote, onEditQuery, changeNote }: PhoneTasksQueryProps) {
  const { t } = useTranslation();
  const version = useSyncExternalStore(subscribeVaultVersion, getVaultVersion);
  const key = String(version);
  const today = useTodayKey();
  const service = vault.queryService;
  const loadTasks = useMemo(() => (service ? () => service.listTasks() : null), [service]);
  const { tasks } = useTasksForQueries(service, key, loadTasks);
  const readSettings = useMemo(() => () => vaultOps.read(vault, TASKS_PLUGIN_SETTINGS_PATH).catch(() => null), [vault]);
  const pluginSettings = useTasksPluginSettings(vault, key, readSettings);
  const linkLookup = useLinkTargetLookup(vault, version);
  const [dueRow, setDueRow] = useState<PlannerRow | null>(null);

  /** Every write of a task line: through the editor for this note, else through the vault. */
  const mutateCheckbox = useCallback<MutateCheckbox>(
    async (task, mutate) => {
      const apply = (text: string): string | null => {
        const ordinal = resolveTaskOrdinal(text, task);
        if (ordinal < 0) return null;
        const next = mutate(text, ordinal);
        return next.changed ? next.content : null;
      };
      if (task.path === notePath) {
        if (!changeNote(apply)) toast.info(t("tasks.promoteStale"));
        return;
      }
      try {
        if ((await vaultOps.update(vault, task.path, apply)).changed) {
          syncSoon();
          window.dispatchEvent(new CustomEvent("m-vault-changed"));
        }
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    [vault, notePath, changeNote, t],
  );

  const refOf = (row: PlannerRow) => (row.line ? { path: row.path, ...row.line } : null);
  const toggle = (row: PlannerRow) => {
    const ref = refOf(row);
    const done = isOpenState(row.state);
    if (ref) void mutateCheckbox(ref, (text, ordinal) => setChecklistTaskDone(text, ordinal, done, { today: calendarDay() }), (r) => r);
  };
  const open = (row: PlannerRow) => {
    const term = taskJumpTerm(row);
    if (term) setPendingSearchJump({ path: row.path, term });
    onOpenNote(row.path);
  };
  const actions = useTaskRowActions({
    vault,
    taskDb: "",
    abilities: { databaseTickable: false, databaseDue: false },
    reloadKey: key,
    open,
    toggle,
    due: (row) => setDueRow(row),
    onChanged: () => window.dispatchEvent(new CustomEvent("m-vault-changed")),
    mutateCheckbox,
  });
  // The actions of a checkbox in a query: those that need no database or calendar.
  const capsOf = (row: PlannerRow): TaskRowSheet => ({ ...actions.capsOf(row), promote: undefined, repeat: undefined, block: undefined });

  const links = useMemo<InlineLinkHandlers>(() => ({
    onOpenNote: (target, _newTab, kind, fromPath) => {
      void openLink({ text: target, kind: kind ?? "wiki", sourcePath: fromPath }, { vault, onOpenNote }).catch(() => undefined);
    },
    onOpenUrl: (url) => {
      void Browser.open({ url }).catch(() => undefined);
    },
  }), [vault, onOpenNote]);

  const wrapRow = (row: PlannerRow, element: ReactElement) => <SwipeRow actions={actions.swipeActions(capsOf(row))}>{element}</SwipeRow>;
  const rowProps = (row: PlannerRow) => ({
    onPointerDown: (e: ReactPointerEvent) => actions.startRowPress(e, () => actions.setTaskSheet(capsOf(row))),
    onPointerUp: actions.rowPress.clear,
    onPointerLeave: actions.rowPress.clear,
    onPointerCancel: actions.rowPress.clear,
  });

  return (
    <>
      <TasksQueryBlock
        source={source}
        notePath={notePath}
        tasks={tasks}
        today={today}
        pluginSettings={pluginSettings}
        onToggle={toggle}
        onOpen={(row) => {
          if (actions.rowPress.clicked()) open(row);
        }}
        wrapRow={wrapRow}
        rowProps={rowProps}
        links={links}
        linkLookup={linkLookup}
        onEditQuery={onEditQuery}
      />
      {/* Sheets stand over the whole screen, not inside the editor's lines. */}
      {createPortal(
        <>
          {actions.element}
          {dueRow && (
            <TaskDueSheet
              value={dueRow.due}
              time={null}
              timeAllowed={false}
              onClose={() => setDueRow(null)}
              onPick={(pick) => {
                const row = dueRow;
                setDueRow(null);
                const ref = refOf(row);
                if (ref && pick.day !== row.due) void mutateCheckbox(ref, (text, ordinal) => setChecklistTaskDue(text, ordinal, pick.day), (r) => r);
              }}
            />
          )}
        </>,
        document.body,
      )}
    </>
  );
}
