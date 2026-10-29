/**
 * Tasks queries — the ```` ```tasks ```` blocks of the Obsidian Tasks plugin,
 * read and evaluated by Plainva (plan Tasks-Abfragen, packages T0–T2). The
 * core only: no clock, no I/O, no UI strings, and nothing in a note is ever
 * executed (`… by function` and `regex matches` are left out, E10/E11).
 *
 * How the interface uses it:
 *
 * ```ts
 * import { parseTasksQuery, evaluateTasksQuery, explainTasksQuery } from "@plainva/core";
 *
 * // One load per index state, shared by every block (E3): the Tasks tab's records.
 * const tasks = await queryService.listTasks();
 * const query = parseTasksQuery(blockText, { today: calendarDay(), filePath: note.path });
 * const result = evaluateTasksQuery(query, tasks);
 * if (result.status === "error") {
 *   // result.errors: lines Tasks rejects too (case c) — show line, reason code, "Edit query"; no list.
 * } else {
 *   // result.notices: lines left out (case a) — one hint each, worded by `unsupported.effect`.
 *   // result.root: groups (heading data, level 1–3) down to items; ungrouped, root.items.
 *   // result.total / result.shown: "shown of total tasks"; result.layout: tree, backlink, fields …
 *   // item.children: subtasks for `show tree`, item.matched false for those shown only as children.
 * }
 * if (query.explain || explanationSwitchOn) render(explainTasksQuery(query, pluginSettings));
 * ```
 *
 * Or in one call: `runTasksQuery(blockText, tasks, { today, filePath })`.
 *
 * - **parse.ts** — lines, `#` and `{{! }}` comments, `\` continuations,
 *   placeholders `{{query.file.*}}`, Boolean instructions (NOT, XOR, AND, OR;
 *   one kind of delimiter per line); every line `understood`, `noEffect`,
 *   `unsupported` (case a) or `error` (case c) with a reason code.
 * - **dates.ts** — day keys, ISO weeks, month ends; the date phrases Plainva reads.
 * - **evaluate.ts** — filters, sort (Tasks' default sort included), limit,
 *   groups, limit groups, tree.
 * - **urgency.ts** — Tasks' urgency score.
 * - **explain.ts** — the explanation as data; the Tasks plugin's settings file.
 */

import type { TaskRecord } from "../vault/VaultQueryService.js";
import { evaluateTasksQuery, type TasksQueryResult } from "./evaluate.js";
import { parseTasksQuery, type TasksQuery, type TasksQueryContext } from "./parse.js";

export * from "./dates.js";
export * from "./urgency.js";
export * from "./parse.js";
export * from "./evaluate.js";
export * from "./explain.js";

/** Parses and evaluates in one go. */
export function runTasksQuery(source: string, tasks: readonly TaskRecord[], context: TasksQueryContext): { query: TasksQuery; result: TasksQueryResult } {
  const query = parseTasksQuery(source, context);
  return { query, result: evaluateTasksQuery(query, tasks) };
}
