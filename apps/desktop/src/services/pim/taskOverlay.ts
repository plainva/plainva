import type { TaskRecord } from "@plainva/core";
import { parseBaseConfig, comparePlannerRows, dueDayOf, dueTaskRows, isMirroredNamespace, isOpenState, parseDueValue, plannerDbId, repeatFromNamespace, type PlannerTaskLine, type TaskPriority, type TaskState } from "@plainva/ui";
import { getTaskDatabasePath, resolveTaskCompletionModel, classifyTaskCompletion, taskDbRows, type TaskCompletionModel } from "../taskDatabase";

/**
 * Due-dated tasks, projected onto calendar surfaces (the calendar tab's task
 * overlay and the sidebar calendar's day peek): the entries of the standard
 * task database, classified with the same status model as the task
 * reconciler — and, for those surfaces, the checkboxes in notes with a `📅`
 * (TestFlight 136: a calendar that leaves them out answers "what is due on
 * this day" differently from the planner). Which checkboxes take part is the
 * shared `dueTaskRows`; the reminder scheduler asks for the database alone
 * (its decision, feedback round 2026-09-01, E3).
 */

export interface DueTask {
  /** Stable within one load (`plannerDbId` / the planner's checkbox id): a note can hold several. */
  id: string;
  source: "database" | "note";
  path: string;
  title: string;
  /** YYYY-MM-DD */
  due: string;
  /**
   * Minutes into the day, when the due column is a `datetime` and carries one
   * (S6). The time was always in the note; the loader used to cut it off, and
   * the task then sat in the all-day strip claiming to last all day.
   */
  dueMinutes?: number;
  done: boolean;
  /** How the box stands — a checkbox can be in progress (`[/]`) or cancelled (`[-]`). */
  state: TaskState;
  /** 1 = high … 3 = low, 0 = none: the planner's order within a day. */
  priority: TaskPriority;
  /** For a checkbox: the line it was read from, for a tick that finds it again. */
  line?: PlannerTaskLine;
  /** Carries a repeat rule — read from the INDEXED `plainva` namespace, so a
   * calendar cell never touches the disk to find out (issue #34, wave 4). A
   * mirrored provider task is never offered a repetition, so it never counts. */
  repeats: boolean;
  /** Raw `remind` property of the note (`off` or minutes) — see `taskReminders`. */
  remind?: unknown;
}

export interface DueTaskDeps {
  vaultPath: string;
  vaultAdapter: { readTextFile(path: string): Promise<string> };
  queryService: {
    queryDatabaseFiles(config: unknown): Promise<Record<string, unknown>[]>;
    /** The vault's checkboxes; needed only when the notes take part. */
    listTasks?(): Promise<TaskRecord[]>;
  };
}

/** Whether the checkboxes in notes take part — the calendar surfaces, not the reminders. */
export interface TaskOverlayOptions {
  notes?: boolean;
}

/** The overlay plus what a surface needs to WRITE a completion back: the
 * database's completion model and its date column. Both fall out of the same
 * `.base` parse, so a surface that offers ticking off does not parse it twice
 * (issue #34, wave 4). */
export interface TaskOverlay {
  tasks: DueTask[];
  completion: TaskCompletionModel | null;
  dueKey: string | null;
  /**
   * With the notes taking part: what one source could not be read for. The
   * other source's rows are still there — a calendar that loses its
   * checkboxes because the database failed (or the other way round) would
   * tell nobody anything; the surface says the failure beside what it has.
   */
  error?: unknown;
}

/** The planner's order within a day, for a calendar's rows: priority, a chosen time, the name. */
export function compareDueTasks(a: DueTask, b: DueTask): number {
  return comparePlannerRows({ ...a, dueMinutes: a.dueMinutes ?? null }, { ...b, dueMinutes: b.dueMinutes ?? null });
}

/** Read-only projection — for surfaces that only display due tasks. */
export async function loadDueTasks(deps: DueTaskDeps, options: TaskOverlayOptions = {}): Promise<DueTask[]> {
  return (await loadTaskOverlay(deps, options)).tasks;
}

/** The checkboxes with a due day, as calendar rows. */
export function noteDueTasks(notes: readonly TaskRecord[]): DueTask[] {
  const out: DueTask[] = [];
  for (const row of dueTaskRows({ notes })) {
    const due = dueDayOf(row);
    if (!due) continue;
    out.push({ id: row.id, source: "note", path: row.path, title: row.title, due, done: !isOpenState(row.state), state: row.state, priority: row.priority, line: row.line, repeats: row.repeats === true });
  }
  return out;
}

export async function loadTaskOverlay(deps: DueTaskDeps, options: TaskOverlayOptions = {}): Promise<TaskOverlay> {
  const listTasks = deps.queryService.listTasks?.bind(deps.queryService);
  if (!options.notes || !listTasks) return loadDatabaseOverlay(deps);
  // Each source on its own, as on the phone (`loadPhoneDueTasks`).
  const [database, notes] = await Promise.allSettled([loadDatabaseOverlay(deps), listTasks()]);
  const base: TaskOverlay = database.status === "fulfilled" ? database.value : { tasks: [], completion: null, dueKey: null };
  const failure = database.status === "rejected" ? database.reason : notes.status === "rejected" ? notes.reason : undefined;
  return {
    ...base,
    tasks: [...base.tasks, ...(notes.status === "fulfilled" ? noteDueTasks(notes.value) : [])],
    ...(failure !== undefined ? { error: failure } : {}),
  };
}

async function loadDatabaseOverlay(deps: DueTaskDeps): Promise<TaskOverlay> {
  const empty: TaskOverlay = { tasks: [], completion: null, dueKey: null };
  const dbPath = await getTaskDatabasePath(deps.vaultPath);
  if (!dbPath) return empty;
  let config: any;
  try {
    config = parseBaseConfig(await deps.vaultAdapter.readTextFile(dbPath));
  } catch {
    return empty;
  }
  const cols: Record<string, any> = config?.columns ?? {};
  const dueKey = Object.keys(cols).find((k) => cols[k]?.input === "date" || cols[k]?.input === "datetime") ?? null;
  const completion = resolveTaskCompletionModel(config);
  if (!dueKey) return { ...empty, completion };
  const statusModel = completion?.kind === "checkbox" ? completion.status : completion?.status ?? null;
  const rows = await deps.queryService.queryDatabaseFiles(config);
  // The priority as the task list reads it (`taskDbRows`), for the planner's order.
  const priorityOf = new Map(taskDbRows(rows, config, completion).map((row) => [row.path, row.priority ?? 0]));
  const out: DueTask[] = [];
  for (const r of rows as any[]) {
    const parsed = parseDueValue(r[dueKey]);
    if (!parsed) continue;
    const due = parsed.day;
    const statusRaw = statusModel && r[statusModel.key] != null && r[statusModel.key] !== "" ? String(r[statusModel.key]) : null;
    const done = completion
      ? classifyTaskCompletion(completion, {
          checkbox: completion.kind === "checkbox" ? r[completion.key] : undefined,
          status: statusRaw,
        }) === true
      : false;
    out.push({
      id: plannerDbId(String(r["file.path"] ?? "")),
      source: "database",
      path: String(r["file.path"] ?? ""),
      title: String(r["file.name"] ?? String(r["file.path"] ?? "").split("/").pop()?.replace(/\.md$/i, "") ?? ""),
      due,
      dueMinutes: parsed.minutes,
      done,
      state: done ? "done" : "open",
      priority: priorityOf.get(String(r["file.path"] ?? "")) ?? 0,
      repeats: !isMirroredNamespace(r["plainva"]) && repeatFromNamespace(r["plainva"]) != null,
      ...(r["remind"] !== undefined && r["remind"] !== null && r["remind"] !== "" ? { remind: r["remind"] } : {}),
    });
  }
  return { tasks: out, completion, dueKey };
}
