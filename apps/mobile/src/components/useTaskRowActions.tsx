import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import {
  calendarDay,
  canRepeat,
  createTaskTimeBlock,
  errorText,
  ICON,
  minutesToTime,
  nextHalfHourMinutes,
  noteDisplayName,
  plannerRowCaps,
  promoteTask,
  readRepeatRule,
  resolveDefaultCalendarKey,
  setDbTaskPriority,
  taskRowActions,
  toast,
  writeRepeatRule,
  type PlannerRow,
  type PlannerRowAbilities,
  type RepeatRule,
  type TaskBlockValues,
  type TaskPriority,
  type TaskRowSheet,
} from "@plainva/ui";
import {
  resolveTaskOrdinal,
  setChecklistTaskPriority,
  setChecklistTaskState,
  setTasksPriority,
  type ChecklistMutationResult,
  type ScannedTask,
  type TaskBoxState,
  type TaskRecord,
} from "@plainva/core";
import { useLongPress } from "../lib/useLongPress";
import { RowActionSheet } from "./RowActionSheet";
import { RepeatTaskSheet } from "./RepeatTaskSheet";
import { TimeBlockSheet } from "./TimeBlockSheet";
import type { SwipeAction } from "./SwipeRow";
import { mSelect, mTargets } from "../services/mobileDialogs";
import { configuredNoteType } from "../services/newNote";
import { phoneTemplateVault } from "../services/templateVault";
import { sendTaskToProviderList } from "../services/pim/taskToProvider";
import { pimSyncNow, pimTargetForCalendarKey, writablePimCalendarOptions } from "../services/pim/pimService";
import { syncSoon } from "../services/syncService";
import { vaultOps, vaultTextFiles, type MobileVault } from "../services/vaultService";

/**
 * What a task row can do on the phone, for every list that shows one — the
 * tasks tab (its planner lists and "All") and Today → Due (TestFlight wish of
 * 2026-10-24, E1).
 *
 * The capabilities were built inside the tasks tab out of its own state, so a
 * task under Today → Due could be ticked and moved and nothing else. The RULES
 * are `plannerRowCaps` in @plainva/ui; the WAYS the phone carries them out live
 * here, once: the priority and state pickers, promotion into the database, the
 * repeat and time-block sheets, the hold that opens the row's sheet and the
 * swipe that takes the `swipe` part of the same list. A screen hands in only
 * what is its own — how it opens a task, ticks it and moves its day (the date
 * sheet stays with the screen) — and renders `element`.
 */

/** Where a checkbox stands: enough to find its line again in the note as it lies there later. */
export type NoteTaskRef = { path: string } & Pick<ScannedTask, "ordinal" | "text" | "taskId">;

/**
 * Writes one change to a checkbox line. `mutate` edits the fresh text at the
 * verified ordinal; `optimistic` is what a list that holds the task records
 * shows until the index catches up (the tasks tab hands in its gated write).
 */
export type MutateCheckbox = (
  task: NoteTaskRef,
  mutate: (fresh: string, ordinal: number) => ChecklistMutationResult,
  optimistic: (row: TaskRecord) => TaskRecord,
) => Promise<void>;

export interface TaskRowActionsOptions {
  vault: MobileVault;
  /** The vault's task database, "" without one. */
  taskDb: string;
  /** What the task database allows, as the screen has read it. */
  abilities: PlannerRowAbilities;
  /** Changes when the screen reloads: the writable calendars are read again. */
  reloadKey: string;
  open: (row: PlannerRow) => void;
  toggle: (row: PlannerRow) => void;
  /** Opens the screen's date sheet for the row. */
  due: (row: PlannerRow) => void;
  /** A write landed (or failed): the screen reads its tasks again. */
  onChanged: () => void;
  /** The screen's own write of a checkbox line; without one, the note is written and the screen reloads. */
  mutateCheckbox?: MutateCheckbox;
}

/** The line a checkbox row was read from, as a reference for a write. */
export function noteTaskRefOf(row: PlannerRow): NoteTaskRef | null {
  return row.source === "note" && row.line ? { path: row.path, ...row.line } : null;
}

export function useTaskRowActions(o: TaskRowActionsOptions) {
  const { t } = useTranslation();
  const { vault, taskDb, onChanged } = o;

  /** "Block time": `notePath` is the note that receives the anchor (a database
   *  entry has one, a checkbox does not); `linkPath` is what the event links
   *  back to. */
  const [blockTarget, setBlockTarget] = useState<{ title: string; due: string | null; notePath?: string; linkPath: string } | null>(null);
  const [repeatTarget, setRepeatTarget] = useState<{ path: string; title: string; rule: RepeatRule | null; due: string | null } | null>(null);
  const [calendarOptions, setCalendarOptions] = useState<Array<{ value: string; label: string }>>([]);

  // Writable calendars for "block time" — the SAME rule the calendar uses
  // (shared helper), so the two pickers can never disagree about which
  // calendars accept a write. Visibility is not a write permission.
  useEffect(() => {
    let alive = true;
    void writablePimCalendarOptions()
      .then((options) => {
        if (alive) setCalendarOptions(options);
      })
      .catch(() => {
        if (alive) setCalendarOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [vault, o.reloadKey]);

  const submitBlock = useCallback(
    async (values: TaskBlockValues, calendarKey: string) => {
      const target = blockTarget;
      if (!target) return;
      const provider = await pimTargetForCalendarKey(calendarKey);
      if (!provider) throw new Error(t("pim.eventWriteFailed"));
      const allPaths = vault.queryService
        ? (await vault.queryService.listNotes().catch(() => [])).map((n) => n.path)
        : [target.linkPath];
      const res = await createTaskTimeBlock({
        adapter: vault.files,
        target: provider,
        calendarKey,
        title: target.title,
        values,
        notePath: target.notePath,
        linkPath: target.linkPath,
        allPaths,
      });
      setBlockTarget(null);
      // An event that exists but could not be linked is a warning, never a
      // failure — saying "done" would hide half the outcome.
      toast.info(
        target.notePath && !res.anchored
          ? t("pim.blockNotAnchored")
          : t("pim.blockCreated", { title: target.title })
      );
      if (target.notePath) onChanged();
      pimSyncNow();
    },
    [blockTarget, vault, onChanged, t]
  );

  /** Surgical frontmatter edit of a database note, then a refresh. */
  const writeDbNote = useCallback(
    async (path: string, mutate: (raw: string) => string) => {
      try {
        if ((await vaultOps.update(vault, path, mutate)).changed) syncSoon();
        onChanged();
      } catch (e) {
        // A status, a priority, a repeat rule: each is one property of the
        // task's note. The sentence a property write gets, with the reason as
        // `errorText` reads it (finding 2026-10-12) — the bare message stood
        // here, and for a block that is no YAML that is the parser's quote of
        // the note's own line.
        toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) }));
      }
    },
    [vault, onChanged, t]
  );

  /** Without a write of the screen's own: the note as it lies there, then a reload. */
  const writeLine = useCallback<MutateCheckbox>(
    async (task, mutate) => {
      const changed = (fresh: string): string | null => {
        const ordinal = resolveTaskOrdinal(fresh, task);
        if (ordinal < 0) return null;
        const next = mutate(fresh, ordinal);
        return next.changed ? next.content : null;
      };
      try {
        if ((await vaultOps.update(vault, task.path, changed)).changed) syncSoon();
      } catch (e) {
        toast.error(errorText(e));
      } finally {
        onChanged();
      }
    },
    [vault, onChanged]
  );
  const mutateCheckbox = o.mutateCheckbox ?? writeLine;

  /** In progress and cancelled (E12) are set on request — a tap never writes them. */
  const pickState = useCallback(
    async (task: NoteTaskRef, current: TaskBoxState) => {
      const picked = await mSelect({
        title: t("tasks.setState"),
        value: current,
        options: [
          { value: "open", label: t("tasks.open") },
          { value: "progress", label: t("tasks.stateProgress") },
          { value: "done", label: t("tasks.done") },
          { value: "cancelled", label: t("tasks.stateCancelled") },
        ],
      });
      if (picked === null) return;
      const state = picked as TaskBoxState;
      await mutateCheckbox(task, (fresh, ordinal) => setChecklistTaskState(fresh, ordinal, state), (row) => ({ ...row, done: state === "done", state }));
    },
    [mutateCheckbox, t]
  );

  /**
   * Priority (plan Aufgaben-Oberfläche, B3) — the desktop's twin is the priority
   * menu in TasksView. A database entry stores it in the priority column, which
   * a database made before priorities existed gets the first time one is SET; a
   * checkbox carries the Tasks-plugin mark on its line.
   */
  const pickPriority = useCallback(
    async (target: { kind: "db"; path: string; rank: TaskPriority } | { kind: "note"; task: NoteTaskRef; rank: TaskPriority }) => {
      const current = target.rank;
      const picked = await mSelect({
        title: t("tasks.prioritySet"),
        value: String(current),
        options: [
          { value: "1", label: t("tasks.priorityHigh") },
          { value: "2", label: t("tasks.priorityMedium") },
          { value: "3", label: t("tasks.priorityLow") },
          { value: "0", label: t("tasks.priorityNone") },
        ],
      });
      if (picked === null) return;
      const rank = Number(picked) as TaskPriority;
      if (target.kind === "note") {
        await mutateCheckbox(
          target.task,
          (fresh, ordinal) => setChecklistTaskPriority(fresh, ordinal, rank),
          (row) => ({ ...row, text: setTasksPriority(row.text, rank), priority: rank || undefined }),
        );
        return;
      }
      if (!taskDb) return;
      try {
        const { columnAdded } = await setDbTaskPriority(
          { ...vaultTextFiles(vault), writeNote: writeDbNote },
          taskDb,
          target.path,
          rank,
          { key: t("tasks.dbPriorityKey"), options: [t("tasks.priorityHigh"), t("tasks.priorityMedium"), t("tasks.priorityLow")] },
        );
        if (columnAdded) toast.info(t("tasks.priorityColumnAdded", { name: columnAdded }));
        syncSoon();
        onChanged();
      } catch (e) {
        toast.error(errorText(e));
      }
    },
    [mutateCheckbox, writeDbNote, taskDb, vault, onChanged, t]
  );

  /** Promotes a checkbox into the task database — the same shared path the
   *  desktop uses, so a task promoted on either device looks identical. */
  const promote = useCallback(
    (row: PlannerRow, intoDb?: string) => {
      const dbPath = intoDb ?? taskDb;
      if (!dbPath) {
        toast.info(t("tasks.promoteNoDb"));
        return;
      }
      if (row.source !== "note" || !row.line) return;
      const task = { ordinal: row.line.ordinal, text: row.line.text, tags: [...row.tags], due: row.due, done: row.state === "done" };
      void (async () => {
        const allNotePaths = vault.queryService
          ? (await vault.queryService.listNotes().catch(() => [])).map((n) => n.path)
          : [];
        const res = await promoteTask({
          adapter: vaultTextFiles(vault),
          sourcePath: row.path,
          task,
          dbPath,
          noteType: configuredNoteType(),
          templateVault: await phoneTemplateVault(),
          allNotePaths,
          fallbackTitle: t("tasks.promoteFallbackTitle"),
        }).catch(() => null);
        if (!res || !res.ok) {
          const reason = res && !res.ok ? res.reason : null;
          if (reason === "stale") {
            toast.info(t("tasks.promoteStale"));
            onChanged();
          } else {
            toast.error(t(reason === "noFolder" ? "tasks.promoteNoFolder" : "tasks.promoteFailed"));
          }
          return;
        }
        // A promoted checkbox is a task in that database like any other (C4,
        // S17) — it takes the same route to the provider, or it would depend
        // on WHERE a task was born whether it gets there.
        await sendTaskToProviderList(vaultTextFiles(vault), dbPath, res.notePath, res.title, task.due ?? undefined);
        syncSoon();
        toast.info(t("tasks.promoted", { name: res.title }));
        onChanged();
      })();
    },
    [taskDb, vault, onChanged, t]
  );

  /**
   * Promoting into a DIFFERENT database (S31). The button uses the vault's
   * default, which is right nearly always; holding it asks instead. A vault
   * with a work list and a private one has no single right answer, and the
   * desktop already offered the choice — the phone silently did not, so a task
   * that belonged elsewhere had to be moved by hand afterwards.
   */
  const promoteInto = async (row: PlannerRow) => {
    const bases = vault.queryService ? await vault.queryService.listBases().catch(() => []) : [];
    if (bases.length === 0) {
      toast.info(t("sidebar.noDatabases"));
      return;
    }
    // The database the task moves into: the target of an action (E20).
    const picked = await mTargets({
      title: t("tasks.promoteTo"),
      options: bases.map((b) => ({ value: b.path, label: b.path === taskDb ? `${b.title} ★` : b.title })),
    });
    if (picked !== null) promote(row, picked);
  };
  const promotePress = useLongPress<PlannerRow>((row) => void promoteInto(row));

  /** The repeat rule as the note holds it now — read when the sheet opens, so no list has to carry it. */
  const openRepeat = (row: PlannerRow, known?: RepeatRule | null) => {
    const title = noteDisplayName(row.title);
    if (known !== undefined) {
      setRepeatTarget({ path: row.path, title, rule: known, due: row.due });
      return;
    }
    void vaultOps
      .read(vault, row.path)
      .then((raw) => setRepeatTarget({ path: row.path, title, rule: readRepeatRule(raw), due: row.due }))
      .catch((e) => toast.error(errorText(e)));
  };
  const openBlock = (row: PlannerRow) =>
    setBlockTarget(
      row.source === "database"
        ? { title: noteDisplayName(row.title), due: row.due, notePath: row.path, linkPath: row.path }
        : // A checkbox has no note of its own — only the event is created,
          // linking back to the note the line lives in.
          { title: row.title, due: row.due, linkPath: row.path },
    );

  /** What a task row can do: the rules of `plannerRowCaps`, carried out the phone's way. */
  const capsOf = (row: PlannerRow): TaskRowSheet =>
    plannerRowCaps(
      row,
      {
        open: o.open,
        toggle: o.toggle,
        promote: taskDb ? (r) => promote(r) : undefined,
        repeat: (r) => openRepeat(r),
        block: calendarOptions.length > 0 ? openBlock : undefined,
        due: o.due,
        priority: (r) => {
          const task = noteTaskRefOf(r);
          void pickPriority(task ? { kind: "note", task, rank: r.priority } : { kind: "db", path: r.path, rank: r.priority });
        },
        state: (r) => {
          const task = noteTaskRefOf(r);
          if (task) void pickState(task, r.state);
        },
      },
      o.abilities,
    );

  /**
   * What a task row can do, once (S22/S23).
   *
   * The sheet shows the whole list (plus "open"); the swipe shows the part of
   * the same list marked `swipe` — done, to the database, block time — like
   * every other list in the app. Until 24.10. the swipe took the whole list:
   * with six actions the strip was wider than the row and pushed it off the
   * screen, leaving nothing to swipe back (TestFlight, build 139). Both still
   * come from one definition, so a gesture and the menu cannot disagree.
   */
  const rowActions = (a: TaskRowSheet) =>
    // The list itself lives in @plainva/ui since the Design-Runde (E2): the
    // desktop's context menu reads the same one.
    taskRowActions(t, a).map((s) => ({ icon: <s.icon size={ICON.head} />, label: s.label, danger: s.danger, onClick: s.run }));
  const swipeActions = (a: TaskRowSheet): SwipeAction[] =>
    taskRowActions(t, a)
      .filter((s) => s.swipe)
      .map((s) => ({ icon: <s.icon size={ICON.head} />, label: s.label, danger: s.danger, onClick: s.run }));

  const [taskSheet, setTaskSheet] = useState<TaskRowSheet | null>(null);
  const rowPress = useLongPress<() => void>((show) => show());
  /**
   * A task row can be held too (S22). A press that starts ON one of the row's
   * own controls is left alone — the same test the row itself uses to decide
   * whether a tap was meant for it; a link in its title is one of them (E3).
   */
  const startRowPress = (e: ReactPointerEvent, show: () => void) => {
    if ((e.target as HTMLElement).closest("button,a,input,select,textarea,label")) return;
    rowPress.start(show);
  };

  const element: ReactNode = (
    <>
      {taskSheet && (
        <RowActionSheet
          actions={[
            { icon: <FileText size={ICON.head} />, label: t("mobile.sheetOpen"), onClick: () => { const x = taskSheet; setTaskSheet(null); x.open(); } },
            ...rowActions(taskSheet).map((a) => ({
              ...a,
              onClick: () => {
                setTaskSheet(null);
                a.onClick();
              },
            })),
          ]}
          onClose={() => setTaskSheet(null)}
          title={taskSheet.title}
        />
      )}

      {repeatTarget && (
        <RepeatTaskSheet
          currentDue={repeatTarget.due}
          initial={repeatTarget.rule}
          onClose={() => setRepeatTarget(null)}
          onSubmit={async (rule) => {
            const path = repeatTarget.path;
            await writeDbNote(path, (raw) => {
              if (rule && !canRepeat(raw)) throw new Error(t("tasks.repeatRemote"));
              return writeRepeatRule(raw, rule);
            });
            setRepeatTarget(null);
          }}
          taskTitle={repeatTarget.title}
        />
      )}

      {blockTarget && (
        <TimeBlockSheet
          calendarOptions={calendarOptions}
          initialCalendarKey={resolveDefaultCalendarKey(calendarOptions, "")}
          // A due task blocks on its due day by default, everything else today.
          initialDayKey={blockTarget.due ?? calendarDay()}
          initialStartTime={minutesToTime(nextHalfHourMinutes(new Date()))}
          onClose={() => setBlockTarget(null)}
          onSubmit={submitBlock}
          taskTitle={blockTarget.title}
        />
      )}
    </>
  );

  return {
    capsOf,
    rowActions,
    swipeActions,
    taskSheet,
    setTaskSheet,
    rowPress,
    startRowPress,
    writeDbNote,
    promote,
    promotePress,
    openRepeat,
    openBlock,
    canBlock: calendarOptions.length > 0,
    element,
  };
}
