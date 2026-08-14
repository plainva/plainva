import { defineBase } from "../vaultTemplates/baseBuilders";
import { serializeBaseConfig } from "../base/baseFormat";
import { safeFileStem } from "./fileStem";
import { parseDueValue } from "../pim/dueTime";

/**
 * What "done" means in a task database — one model, both shells (S22b).
 *
 * The desktop kept this in its own service. The phone needs the same answer,
 * and the task reconciler that syncs provider lists needs it too: if the view
 * and the sync disagree about which value is "done", a completed task looks
 * open — and, worse, the reconciler can read a note as open and un-complete
 * the remote task. So there is exactly one place that decides it.
 *
 * Pure: no settings, no adapter, no React. The caller passes the parsed `.base`
 * config; where the configured database LIVES stays a per-shell setting.
 */

/** Localized strings the creation scaffold needs (passed in by the caller so
 * this module stays i18n-free and unit-testable). Values mirror the per-language
 * vault-template modules (e.g. de: frist / Offen / In Arbeit / Erledigt). */
export interface TaskDbLabels {
  /** Name of the table view (i18n `database.viewTable`). */
  viewTable: string;
  /** Name of the status board view (i18n `database.viewBoard`). */
  viewBoard: string;
  /** Localized frontmatter key of the done checkbox column (i18n `tasks.dbDoneKey`).
   * This CHECKBOX is the completion truth of a task note (binary, like the
   * providers' completed flag); the status column tracks it for the board. */
  doneKey: string;
  /** Localized frontmatter key of the due-date column (i18n `tasks.dbDueKey`). */
  dueKey: string;
  /** Status option values open / in progress / done (i18n `tasks.dbStatus*`). */
  statusOptions: [string, string, string];
}

/** Minimal adapter surface the creation needs (satisfied by IVaultAdapter). */
export interface TaskDbAdapter {
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/**
 * Sanitized file stem for a user-typed database name: path separators and
 * OS-forbidden characters are dropped, whitespace collapsed. Returns null for
 * a name with no usable characters.
 */
export const taskDbFileStem = safeFileStem;

/** The `.base` path + source folder + serialized content for a new task DB. */
export function buildTaskDbFile(stem: string, labels: TaskDbLabels): { path: string; folder: string; content: string } {
  const spec = defineBase({
    path: `${stem}.base`,
    sourceFolder: stem,
    columns: [
      { key: labels.doneKey, input: "checkbox" },
      { key: "status", input: "status", options: [...labels.statusOptions] },
      { key: labels.dueKey, input: "date" },
    ],
    views: [
      { name: labels.viewTable, type: "table" },
      { name: labels.viewBoard, type: "board", groupBy: "status" },
    ],
  });
  return { path: spec.path, folder: stem, content: serializeBaseConfig(spec.config) };
}

/**
 * Creates the task database (source folder + `.base`) unless it already
 * exists — an existing `.base` of that name is simply adopted (idempotent, so
 * "create" on a name that is already a database selects it). Returns the
 * vault-relative `.base` path, or null for an unusable name.
 */
export async function createTaskDatabase(
  adapter: TaskDbAdapter,
  name: string,
  labels: TaskDbLabels
): Promise<string | null> {
  const stem = taskDbFileStem(name);
  if (!stem) return null;
  const { path, folder, content } = buildTaskDbFile(stem, labels);
  if (!(await adapter.exists(folder))) await adapter.createDir(folder);
  if (!(await adapter.exists(path))) await adapter.writeTextFile(path, content);
  return path;
}

/**
 * The status column of a task database.
 *
 * Convention (matching the promoted-checkbox prefill and the usual board
 * order): the FIRST option is "open", the LAST is "done"; every listed option
 * value is a recognized status. Returns null when the database has no
 * status/select column with options.
 */
export interface TaskStatusModel {
  key: string;
  open: string;
  done: string;
  /** All recognized option values (an unlisted value is "unknown"). */
  options: string[];
}

export function resolveTaskStatusModel(config: unknown): TaskStatusModel | null {
  const cols = (config as { columns?: Record<string, unknown> } | null)?.columns ?? {};
  let statusKey: string | null = null;
  for (const [key, col] of Object.entries(cols)) {
    const c = col as { input?: string; options?: unknown } | null;
    if (c && (c.input === "status" || c.input === "select") && Array.isArray(c.options) && c.options.length > 0) {
      statusKey = key;
      break;
    }
  }
  if (!statusKey) return null;
  const raw = (cols[statusKey] as { options: unknown[] }).options;
  const values = raw
    .map((o) => (typeof o === "string" ? o : (o as { value?: unknown } | null)?.value))
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (values.length === 0) return null;
  return { key: statusKey, open: values[0], done: values[values.length - 1], options: values };
}

/** Classifies a status value: `true` = done, `false` = a recognized non-done
 * (open/intermediate) value, `null` = empty or unrecognized. `null` is the
 * important case: it must never be treated as an intentional "open" that could
 * un-complete a remote task. */
export function classifyTaskStatus(value: string | null | undefined, model: TaskStatusModel): boolean | null {
  if (value == null || value === "") return null;
  const s = String(value);
  if (s === model.done) return true;
  if (model.options.includes(s)) return false;
  return null;
}

/**
 * How a task database expresses "done". A binary provider task (Google Tasks,
 * VTODO, To Do) maps naturally onto a CHECKBOX property — that is the model
 * the user sees as the task's checkbox (maintainer decision, 2026-07-17). A
 * checkbox column therefore takes precedence; databases without one keep the
 * status-option convention (first = open, last = done). When BOTH exist the
 * checkbox is the truth and the status column is kept consistent alongside it
 * (done -> last option; un-done -> first option only if it currently shows the
 * done option, so an intermediate "In Arbeit" is never clobbered).
 */
export type TaskCompletionModel =
  | { kind: "checkbox"; key: string; status: TaskStatusModel | null }
  | { kind: "status"; status: TaskStatusModel };

export function resolveTaskCompletionModel(config: unknown): TaskCompletionModel | null {
  const cols = (config as { columns?: Record<string, unknown> } | null)?.columns ?? {};
  let checkboxKey: string | null = null;
  for (const [key, col] of Object.entries(cols)) {
    if ((col as { input?: string } | null)?.input === "checkbox") {
      checkboxKey = key;
      break;
    }
  }
  const status = resolveTaskStatusModel(config);
  if (checkboxKey) return { kind: "checkbox", key: checkboxKey, status };
  if (status) return { kind: "status", status };
  return null;
}

/** The status model of a completion model, whichever kind it is. */
export function statusModelOf(model: TaskCompletionModel | null): TaskStatusModel | null {
  if (!model) return null;
  return model.kind === "checkbox" ? model.status : model.status;
}

/** Classifies the raw frontmatter/index values under the completion model.
 * Index property values travel as strings, so booleans are string-tolerant.
 * `null` = ambiguous (missing/foreign) — the reconciler falls back to its base
 * instead of reading it as "open". */
export function classifyTaskCompletion(
  model: TaskCompletionModel,
  values: { checkbox?: unknown; status?: string | null }
): boolean | null {
  if (model.kind === "checkbox") {
    const v = values.checkbox;
    if (v === true || v === "true") return true;
    if (v === false || v === "false") return false;
    return null;
  }
  return classifyTaskStatus(values.status ?? null, model.status);
}

/** Writes a completion flip into a note's frontmatter (single write path for
 * the reconciler, both task overviews and the calendar surfaces). */
export function applyTaskCompletion(
  content: string,
  model: TaskCompletionModel,
  done: boolean,
  readPath: (content: string, path: string[]) => unknown,
  setPath: (content: string, path: string[], value: unknown) => string
): string {
  let out = content;
  if (model.kind === "checkbox") {
    out = setPath(out, [model.key], done);
    if (model.status) {
      const current = readPath(out, [model.status.key]);
      if (done) {
        out = setPath(out, [model.status.key], model.status.done);
      } else if (current != null && String(current) === model.status.done) {
        out = setPath(out, [model.status.key], model.status.open);
      }
    }
    return out;
  }
  return setPath(out, [model.status.key], done ? model.status.done : model.status.open);
}

/** One entry of a task database, as both overviews render it. */
export interface TaskDbRow {
  path: string;
  title: string;
  /** Raw status value, or null when the database has no status column. */
  status: string | null;
  done: boolean;
  /** ISO day of the database's date column, or null. */
  due: string | null;
  /**
   * Minutes into that day, when the column is a `datetime` and carries a time
   * (S6). It was always cut off here — ten characters, and the clock the note
   * held was gone before anything could show it.
   */
  dueMinutes?: number;
}

/** The database's first date column — the one a due date is read from and a
 * generated occurrence writes to. Resolved from the SCHEMA, never by name:
 * the column is called `frist` in a German vault and `due` in an English one. */
export function taskDbDueKey(config: unknown): string | null {
  const cols = (config as { columns?: Record<string, { input?: string }> } | null)?.columns ?? {};
  return Object.keys(cols).find((k) => cols[k]?.input === "date" || cols[k]?.input === "datetime") ?? null;
}

/**
 * Turns `queryDatabaseFiles` output into overview rows. Shared so the two
 * overviews cannot disagree about which entry counts as done — the same reason
 * the completion model itself is shared.
 *
 * Row shape is the one every base view reads: `file.*` fields plus the bare
 * frontmatter property keys.
 */
export function taskDbRows(
  rows: readonly Record<string, unknown>[],
  config: unknown,
  completion: TaskCompletionModel | null
): TaskDbRow[] {
  const statusModel = statusModelOf(completion);
  const dueKey = taskDbDueKey(config);
  return rows.map((r) => {
    const rawStatus =
      statusModel && r[statusModel.key] != null && r[statusModel.key] !== "" ? String(r[statusModel.key]) : null;
    const path = String(r["file.path"] ?? "");
    const parsedDue = dueKey ? parseDueValue(r[dueKey]) : null;
    return {
      path,
      title: String(r["file.name"] ?? path.split("/").pop()?.replace(/\.md$/i, "") ?? ""),
      status: rawStatus,
      done: completion
        ? classifyTaskCompletion(completion, {
            checkbox: completion.kind === "checkbox" ? r[completion.key] : undefined,
            status: rawStatus,
          }) === true
        : false,
      due: parsedDue?.day ?? null,
      dueMinutes: parsedDue?.minutes,
    };
  });
}

/** Writes an explicit status option and keeps a checkbox column consistent
 * (picking the done option checks the box; any other option unchecks it). */
export function applyTaskStatusOption(
  content: string,
  model: TaskCompletionModel,
  option: string,
  setPath: (content: string, path: string[], value: unknown) => string
): string {
  const status = statusModelOf(model);
  let out = content;
  if (status) out = setPath(out, [status.key], option);
  if (model.kind === "checkbox" && status) {
    out = setPath(out, [model.key], option === status.done);
  }
  return out;
}

/**
 * Which provider list a task created in this database also goes to (C4, S15).
 *
 * Today the reconciler only mirrors remote → local: a task created in Plainva
 * stays a note and never appears in Google Tasks or the iCloud reminders. The
 * capability to create one is finished in all three providers
 * (`IPimTarget.createTask`) and has never had a caller; what was missing is not
 * provider work but the answer to "which list".
 *
 * That answer belongs to the DATABASE, not to each dialog: a task database
 * already carries a storage folder and a template, and an account can have
 * several lists. Stored under `views[0].plainva.taskList` — Obsidian ignores
 * the namespace, so the file stays valid there.
 *
 * Absent means absent: without a chosen list a new task stays a note, exactly
 * as it does today. Sending tasks to a provider is a decision, not a default.
 */

/** The key grammar is the calendar picker's, on purpose: `"<accountId> <id>"`
 * where only the FIRST space separates, because a CalDAV list id can contain
 * spaces just like a calendar href. One grammar, one implementation — this
 * renames the field for readers who are dealing with lists, nothing more. */
export function splitTaskListKey(key: string): { accountId: string; listId: string } | null {
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!trimmed) return null;
  const space = trimmed.indexOf(" ");
  if (space <= 0 || space === trimmed.length - 1) return null;
  return { accountId: trimmed.slice(0, space), listId: trimmed.slice(space + 1) };
}

/** Task-list picker options (`"<accountId> <listId>"` -> label), mirroring the
 * calendar picker: the account name is appended only when more than one account
 * exists, so a single-account setup stays uncluttered. Pure. */
export function taskListPickerOptions<T extends { id: string; name: string; accountId: string }>(
  lists: readonly T[],
  accountLabel: ReadonlyMap<string, string>,
  multiAccount: boolean
): Array<{ value: string; label: string }> {
  return lists.map((l) => ({
    value: `${l.accountId} ${l.id}`,
    label: multiAccount ? `${l.name} · ${accountLabel.get(l.accountId) ?? ""}` : l.name,
  }));
}

/**
 * The list a new task in this database goes to, or null for "stays a note".
 *
 * A stored key that no longer resolves — the account was removed, the list
 * deleted, the mirror switched off — returns null rather than a guess. Creating
 * a task in a list the user can no longer see would be worse than not creating
 * one: it lands somewhere they cannot check.
 */
/**
 * The NAME of the chosen list, for a surface that has to say it out loud —
 * the phone's creation sheet asks "also create at <name>?" (S17). Resolved
 * through the same rule as the target, so a list that is gone gives null here
 * too and the question is simply not asked.
 */
export function resolveTaskListName(
  config: unknown,
  available: ReadonlyArray<{ id: string; accountId: string; name?: string }>
): string | null {
  const target = resolveTaskListTarget(config, available);
  if (!target) return null;
  const hit = available.find((l) => l.accountId === target.accountId && l.id === target.listId);
  const name = (hit?.name ?? "").trim();
  return name || target.listId;
}

export function resolveTaskListTarget(
  config: unknown,
  available: ReadonlyArray<{ id: string; accountId: string }>
): { accountId: string; listId: string } | null {
  const raw = config && typeof config === "object" ? (config as Record<string, unknown>).taskList : undefined;
  const parts = typeof raw === "string" ? splitTaskListKey(raw) : null;
  if (!parts) return null;
  return available.some((l) => l.accountId === parts.accountId && l.id === parts.listId) ? parts : null;
}
