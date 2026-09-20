import type { TaskPriority } from "./taskPlanner";

/**
 * Priority of a task-database entry (plan Aufgaben-Oberfläche, B3).
 *
 * A plain select column, like `status`: three options from most to least
 * important, and the RANK is the option's position — so a vault may call them
 * "hoch/mittel/niedrig", "A/B/C" or "now/soon/whenever" and everything that
 * sorts or draws a flag still agrees. Empty means none.
 *
 * Unlike the date and the checkbox there is no input type that says "this is
 * the priority", so the column is found by NAME — among the names Plainva gives
 * it in its ten languages, since a vault keeps the name of the language it was
 * created in.
 */
export const PRIORITY_COLUMN_NAMES: readonly string[] = [
  "priority", "prio", "priorität", "prioritaet", "prioridad", "priorité", "priorite", "priorità", "priorita",
  "優先度", "prioriteit", "priorytet", "prioridade", "优先级",
];

export interface TaskPriorityModel {
  key: string;
  /** Option values from most to least important; at most the first three carry a rank. */
  options: string[];
}

interface ColumnLike {
  input?: string;
  options?: unknown;
}

const optionValues = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : [])
    .map((o) => (typeof o === "string" ? o : (o as { value?: unknown } | null)?.value))
    .filter((v): v is string => typeof v === "string" && v.length > 0);

export function resolveTaskPriorityModel(config: unknown): TaskPriorityModel | null {
  const cols = (config as { columns?: Record<string, ColumnLike | null> } | null)?.columns ?? {};
  for (const [key, col] of Object.entries(cols)) {
    if (!col || (col.input !== "select" && col.input !== "status")) continue;
    if (!PRIORITY_COLUMN_NAMES.includes(key.trim().toLowerCase())) continue;
    const options = optionValues(col.options);
    if (options.length > 0) return { key, options };
  }
  return null;
}

/** Rank of a stored value: 1 = most important … 3; 0 = none or not one of the options. */
export function priorityOfValue(value: unknown, model: TaskPriorityModel | null): TaskPriority {
  if (!model || value == null || value === "") return 0;
  const at = model.options.indexOf(String(value));
  return at >= 0 && at < 3 ? ((at + 1) as TaskPriority) : 0;
}

/** The value to store for a rank; null = clear the property. */
export function priorityValue(rank: TaskPriority, model: TaskPriorityModel): string | null {
  return rank === 0 ? null : model.options[rank - 1] ?? null;
}

/**
 * The config with a priority column added (and shown in every table view that
 * lists its columns) — for a database that has none yet. Only ever called on an
 * explicit act: somebody SET a priority. Returns the input untouched when a
 * priority column already exists.
 */
export function withPriorityColumn<T extends { columns?: Record<string, unknown>; views?: unknown[] }>(
  config: T,
  key: string,
  options: readonly [string, string, string]
): T {
  if (resolveTaskPriorityModel(config)) return config;
  const views = (config.views ?? []).map((view) => {
    const v = view as { type?: string; order?: unknown };
    if (v.type !== "table" || !Array.isArray(v.order) || v.order.includes(key) || v.order.includes(`note.${key}`)) return view;
    return { ...v, order: [...v.order, key] };
  });
  return { ...config, columns: { ...(config.columns ?? {}), [key]: { input: "select", options: [...options] } }, views };
}
