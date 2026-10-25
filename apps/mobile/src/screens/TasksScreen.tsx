import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Browser } from "@capacitor/browser";
import { consumePendingNew } from "@plainva/ui";
import { emptyKeptList, keptListFailed, keptListLoaded, keptListLoading, keptListMap, keptListRows } from "@plainva/ui";
import { Banner, CalendarSyncNotice, errorText, syncProblemsFor, useTaskDuplicates } from "@plainva/ui";
import type { PimSyncProblem } from "@plainva/core";
import { convertDueColumnToDateTime, offerDueTimeColumn, TaskPriorityFlag } from "@plainva/ui";
import { buildPlanner, doneTasksOnDay, isOpenState, plannerRowsForTree, plannerRowsFromDb, plannerRowsFromTasks, TaskPlannerList, TaskPlannerNav, TaskTitle, useTodayKey, type CaptureResult, type PlannerRow } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import { CalendarClock, CalendarPlus, Database, RefreshCw, Repeat, Table, Eye, EyeOff} from "lucide-react";
import { dueTimeOf, overdueToDayChanges, TaskCheckButton, taskDueMovedText, type DuePick, type TaskDueChange, type TaskDueOutcome } from "@plainva/ui";
import { TaskDueSheet } from "../components/TaskDueSheet";
import { announceTaskDue, moveTaskDueOnPhone } from "../services/taskDueAction";
import { applyTaskStatusOption, Button, checkboxJumpTerm, Chip, formatDueLabel, NotePath, createTaskInDatabase, describeRule, EmptyState, useTaskViewState, filterTaskDbRows, filterTasks, GroupCard, groupTasksByNote, ICON, IconButton, isMirroredNamespace, isRecurringAtProviderNamespace, calendarDay, noteDisplayName, parseBaseConfig, repeatFromNamespace, type RepeatRule, resolveTaskCompletionModel, Row, RowList, SearchField, SectionLabel, setNoteTaskExclusion, Segmented, setPendingSearchJump, statusModelOf, type TaskCompletionModel, taskDbDueKey, type TaskDbRow, taskDbRows, TaskMetadataDetails, TaskMutationGate, toast, toggleTaskAtIndex } from "@plainva/ui";
import {
  isOpenTaskState, resolveTaskOrdinal, type ChecklistMutationResult,
  setFrontmatterPath,
  type TaskRecord,
  deleteFrontmatterPath,
  trimEndChars,
} from "@plainva/core";
import { SwipeRow } from "../components/SwipeRow";
import { useTaskRowActions, type NoteTaskRef } from "../components/useTaskRowActions";
import { TaskDuplicatesSheet } from "../components/TaskDuplicatesSheet";
import { TaskNamesNotice } from "../components/TaskNamesNotice";
import { TaskCaptureSheet } from "../components/TaskCaptureSheet";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { getMobileSettings } from "../services/mobileSettings";
import { configuredNoteType } from "../services/newNote";
import { phoneTemplateVault } from "../services/templateVault";
import { providerListLabel, sendTaskToProviderList } from "../services/pim/taskToProvider";
import { mSelect } from "../services/mobileDialogs";
import { openLink } from "../services/openLink";
import { setTaskDone } from "../services/taskCompletionAction";
import { getPimCache, pimForegroundSync, pimSyncNow } from "../services/pim/pimService";
import { syncSoon } from "../services/syncService";
import { vaultOps, vaultTextFiles, type MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";

/**
 * Tasks on the phone (plan P7, S22/S23).
 *
 * Two sections, the same two the desktop has: the vault's task DATABASE (row
 * based — one note per task, with status and due date) and every `- [ ]` in the
 * vault grouped by note (line based — the aggregation a `.base` structurally
 * cannot do). Which tasks a filter leaves, what "done" means in a database and
 * how a checkbox is promoted all come from `@plainva/ui`, so this screen and
 * the desktop answer those questions identically.
 *
 * OKF-safe: checking a box rewrites exactly the one `[ ]`/`[x]` character; a
 * database entry is an ordinary note whose frontmatter is edited surgically.
 */

/**
 * The due date as a short phrase rather than a stored day key (E3).
 *
 * It was a warning-toned CHIP holding `2026-08-08`: a box the same width for
 * every task, so the one date a reader acts on looked like all the others. As
 * text it can lean on colour instead — warning while it is due or overdue,
 * muted once it is merely upcoming. That is the inverse of the event rule and
 * deliberate: a past event is over, a past task is the one still wanting doing.
 */
function DueText({ due, testId, onPress }: { due: string; testId: string; onPress?: () => void }) {
  const { t, i18n } = useTranslation();
  const label = formatDueLabel(due, { locale: i18n.language, t });
  // A date that can be moved is a control (plan Befunde 2026-10-06, W2): the
  // same chip the planner rows carry, so a tap on it opens the date picker
  // here too. Colour still does the leaning — warning only while it is due.
  if (onPress) {
    return (
      <Chip testId={testId} tone={label.tone === "due" ? "warning" : "muted"} icon={<CalendarClock size={ICON.meta} />} onClick={onPress}>
        {label.text}
      </Chip>
    );
  }
  return (
    <span className={label.tone === "due" ? "m-taskdue m-taskdue--due" : "m-taskdue"} data-testid={testId}>
      {label.text}
    </span>
  );
}

export function TasksScreen({
  vault,
  bump,
  onBack,
  onMenu,
  onOpenNote,
  onOpenBase,
  onCaptureJournal,
}: {
  vault: MobileVault;
  bump: number;
  onBack?: () => void;
  /** App settings in the leading slot of a root surface (N1.5). */
  onMenu?: () => void;
  onOpenNote: (path: string) => void;
  onOpenBase?: (path: string) => void;
  /** The capture sheet's other kind (plan Journal, J4): the app's journal sheet takes the typed text. */
  onCaptureJournal?: (text: string) => void;
}) {
  const { t } = useTranslation();
  // The list stays on screen while it reloads (finding 2026-09-20, the
  // desktop's twin in TasksView): the rows remember which query service they
  // came from, only another vault blanks the view, and a failed reload keeps
  // what is there (lib/keptList). `loading` used to go up on EVERY index
  // change, and the list drew nothing while it was up.
  const taskSource = vault.queryService ?? null;
  const [taskList, setTaskList] = useState(() => emptyKeptList<TaskRecord, NonNullable<typeof taskSource>>());
  const tasks = useMemo(() => keptListRows(taskList, taskSource), [taskList, taskSource]);
  const loading = keptListLoading(taskList, taskSource);
  const setTasks = useCallback((change: (prev: TaskRecord[]) => TaskRecord[]) => setTaskList((prev) => keptListMap(prev, change)), []);
  const { status, text, folder, tag, dueOnly, showHidden, subtasks, details, list, setStatus, setText, setFolder, setTag, setDueOnly, setShowHidden, setSubtasks, setDetails, setList, resetFilters } = useTaskViewState(vault.vaultId);
  const [tick, setTick] = useState(0);
  // Known from the first render on (plan Befunde 2026-09-24, E28). "New task"
  // from the ＋ menu on another tab, the palette, the launcher shortcut and the
  // journal's handover open this tab with the request already parked, and the
  // first effect serves it: an empty first value read as "this vault has no
  // task database" there, and the request was taken and dropped — the tab
  // opened without its sheet, and the journal's typed text was lost. The effect
  // below keeps the value current when the vault or its settings change.
  const [taskDb, setTaskDb] = useState(() => getMobileSettings().taskDatabase.trim());
  const [dbRows, setDbRows] = useState<TaskDbRow[] | null>(null);
  const [dbCompletion, setDbCompletion] = useState<TaskCompletionModel | null>(null);
  /** The database's date column — where a generated occurrence writes its
   *  next due date. Resolved from the schema, never from a column name. */
  const [dbDueKey, setDbDueKey] = useState<string | null>(null);
  /** Repeat rule + provider origin per row, read from the INDEXED `plainva`
   *  namespace — so a badge costs no file read. */
  const [dbMeta, setDbMeta] = useState<Record<string, { repeat: RepeatRule | null; mirrored: boolean; providerRepeats: boolean }>>({});
  // A listTasks() read is asynchronous; a checkbox write can finish while an
  // older read is still in flight, and that older result must never roll the
  // box back to its pre-write value.
  const [gate] = useState(() => new TaskMutationGate());
  // Tasks claimed by more than one note (finding 2026-09-20) — the desktop's
  // twin is TaskDuplicatesNotice; state and rules are the shared hook's.
  const duplicatesDb = useMemo(() => (taskDb ? { dueKey: dbDueKey, completion: dbCompletion } : null), [taskDb, dbDueKey, dbCompletion]);
  const dupes = useTaskDuplicates({
    vault: vault.vaultId,
    db: duplicatesDb,
    reloadKey: `${bump}:${tick}`,
    queryService: taskSource,
    listBoundTaskNotes: () => getPimCache()?.listBoundTaskNotes() ?? Promise.resolve([]),
    readTextFile: (path) => vaultOps.read(vault, path),
    // The plain note delete: snapshot, index, sync queue. Never the task
    // deletion that makes the provider's task follow — a copy is not the task.
    deleteNote: (path) => vaultOps.remove(vault, path, { confirmed: true }),
    onRemoved: () => {
      setTick((x) => x + 1);
      syncSoon();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

  /** Promotion and creation write through vaultOps.save, so the new note lands
   *  in the index, the backup chain and the sync queue like any other write —
   *  and the line of the source note is replaced through vaultOps.update. */
  const promotionAdapter = useMemo(() => vaultTextFiles(vault), [vault]);

  // Mirrored provider tasks reach this list through the task sync, and that
  // runs at the END of a PIM cycle — which is asleep while the app is away
  // (plan Mobile-PIM-Auffrischung, P3). Opening the list asks for one.
  useEffect(() => { pimForegroundSync(); }, []);

  useEffect(() => {
    const service = vault.queryService;
    if (!service) return;
    let alive = true;
    const versionAtStart = gate.value;
    service
      .listTasks()
      .then((rows) => {
        if (alive && gate.canCommit(versionAtStart)) setTaskList(keptListLoaded(rows, service));
      })
      .catch(() => {
        // A reload that fails keeps the rows on screen; only a FIRST load of
        // this vault settles empty.
        if (alive && gate.canCommit(versionAtStart)) setTaskList((prev) => keptListFailed(prev, service));
      });
    return () => {
      alive = false;
    };
  }, [vault, bump, tick, gate]);

  // The task database: its rows, its completion model and its date column, all
  // derived from the `.base`'s own schema — never guessed by column name.
  useEffect(() => {
    const db = getMobileSettings().taskDatabase.trim();
    setTaskDb(db);
    const service = vault.queryService;
    if (!db || !service) {
      setDbRows(null);
      setDbCompletion(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const config = parseBaseConfig(await vaultOps.read(vault, db));
        const rows = await service.queryDatabaseFiles(config);
        if (!alive) return;
        const completion = resolveTaskCompletionModel(config);
        setDbCompletion(completion);
        setDbDueKey(taskDbDueKey(config));
        const raw = rows as Record<string, unknown>[];
        setDbRows(taskDbRows(raw, config, completion));
        setDbMeta(
          Object.fromEntries(
            raw.map((r) => [
              String(r["file.path"] ?? ""),
              {
                repeat: repeatFromNamespace(r["plainva"]),
                mirrored: isMirroredNamespace(r["plainva"]),
                providerRepeats: isRecurringAtProviderNamespace(r["plainva"]),
              },
            ])
          )
        );
      } catch {
        if (alive) setDbRows(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [vault, bump, tick]);

  // Which accounts and task lists are not being synced, and why (B2, 19.10.):
  // the same line the desktop's task view shows. Read again whenever a cycle
  // or a reconcile finished, so it goes once the cause is gone.
  const [syncProblems, setSyncProblems] = useState<PimSyncProblem[]>([]);
  const [pimTick, setPimTick] = useState(0);
  useEffect(() => {
    const onChanged = () => setPimTick((x) => x + 1);
    window.addEventListener("m-pim-changed", onChanged);
    window.addEventListener("m-task-sync-done", onChanged);
    return () => {
      window.removeEventListener("m-pim-changed", onChanged);
      window.removeEventListener("m-task-sync-done", onChanged);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    void (getPimCache()?.listSyncProblems() ?? Promise.resolve([]))
      .then((problems) => {
        if (alive) setSyncProblems(syncProblemsFor(problems, "tasks"));
      })
      .catch(() => {
        if (alive) setSyncProblems([]);
      });
    return () => {
      alive = false;
    };
  }, [tick, pimTick]);

  /**
   * Hidden notes come out FIRST, so the folder and tag lists offer only what
   * the user can actually reach — a folder that exists solely inside hidden
   * notes would be a filter that returns nothing.
   */
  const visibleTasks = useMemo(
    () => (showHidden ? tasks : tasks.filter((tk) => !tk.excluded)),
    [tasks, showHidden],
  );

  const folderOptions = useMemo(() => {
    const set = new Set<string>();
    for (const tk of visibleTasks) {
      const i = tk.path.lastIndexOf("/");
      if (i > 0) set.add(tk.path.slice(0, i));
    }
    return [...set].sort();
  }, [visibleTasks]);

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const tk of visibleTasks) for (const g of tk.tags) set.add(g);
    return [...set].sort();
  }, [visibleTasks]);

  const pickFolder = async () => {
    const picked = await mSelect({
      title: t("tasks.folderFilter"),
      value: folder,
      options: [{ value: "", label: t("tasks.allFolders") }, ...(folder && !folderOptions.includes(folder) ? [{ value: folder, label: `${folder} (${t("tasks.filterUnavailable")})` }] : []), ...folderOptions.map((f) => ({ value: f, label: f }))],
    });
    if (picked !== null) setFolder(picked);
  };

  const pickTag = async () => {
    const picked = await mSelect({
      title: t("tasks.tagFilter"),
      value: tag,
      options: [{ value: "", label: t("tasks.allTags") }, ...(tag && !tagOptions.includes(tag) ? [{ value: tag, label: `#${tag} (${t("tasks.filterUnavailable")})` }] : []), ...tagOptions.map((g) => ({ value: g, label: `#${g}` }))],
    });
    if (picked !== null) setTag(picked);
  };

  /**
   * Notes under the template folder that are not yet hidden — the bulk action
   * targets exactly these, and the chip goes away once none remain. Hiding is a
   * marker IN the note, so this is a write, not a preference.
   */
  const templateNotePaths = useMemo(() => {
    const base = trimEndChars(getMobileSettings().templateFolder || "Templates", "/");
    if (!base) return [];
    const seen = new Set<string>();
    for (const tk of tasks) {
      if (!tk.excluded && (tk.path === base || tk.path.startsWith(base + "/"))) seen.add(tk.path);
    }
    return [...seen];
  }, [tasks]);

  /**
   * One note in or out of the task list. The marker lives in the note. Throws
   * what the write throws; the two gestures below say it — one note in the
   * sentence a property write gets, the templates in one count. The single
   * note used to show the bare message (for a block that is no YAML, the
   * parser's quote of the note's line), the templates nothing at all (finding
   * 2026-10-12).
   */
  const writeNoteExcluded = async (path: string, excluded: boolean) => {
    await vaultOps.update(vault, path, (raw) => setNoteTaskExclusion(raw, excluded, { setFrontmatterPath, deleteFrontmatterPath }));
  };

  const setNoteExcluded = async (path: string, excluded: boolean) => {
    try {
      await writeNoteExcluded(path, excluded);
      setTick((x) => x + 1);
    } catch (e) {
      toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) }));
    }
  };

  const hideAllTemplates = async () => {
    let hidden = 0;
    let failed = 0;
    for (const path of templateNotePaths) {
      try {
        await writeNoteExcluded(path, true);
        hidden += 1;
      } catch {
        // One template that cannot be written must not stop the rest.
        failed += 1;
      }
    }
    if (failed > 0) toast.error(t("database.bulkSetPartial", { done: hidden, failed }));
    setTick((x) => x + 1);
  };

  const groups = useMemo(
    () => groupTasksByNote(filterTasks(visibleTasks, { status, text, folder, tag, dueOnly, includeHidden: true })),
    [visibleTasks, status, text, folder, tag, dueOnly]
  );
  // The database section keeps only the filters that mean anything there: a row
  // lives where its database says, and its tags are properties rather than
  // inline hashtags (the shared helper enforces exactly that).
  const dbVisible = useMemo(() => filterTaskDbRows(dbRows ?? [], { status, text, dueOnly }), [dbRows, status, text, dueOnly]);

  /**
   * ONE write path for every change to a checkbox line — the tick, and since the
   * planner the priority mark (B3); the desktop's twin is `mutateCheckbox` in
   * TasksView. `mutate` edits the fresh file at the verified ordinal,
   * `optimistic` is what the row shows until the index catches up. The line
   * is found and changed in the note as it lies there when it is written
   * (`vaultOps.update`) — and, where the note has an open conflict, in the
   * person's own version as well.
   */
  const mutateCheckbox = useCallback(
    async (task: NoteTaskRef, mutate: (fresh: string, ordinal: number) => ChecklistMutationResult, optimistic: (row: TaskRecord) => TaskRecord) => {
      gate.begin();
      // The ordinal was taken from a snapshot; if the note changed since, it
      // may point at a different line now. Checked on the text that is written.
      const changed = (fresh: string): string | null => {
        const ordinal = resolveTaskOrdinal(fresh, task);
        if (ordinal < 0) return null;
        const next = mutate(fresh, ordinal);
        return next.changed ? next.content : null;
      };
      try {
        const update = await vaultOps.update(vault, task.path, changed);
        if (changed(update.before) === null) {
          setTick((x) => x + 1);
          return;
        }
        setTasks((prev) => prev.map((tk) => (tk.path === task.path && tk.ordinal === task.ordinal ? optimistic(tk) : tk)));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        gate.finish();
        setTick(value => value + 1);
      }
    },
    [gate, vault, setTasks]
  );
  const toggle = useCallback(
    (task: TaskRecord) => {
      // A tap moves between open and done only (E12): open or in progress is
      // completed, done or cancelled is reopened. The desktop agrees.
      const complete = isOpenTaskState(task.state);
      return mutateCheckbox(task, (fresh, ordinal) => toggleTaskAtIndex(fresh, ordinal, complete), (row) => ({ ...row, done: complete, state: complete ? "done" : "open" }));
    },
    [mutateCheckbox]
  );
  /**
   * The due day (plan Befunde 2026-10-06, W2/W3) — the desktop's twin is the
   * date popover in TasksView. A tap on a task's date opens the shared date
   * picker in a sheet; the row's sheet offers the same picker, which is also how
   * a task without a date gets one. "All to today" at the Overdue heading moves
   * the whole section. Every move answers with a toast that carries Undo — the
   * same write, pointed back at the days that were there. The picker offers
   * quick choices and a time (wishes 2026-10-24, E2); a time only where the
   * task can hold one — a database entry, not a checkbox's `📅`.
   */
  const [dueTarget, setDueTarget] = useState<{ value: string | null; time: string | null; timeAllowed: boolean; change: (pick: DuePick) => TaskDueChange } | null>(null);
  const applyDue = useCallback(
    async (changes: readonly TaskDueChange[]): Promise<TaskDueOutcome | null> => {
      if (changes.length === 0) return null;
      gate.begin();
      try {
        const outcome = await moveTaskDueOnPhone(vault, dbDueKey, changes);
        const moved = new Map(outcome.lines.map((line) => [`${line.path}#${line.ordinal}`, line]));
        if (moved.size > 0) {
          setTasks((prev) => prev.map((tk) => {
            const hit = moved.get(`${tk.path}#${tk.ordinal}`);
            return hit ? { ...tk, text: hit.text, due: hit.day } : tk;
          }));
        }
        return outcome;
      } catch (e) {
        toast.error(errorText(e));
        return null;
      } finally {
        gate.finish();
        setTick((x) => x + 1);
      }
    },
    [gate, vault, dbDueKey, setTasks]
  );
  /** Applies a move and says what happened; `announce` words the success. */
  const moveDue = async (changes: readonly TaskDueChange[], announce: (outcome: TaskDueOutcome) => string) => {
    const outcome = await applyDue(changes);
    if (!outcome) return;
    announceTaskDue(outcome, { moved: announce(outcome), skipped: (count) => t("tasks.dueSkipped", { count }), undo: t("common.undo") }, (back) => void applyDue(back));
  };
  const pickDue = (pick: DuePick) => {
    const target = dueTarget;
    setDueTarget(null);
    if (!target || (pick.day === target.value && (!target.timeAllowed || pick.time === target.time))) return;
    void moveDue([target.change(pick)], () => taskDueMovedText(pick));
  };
  const dbDueChange = (path: string) => (pick: DuePick): TaskDueChange => ({ source: "database", path, day: pick.day, time: pick.time });
  const noteDueChange = (task: TaskRecord) => (pick: DuePick): TaskDueChange => ({ source: "note", path: task.path, task: { ordinal: task.ordinal, text: task.text, ...(task.taskId ? { taskId: task.taskId } : {}) }, day: pick.day });
  /** Opens the date sheet for a database entry — or not at all when its database has no date column. */
  const dueOfDb = (row: TaskDbRow) => (dbDueKey ? () => setDueTarget({ value: row.due ?? null, time: dueTimeOf(row.dueMinutes), timeAllowed: true, change: dbDueChange(row.path) }) : undefined);
  const dueOfNote = (task: TaskRecord) => () => setDueTarget({ value: task.due ?? null, time: null, timeAllowed: false, change: noteDueChange(task) });

  /**
   * Writes the NEXT occurrence of a repeating task: a copy of the note, open
   * again, with the next due date, beside the completed one. The completed note
   * stays as the record of what was done — that is the point of a generator
   * over a rule: history is real notes, not a projection.
   */
  /**
   * Ticking a database task off. The chain behind it — and above all that a
   * repeating task EARNS its next occurrence here — lives in
   * services/taskCompletionAction, because a tapped reminder does the same
   * thing and two copies would drift (S11).
   */
  const toggleDbRow = useCallback(
    (row: TaskDbRow) => {
      void setTaskDone(row.path, !row.done)
        .then((result) => {
          if (result.changed) {
            syncSoon();
            // A mirrored task reaches its provider list with the next cycle -
            // asked for now, as the desktop does after every tick.
            pimSyncNow();
          }
          setTick((x) => x + 1);
          if (result.spawnedDue) toast.info(t("tasks.repeatSpawned", { date: result.spawnedDue }));
          if (result.spawnFailed) toast.error(t("tasks.repeatFailed"));
        })
        // The tick writes the note's completion property; see `writeDbNote`.
        .catch((e) => toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) })));
    },
    [t]
  );


  /**
   * Quick capture (plan Aufgaben-Oberfläche, B2): "+ New task", the FAB and the
   * palette open a sheet with the capture field instead of a title prompt — one
   * line in, one task note out, with its date, time, priority, tags and rhythm.
   * The desktop's twin is TaskCaptureBar.
   */
  const [capture, setCapture] = useState<{ providerList: string | null; text: string } | null>(null);
  const createDbTask = useCallback((text = "") => {
    if (!taskDb) return;
    // The list the database names (C4, S17): the chip only appears when there IS one.
    void providerListLabel(promotionAdapter, taskDb)
      .catch(() => null)
      .then((name) => setCapture({ providerList: name ?? null, text }));
  }, [taskDb, promotionAdapter]);
  const createFromCapture = useCallback(
    async (result: CaptureResult, alsoAtProvider: boolean) => {
      if (!taskDb) return;
      const res = await createTaskInDatabase({
        adapter: promotionAdapter,
        dbPath: taskDb,
        title: result.title,
        noteType: configuredNoteType(),
        templateVault: await phoneTemplateVault(),
        ...(result.due ? { dueDate: result.due, dueMinutes: result.minutes } : {}),
        tags: result.tags,
        priority: result.priority,
        repeat: result.repeat,
      }).catch(() => null);
      if (!res || !res.ok) {
        toast.error(t(res && res.reason === "noFolder" ? "tasks.promoteNoFolder" : "tasks.promoteFailed"));
        return;
      }
      // The task is in the list as soon as its note is written (issue 119);
      // the provider's answer only adds the link to it. The due day goes
      // along, as it does on the desktop — it was left out here.
      if (alsoAtProvider) {
        void sendTaskToProviderList(promotionAdapter, taskDb, res.notePath, result.title, result.due ?? undefined).then(() => {
          syncSoon();
          setTick((x) => x + 1);
        });
      }
      syncSoon();
      setTick((x) => x + 1);
      setCapture(null);
      toast.success(t("tasks.captureCreated", { name: result.title }), { label: t("tasks.captureOpen"), run: () => onOpenNote(res.notePath) });
      // A database from before tasks had times types its due column as a day;
      // retyping it is offered once per database, never done unasked (E9). The
      // desktop makes the same offer in TasksView, the due picker in
      // taskDueAction — all through the one `offerDueTimeColumn`.
      if (result.minutes !== null) {
        await offerDueTimeColumn({
          readTextFile: (path) => vaultOps.read(vault, path),
          vault: vault.vaultId,
          dbPath: taskDb,
          convert: () => convertDueColumnToDateTime(vaultTextFiles(vault), taskDb),
          converted: () => syncSoon(),
        }).catch(() => undefined);
      }
    },
    [taskDb, promotionAdapter, onOpenNote, vault, t]
  );

  // "New task" from the FAB or the palette (Design-Runde E4): the shell opened
  // this tab and parked the request. Without a task database nothing can be
  // created — the section above says so, and the request is simply taken.
  useEffect(() => consumePendingNew("task", createDbTask), [createDbTask]);

  const open = (task: TaskRecord) => {
    // Opens the note AND jumps to the line — the same parking store the search
    // results use, because the editor is not mounted yet at this point.
    // The raw line: the label drops tags and Tasks fields from the middle of
    // the text, and what is left need not stand in the note.
    setPendingSearchJump({ path: task.path, term: checkboxJumpTerm(task.text) });
    onOpenNote(task.path);
  };

  const count = groups.reduce((n, g) => n + g.items.length, 0);

  // The planner (B1): both sources in one row shape, sorted into Today (with
  // Overdue on top), Upcoming, Inbox and Done. The screen's filters apply — all
  // but the status filter, which a planner list answers by itself.
  const todayKey = useTodayKey();
  const dbMetaOf = useCallback(
    (path: string) => {
      const meta = dbMeta[path];
      return meta ? { repeats: meta.repeat !== null, mirrored: meta.mirrored, repeatsAtProvider: meta.providerRepeats } : undefined;
    },
    [dbMeta]
  );
  const plannerRows = useMemo(() => {
    const db = filterTaskDbRows(dbRows ?? [], { status: "all", text, dueOnly });
    const notes = filterTasks(visibleTasks, { status: "all", text, folder, tag, dueOnly, includeHidden: true });
    return [...plannerRowsFromDb(db, dbMetaOf), ...plannerRowsFromTasks(notes)];
  }, [dbRows, dbMetaOf, visibleTasks, text, folder, tag, dueOnly]);
  // Subtasks under their task (E6): an undated subtask of an open task is
  // listed under it rather than on its own in the Inbox.
  const planner = useMemo(() => buildPlanner(subtasks ? plannerRowsForTree(plannerRows) : plannerRows, todayKey), [plannerRows, subtasks, todayKey]);
  // What was finished today, folded under Today (E5).
  const doneToday = useMemo(() => doneTasksOnDay(plannerRows, todayKey), [plannerRows, todayKey]);
  const openCount = useMemo(() => plannerRows.filter((r) => isOpenState(r.state)).length, [plannerRows]);
  const plannerSections = list === "all" ? [] : planner.sections(list);
  const plannerEmpty =
    list === "upcoming" ? t("tasks.plannerEmptyUpcoming", { days: 14 }) : list === "inbox" ? t("tasks.plannerEmptyInbox") : list === "done" ? t("tasks.plannerEmptyDone") : t("tasks.plannerEmptyToday");
  const taskOfRow = (row: PlannerRow) => tasks.find((tk) => tk.path === row.path && tk.ordinal === row.ordinal);
  const dbRowOf = (row: PlannerRow) => (dbRows ?? []).find((r) => r.path === row.path);
  /** A row opens where it lives: a checkbox at its line, a database entry as its note. */
  const openRow = (row: PlannerRow) => {
    const task = row.source === "note" ? taskOfRow(row) : undefined;
    if (task) open(task);
    else onOpenNote(row.path);
  };
  const toggleRow = (row: PlannerRow) => {
    const dbRow = row.source === "database" ? dbRowOf(row) : undefined;
    const task = row.source === "note" ? taskOfRow(row) : undefined;
    if (dbRow) toggleDbRow(dbRow);
    else if (task) void toggle(task);
  };
  const dueOfRow = (row: PlannerRow) => {
    const dbRow = row.source === "database" ? dbRowOf(row) : undefined;
    const task = row.source === "note" ? taskOfRow(row) : undefined;
    (dbRow ? dueOfDb(dbRow) : task ? dueOfNote(task) : undefined)?.();
  };
  const reloadTasks = useCallback(() => setTick((x) => x + 1), []);
  /**
   * What a task row can do (E1, 2026-10-24): the one builder the phone's task
   * lists read — this screen's planner and "All", and Today → Due. The screen
   * hands in its own ways to open, tick and date a task.
   */
  const rowKit = useTaskRowActions({
    vault,
    taskDb,
    abilities: { databaseTickable: dbCompletion !== null, databaseDue: dbDueKey !== null },
    reloadKey: `${bump}:${tick}`,
    open: (row) => openRow(row),
    toggle: (row) => toggleRow(row),
    due: (row) => dueOfRow(row),
    onChanged: reloadTasks,
    mutateCheckbox,
  });
  const { capsOf, swipeActions, setTaskSheet, rowPress, startRowPress, writeDbNote, promote, promotePress, openRepeat, openBlock, canBlock } = rowKit;

  const pickDbStatus = useCallback(
    (row: TaskDbRow) => {
      const model = dbCompletion;
      const statusModel = statusModelOf(model);
      if (!model || !statusModel) return;
      void (async () => {
        const picked = await mSelect({
          title: t("tasks.setStatus"),
          options: statusModel.options.map((o) => ({ value: o, label: o })),
          value: row.status ?? "",
        });
        if (picked === null) return;
        await writeDbNote(row.path, (raw) =>
          applyTaskStatusOption(raw, model, picked, (c, p, v) => setFrontmatterPath(c, p, v))
        );
      })();
    },
    [dbCompletion, writeDbNote, t]
  );

  /** What a planner row can do — the rows of "All" ask the same builder. Only for a row this screen still holds. */
  const plannerActs = (row: PlannerRow) => ((row.source === "database" ? dbRowOf(row) : taskOfRow(row)) ? capsOf(row) : null);
  /** A row of "All" in the planner's shape, so it asks the same builder. */
  const dbPlannerRow = (row: TaskDbRow) => plannerRowsFromDb([row], dbMetaOf)[0]!;
  const notePlannerRow = (task: TaskRecord) => plannerRowsFromTasks([task])[0]!;
  // Links in a task's title open their note (E3), read from the note the task stands in.
  const titleLinks = useMemo(() => ({
    onOpenNote: (target: string, _newTab: boolean, kind?: "wiki" | "markdown", fromPath?: string) => {
      void openLink({ text: target, kind: kind ?? "wiki", sourcePath: fromPath }, { vault, onOpenNote }).catch(() => undefined);
    },
    onOpenUrl: (url: string) => { void Browser.open({ url }).catch(() => undefined); },
  }), [vault, onOpenNote]);
  const overdueToToday = () => {
    const overdue = planner.sections("today").find((section) => section.kind === "overdue")?.rows ?? [];
    const changes = overdueToDayChanges(overdue, todayKey, (row) => taskOfRow(row));
    void moveDue(changes, (outcome) => t("tasks.overdueMoved", { count: outcome.moved }));
  };
  /* What the bar cannot otherwise say (N5.1/N7): the list groups by NOTE, so
     how much is shown and how much of it has a deadline cannot be read off it.
     Two independently counted phrases rather than one string with two numbers —
     only the first would ever pluralise. */
  const barSummary = (() => {
    const shown = count + dbVisible.length;
    const today = calendarDay();
    const due =
      groups.reduce((n, g) => n + g.items.filter((x) => x.due && x.due <= today).length, 0) +
      dbVisible.filter((r) => r.due && r.due <= today).length;
    return due > 0
      ? `${t("tasks.openCount", { count: shown })} · ${t("tasks.dueCount", { count: due })}`
      : t("tasks.openCount", { count: shown });
  })();

  return (
    <div className="m-page" ref={ptrRef}>
      {/* Only when this screen was PUSHED. As a tab root the shell's large app
          bar is already above it — two stacked headers were the visible half of
          the tab never having been wired (the other half was the router). Every
          other tab root gates the same way; refreshing at the root is the pull
          gesture, exactly as on Browse, Today, Tags, Bookmarks and Databases. */}
      <AppBar
        large={!onBack}
        onBack={onBack}
        onMenu={onMenu}
        subtitle={barSummary}
        title={t("tasks.title")}
        actions={
          <IconButton
            label={t("tasks.refresh")}
            onClick={() => {
              // A re-query alone shows what the cache already had: a task
              // ticked at the provider only arrives with a cycle (the desktop's
              // refresh has asked for one since the Google Tasks report).
              setTick((x) => x + 1);
              pimSyncNow();
            }}
          >
            <RefreshCw size={ICON.head} />
          </IconButton>
        }
      />
      {ptrIndicator}
      <CalendarSyncNotice problems={syncProblems} onRetry={pimSyncNow} />

      <TaskPlannerNav variant="segment" value={list} onChange={setList} counts={planner.counts} allCount={openCount} />

      {list === "all" && (
        <Segmented
          ariaLabel={t("tasks.title")}
          options={(["open", "done", "all"] as const).map((s) => ({
            value: s,
            label: t(`tasks.${s}`),
            testId: `tasks-filter-${s}`,
          }))}
          value={status}
          onChange={setStatus}
        />
      )}

      <SearchField
        clearLabel={t("sidebar.clearSearch")}
        onValueChange={setText}
        placeholder={t("tasks.filterText")}
        value={text}
      />

      {/* A chip row rather than four dropdowns: on 375 px the state has to be
          readable at a glance, and an active filter that looks like an inactive
          one is how a list ends up looking broken. Each chip carries its own
          value, so "Ordner: Projekte" says what it is doing. */}
      <div className="pv-filterrow" data-testid="tasks-filters">
        <Chip onClick={() => void pickFolder()} selected={folder !== ""}>
          {folder ? `${t("tasks.folderFilter")}: ${folder}${!loading && !folderOptions.includes(folder) ? ` (${t("tasks.filterUnavailable")})` : ""}` : t("tasks.folderFilter")}
        </Chip>
        <Chip onClick={() => void pickTag()} selected={tag !== ""}>
          {tag ? `#${tag}${!loading && !tagOptions.includes(tag) ? ` (${t("tasks.filterUnavailable")})` : ""}` : t("tasks.tagFilter")}
        </Chip>
        <Chip onClick={() => setDueOnly((v) => !v)} selected={dueOnly}>
          {t("tasks.dueOnly")}
        </Chip>
        <Chip onClick={() => setShowHidden((v) => !v)} selected={showHidden}>
          {t("tasks.showHidden")}
        </Chip>
        <Chip onClick={() => setSubtasks((v) => !v)} selected={subtasks} testId="tasks-filter-subtasks">
          {t("tasks.showSubtasks")}
        </Chip>
        <Chip onClick={() => setDetails((v) => !v)} selected={details} testId="tasks-filter-details">
          {t("tasks.showDetails")}
        </Chip>
        <Button variant="ghost" size="sm" onClick={resetFilters} data-testid="tasks-reset-filters">{t("tasks.resetFilters")}</Button>
        {templateNotePaths.length > 0 && (
          <Chip onClick={() => void hideAllTemplates()}>{t("tasks.hideTemplates")}</Chip>
        )}
      </div>

      <TaskNamesNotice vault={vault} reloadKey={`${bump}:${tick}`} onChanged={() => setTick((x) => x + 1)} />

      {dupes.visible && (
        <div className="m-dupes-notice">
          <Banner
            kind="info"
            rounded
            actions={
              <Button variant="secondary" size="sm" disabled={dupes.busy} onClick={() => void dupes.review()} data-testid="task-duplicates-review">
                {t("tasks.duplicatesReview")}
              </Button>
            }
          >
            <strong data-testid="task-duplicates-banner">{t("tasks.duplicatesBanner", { count: dupes.count })}</strong> {t("tasks.duplicatesHint")}
          </Banner>
        </div>
      )}

      {list !== "all" ? (
        loading ? null : (
          <TaskPlannerList
            sections={plannerSections}
            emptyLabel={plannerEmpty}
            databaseLabel={taskDb ? noteDisplayName(taskDb.split("/").pop() ?? taskDb) : t("tasks.plannerFromDatabase")}
            onToggle={(row) => plannerActs(row)?.toggle?.()}
            onOpen={(row) => {
              if (rowPress.clicked()) plannerActs(row)?.open();
            }}
            /* The same swipe and the same sheet as the two sections of "All":
               one list of actions per row, whichever list it is shown in. */
            wrapRow={(row, element) => {
              const acts = plannerActs(row);
              return acts ? <SwipeRow actions={swipeActions(acts)}>{element}</SwipeRow> : element;
            }}
            rowProps={(row) => ({
              onPointerDown: (e: ReactPointerEvent) => {
                const acts = plannerActs(row);
                if (acts) startRowPress(e, () => setTaskSheet(acts));
              },
              onPointerUp: rowPress.clear,
              onPointerLeave: rowPress.clear,
              onPointerCancel: rowPress.clear,
            })}
            onDue={(row) => plannerActs(row)?.due?.()}
            canDue={(row) => plannerActs(row)?.due !== undefined}
            onOverdueToToday={overdueToToday}
            links={titleLinks}
            subtasks={subtasks ? plannerRows : undefined}
            details={details}
            doneToday={list === "today" ? doneToday : undefined}
          />
        )
      ) : (
      <>
      {taskDb && (
        <section data-testid="task-db-section">
          <SectionLabel end={dbVisible.length || undefined}>{t("tasks.dbSection")}</SectionLabel>
          <GroupCard>
            {dbVisible.length === 0 ? (
              <p className="m-hint">{t("tasks.dbEmpty")}</p>
            ) : (
              <RowList>
                {dbVisible.map((row) => {
                  const prow = dbPlannerRow(row);
                  const acts = capsOf(prow);
                  return (
                  <SwipeRow actions={swipeActions(acts)} key={row.path}>
                  <Row
                    wrap
                    controls
                    data-testid="task-db-row"
                    icon={
                      <TaskCheckButton
                        state={row.done ? "done" : "open"}
                        label={t(row.done ? "tasks.open" : "tasks.done")}
                        testId="task-db-toggle"
                        disabled={!dbCompletion}
                        onToggle={() => toggleDbRow(row)}
                      />
                    }
                    title={
                      <span className={row.done ? "m-task-done" : undefined}><TaskPriorityFlag rank={row.priority} />{noteDisplayName(row.title)}</span>
                    }
                    subtitle={
                      <>
                        {/* A database row IS a note somewhere in the vault, and
                            nothing else on this row said where. Unlike the
                            grouped section above there is no heading to carry
                            it, so it rides along here. */}
                        <NotePath path={row.path} className="m-taskpath" />
                        {row.status && (
                          <Chip testId="task-db-status" onClick={() => pickDbStatus(row)}>
                            {row.status}
                          </Chip>
                        )}
                        {row.due && <DueText due={row.due} testId="task-db-due" onPress={dueOfDb(row)} />}
                        {/* The reconciler has seen the provider bring this task
                            round again (finding 2026-09-20): a ticked task that
                            reopens is a series, not a sync fault. */}
                        {dbMeta[row.path]?.providerRepeats && (
                          <Chip testId="task-db-provider-repeat" tone="muted" icon={<Repeat size={ICON.meta} />}>
                            {t("tasks.repeatsAtProvider")}
                          </Chip>
                        )}
                        {/* A task mirrored from a provider list keeps ITS
                            recurrence — a local generator on top would push
                            duplicates back, so it is shown, not offered. */}
                        {dbMeta[row.path]?.mirrored
                          ? dbMeta[row.path]?.repeat && (
                              <Chip testId="task-db-repeat-badge">
                                {describeRule(dbMeta[row.path].repeat as RepeatRule, (key, o) => t(key, o))}
                              </Chip>
                            )
                          : /* The recurrence is state AND the way to change it:
                               as a trailing icon it was a grey glyph competing
                               with two others; as a chip it says what the rule
                               is and opens the editor. */
                            (
                              <Chip
                                testId="task-db-repeat"
                                /* State reads as a chip, an OFFER reads quietly:
                                   without the distinction every row carried a
                                   "Wiederholung" chip that said nothing. */
                                tone={dbMeta[row.path]?.repeat ? "default" : "muted"}
                                onClick={() => openRepeat(prow, dbMeta[row.path]?.repeat ?? null)}
                                icon={<Repeat size={ICON.meta} />}
                              >
                                {dbMeta[row.path]?.repeat
                                  ? describeRule(dbMeta[row.path].repeat as RepeatRule, (key, o) => t(key, o))
                                  : t("tasks.repeat")}
                              </Chip>
                            )}
                      </>
                    }
                    end={
                      canBlock ? (
                        <IconButton
                          label={t("pim.blockTime")}
                          data-testid="task-db-block"
                          onClick={() => openBlock(prow)}
                        >
                          <CalendarPlus size={ICON.head} />
                        </IconButton>
                      ) : undefined
                    }
                    onPointerDown={(e: ReactPointerEvent) =>
                      startRowPress(e, () => setTaskSheet(acts))
                    }
                    onPointerUp={rowPress.clear}
                    onPointerLeave={rowPress.clear}
                    onPointerCancel={rowPress.clear}
                    onClick={() => {
                      if (rowPress.clicked()) onOpenNote(row.path);
                    }}
                  />
                  </SwipeRow>
                  );
                })}
              </RowList>
            )}
            {/* Left-aligned on purpose: this row sits on a surface with the
                capture FAB, and right-aligned the primary "+ New task" ended
                exactly under it (Sammelplan § 2.19). */}
            <div className="m-btnrow m-btnrow--start">
              {onOpenBase && (
                <Button variant="ghost" onClick={() => onOpenBase(taskDb)}>
                  <Table size={ICON.head} />
                  {t("tasks.openDb")}
                </Button>
              )}
              <Button variant="tonal" data-testid="task-db-new" onClick={() => createDbTask()}>
                {t("tasks.newDbTask")}
              </Button>
            </div>
          </GroupCard>
          <SectionLabel>{t("tasks.notesSection")}</SectionLabel>
        </section>
      )}

      {loading ? null : count === 0 ? (
        /* The same flow the section header's button runs — which only exists
           when a task database is set, so the offer appears exactly when it can
           be kept (N7). */
        <EmptyState
          action={
            taskDb ? (
              <Button data-testid="tasks-empty-new" onClick={() => createDbTask()} variant="tonal">
                {t("tasks.newDbTask")}
              </Button>
            ) : undefined
          }
          title={t("tasks.title")}
        >
          {t("tasks.empty")}
        </EmptyState>
      ) : (
        groups.map((group) => (
          <section key={group.path}>
            {/* Per note, not per task: hiding is a property of the NOTE. Without
                this the "show hidden" chip would be a dead end — you could see
                what is hidden and not act on it, and nothing could be hidden in
                the first place except in bulk via the template folder. */}
            <SectionLabel
              end={
                <>
                  {group.items.length}
                  <IconButton
                    data-testid="task-note-hide"
                    label={t(group.items[0]?.excluded ? "tasks.showInView" : "tasks.hideFromView")}
                    onClick={() => void setNoteExcluded(group.path, !group.items[0]?.excluded)}
                  >
                    {group.items[0]?.excluded ? <Eye size={ICON.ui} /> : <EyeOff size={ICON.ui} />}
                  </IconButton>
                </>
              }
            >
              {/* The heading is the answer to "where does this task stand", so
                  it carries the PATH, not just the file name: two notes called
                  `Fahrplan` in different folders were indistinguishable here.
                  It clips at the front, so the file name always survives. */}
              <NotePath path={group.path} />
            </SectionLabel>
            <GroupCard>
              <RowList>
                {group.items.map((task) => {
                  const prow = notePlannerRow(task);
                  const acts = capsOf(prow);
                  return (
                  /* S23: the swipe the sammelplan asked to hold back until the
                     sheet existed. Same actions, same order, one definition. */
                  <SwipeRow actions={swipeActions(acts)} key={`${task.path}:${task.ordinal}`}>
                  <Row
                    wrap
                    controls
                    data-testid="task-row"
                    icon={
                      <TaskCheckButton
                        state={task.state}
                        label={t(isOpenTaskState(task.state) ? "tasks.done" : "tasks.open")}
                        testId="task-toggle"
                        onToggle={() => void toggle(task)}
                      />
                    }
                    title={
                      <span className={isOpenTaskState(task.state) ? undefined : "m-task-done"}>
                        <TaskPriorityFlag rank={task.priority} />
                        <TaskTitle text={prow.title} notePath={task.path} links={titleLinks} />
                      </span>
                    }
                    subtitle={
                      <>
                        <TaskMetadataDetails task={task} />
                        {task.due && <DueText due={task.due} testId="task-due" onPress={dueOfNote(task)} />}
                        {task.tags.map((tag) => (
                          <Chip key={tag}>#{tag}</Chip>
                        ))}
                        {taskDb && (
                          /* Tap promotes into the default database; hold asks
                             which one (S31). It was a grey glyph competing with
                             the block-time button for the trailing slot — as a
                             NAMED chip it says what it does, which is what the
                             desktop's own promote button was given in Welle 2. */
                          <Chip
                            testId="task-promote"
                            tone="muted"
                            onClick={() => {
                              if (promotePress.clicked()) promote(prow);
                            }}
                            onPointerDown={() => promotePress.start(prow)}
                            onPointerUp={promotePress.clear}
                            onPointerLeave={promotePress.clear}
                            onPointerCancel={promotePress.clear}
                            icon={<Database size={ICON.meta} />}
                          >
                            {t("tasks.promoteShort")}
                          </Chip>
                        )}
                      </>
                    }
                    end={
                      canBlock ? (
                        <IconButton
                          label={t("pim.blockTime")}
                          data-testid="task-block"
                          onClick={() => openBlock(prow)}
                        >
                          <CalendarPlus size={ICON.head} />
                        </IconButton>
                      ) : undefined
                    }
                    onPointerDown={(e: ReactPointerEvent) =>
                      startRowPress(e, () => setTaskSheet(acts))
                    }
                    onPointerUp={rowPress.clear}
                    onPointerLeave={rowPress.clear}
                    onPointerCancel={rowPress.clear}
                    onClick={() => {
                      if (rowPress.clicked()) open(task);
                    }}
                  />
                  </SwipeRow>
                  );
                })}
              </RowList>
            </GroupCard>
          </section>
        ))
      )}
      </>
      )}

      {capture && (
        <TaskCaptureSheet
          todayKey={todayKey}
          providerList={capture.providerList}
          initialValue={capture.text}
          onClose={() => setCapture(null)}
          onSubmit={createFromCapture}
          onSwitchToJournal={onCaptureJournal ? (text) => { setCapture(null); onCaptureJournal(text); } : undefined}
        />
      )}

      {rowKit.element}

      {dueTarget && <TaskDueSheet value={dueTarget.value} time={dueTarget.time} timeAllowed={dueTarget.timeAllowed} onPick={pickDue} onClose={() => setDueTarget(null)} />}

      <TaskDuplicatesSheet
        dupes={dupes}
        onOpenNote={onOpenNote}
        onRemoved={(count) => toast.info(t("tasks.duplicatesRemoved", { count }))}
      />
    </div>
  );
}
