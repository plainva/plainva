import { defineBase, serializeBaseConfig } from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";
import { taskDatabaseKey } from "../contexts/VaultContext";

/**
 * Standard task database (PIM plan, package 1a). A vault can designate one
 * `.base` as its task database; checkbox tasks from the Tasks view are promoted
 * into it (and later stages sync external provider tasks into the same place).
 * This module owns the setting read and the "create a fresh task database"
 * scaffold — the created `.base` follows the vault-template convention exactly
 * (root-level `<Name>.base` + `<Name>/` source folder, `status`/due columns,
 * table + status board views) so it is byte-identical to a template save and
 * valid in Obsidian.
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
export function taskDbFileStem(name: string): string | null {
  const stem = name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A trailing dot would collide with the ".base" extension on Windows.
    .replace(/\.+$/, "");
  return stem.length > 0 ? stem : null;
}

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
 * The status column of a task database as one shared model — the SINGLE source
 * of truth for "which value means open / done", used by both the reconciler
 * (which writes the note) and the Tasks view (which renders it). Sharing it
 * prevents the two from drifting: a drift there is exactly what makes a
 * completed task look open in the view and, worse, risks the reconciler reading
 * a note as open and un-completing the remote task.
 *
 * Convention (matching the promoted-checkbox prefill and the usual board order):
 * the FIRST option is "open", the LAST is "done"; every listed option value is
 * a recognized status. Returns null when the database has no status/select
 * column with options.
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
 * the reconciler, the Tasks overview and the calendar surfaces). */
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

/** Writes an explicit status option and keeps a checkbox column consistent
 * (picking the done option checks the box; any other option unchecks it). */
export function applyTaskStatusOption(
  content: string,
  model: TaskCompletionModel,
  option: string,
  setPath: (content: string, path: string[], value: unknown) => string
): string {
  const status = model.kind === "checkbox" ? model.status : model.status;
  let out = content;
  if (status) out = setPath(out, [status.key], option);
  if (model.kind === "checkbox" && status) {
    out = setPath(out, [model.key], option === status.done);
  }
  return out;
}

/** The vault's configured standard task database (vault-relative `.base` path),
 * or null when none is set. */
export async function getTaskDatabasePath(vaultPath: string): Promise<string | null> {
  try {
    const store = await getSettingsStore();
    const value = await store.get<string>(taskDatabaseKey(vaultPath));
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}
