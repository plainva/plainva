import { defineBase } from "../vaultTemplates/baseBuilders";
import { serializeBaseConfig } from "../base/baseFormat";
import { safeFileStem } from "./fileStem";

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
      due: dueKey && r[dueKey] != null && r[dueKey] !== "" ? String(r[dueKey]).slice(0, 10) : null,
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
