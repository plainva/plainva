import { useMemo, useState, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Code2, XCircle } from "lucide-react";
import { evaluateTasksQuery, parseTasksQuery, type TaskRecord, type TasksPluginSettings } from "@plainva/core";
import { ICON } from "../lib/iconSizes";
import { isOpenState, type PlannerRow, type TaskState } from "../lib/taskPlanner";
import { tasksQueryErrors, tasksQueryExplainView, tasksQueryView } from "../lib/tasksQueryRows";
import type { InlineLinkHandlers } from "../lib/inlineMarkdown";
import type { WikiTargetSet } from "../lib/wikiResolver";
import { TaskPlannerList } from "./TaskPlannerList";
import { Button } from "./ui/Button";
import { Switch } from "./ui/Switch";
import { cx } from "./ui/cx";

/**
 * A ```tasks block of the Obsidian Tasks plugin as a task list (plan
 * Tasks-Abfragen, T3) — one surface for the editor and the reading mode of
 * both shells. The query is read and evaluated by the core
 * (`@plainva/core` tasksQuery); the rows are the planner's rows, so a task
 * here looks and behaves as in the Tasks tab.
 *
 * - **Hints** (case a): a line Tasks knows and Plainva does not yet stands
 *   above the result, with what that means for the list.
 * - **Error** (case c): a line Tasks rejects too — no result, never
 *   "0 tasks"; the query below with the line marked, and "Edit query".
 * - **Explanation**: how each line was read, dates as days; the `explain`
 *   line shows it, the switch in the foot too, without touching the note.
 * - **Large results** are not cut silently: the first 100 rows, then
 *   "Show all n".
 *
 * What a row DOES comes from the shell, as for the planner: the tick (through
 * the editor when the task stands in the same note), the menu, the swipe.
 */
export interface TasksQueryBlockProps {
  /** The query, as the Tasks plugin reads it. */
  source: string;
  /** The note the block stands in (`{{query.file.*}}`). */
  notePath: string;
  /** The vault's tasks (`listTasks()`, one load per index state); null while loading. */
  tasks: readonly TaskRecord[] | null;
  /** The calendar day "today" means (`calendarDay`). */
  today: string;
  /** The Tasks plugin's settings in this vault, for the explanation only. */
  pluginSettings?: TasksPluginSettings | null;
  /** An embedded note: the list only to look at — no tick, no menu. */
  readOnly?: boolean;
  /** Ticks or reopens a task; the block shows the new state at once. */
  onToggle: (row: PlannerRow) => void;
  onOpen: (row: PlannerRow) => void;
  onMenu?: (row: PlannerRow, at: { x: number; y: number }) => void;
  wrapRow?: (row: PlannerRow, element: ReactElement) => ReactNode;
  rowProps?: (row: PlannerRow) => Omit<HTMLAttributes<HTMLElement>, "onClick" | "title" | "className">;
  links?: InlineLinkHandlers;
  linkLookup?: WikiTargetSet | null;
  /** Puts the caret into the query (line 1-based in the block; null: its start). Absent: no "Edit query". */
  onEditQuery?: (line: number | null) => void;
  /** The card a block in a callout continues. */
  className?: string;
}

const DEPTH_CLASS = ["pv-tasksquery-xl--d1", "pv-tasksquery-xl--d2", "pv-tasksquery-xl--d3"];
const PILL_CLASS: Record<string, string> = {
  understood: "pv-tasksquery-pill--understood",
  noEffect: "pv-tasksquery-pill--noEffect",
  unsupported: "pv-tasksquery-pill--unsupported",
  error: "pv-tasksquery-pill--error",
};

export function TasksQueryBlock({ source, notePath, tasks, today, pluginSettings, readOnly, onToggle, onOpen, onMenu, wrapRow, rowProps, links, linkLookup, onEditQuery, className }: TasksQueryBlockProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [explainOn, setExplainOn] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // A tick shows at once; the next load of the tasks says what is true.
  const [pending, setPending] = useState<{ tasks: readonly TaskRecord[] | null; states: ReadonlyMap<string, TaskState> }>({ tasks, states: new Map() });
  const states = pending.tasks === tasks ? pending.states : undefined;

  const query = useMemo(() => parseTasksQuery(source, { today, filePath: notePath }), [source, today, notePath]);
  const result = useMemo(() => (tasks ? evaluateTasksQuery(query, tasks) : null), [query, tasks]);
  const view = useMemo(() => {
    if (query.errors.length > 0) return tasksQueryErrors(query, t);
    if (!result || result.status !== "ok") return null;
    return tasksQueryView(result, { t, locale, states, showAll });
  }, [query, result, t, locale, states, showAll]);
  const explanation = useMemo(
    () => (query.explain || explainOn ? tasksQueryExplainView(query, t, locale, pluginSettings) : null),
    [query, explainOn, t, locale, pluginSettings],
  );

  const toggle = (row: PlannerRow) => {
    if (readOnly) return;
    const next: TaskState = isOpenState(row.state) ? "done" : "open";
    setPending((was) => {
      const map = new Map(was.tasks === tasks ? was.states : []);
      map.set(row.id, next);
      return { tasks, states: map };
    });
    onToggle(row);
  };

  const sourceLines = source.split("\n");
  const badLines = new Set(query.errors.map((line) => line.line));
  const editLink = onEditQuery ? (line: number | null) => (
    <Button variant="ghost" size="sm" icon={<Code2 size={ICON.meta} />} onClick={() => onEditQuery(line)} data-testid="tasks-query-edit">
      {t("tasksQuery.editQuery")}
    </Button>
  ) : null;

  if (view?.status === "error") {
    return (
      <div className={cx("pv-tasksquery", "pv-tasksquery--error", className)} data-testid="tasks-query" data-status="error">
        <div className="pv-tasksquery-error" role="alert">
          <strong>
            <XCircle size={ICON.ui} /> {t("tasksQuery.errorTitle")}
          </strong>
          {view.errors.map((e) => (
            <p key={e.line} data-testid="tasks-query-error">
              {t("tasksQuery.lineLabel", { line: e.line })} <code>{e.source}</code>: {e.text}
            </p>
          ))}
        </div>
        <pre className="pv-tasksquery-source" data-testid="tasks-query-source">
          {sourceLines.map((text, i) => (
            <span key={i} className={badLines.has(i + 1) ? "pv-tasksquery-bad" : undefined}>
              <span className="pv-tasksquery-ln">{i + 1}</span>
              {text}
              {"\n"}
            </span>
          ))}
        </pre>
        <div className="pv-tasksquery-foot">
          <span>{t("tasksQuery.noResult")}</span>
          <span className="pv-tasksquery-spacer" />
          {editLink?.(query.errors[0]?.line ?? null)}
        </div>
      </div>
    );
  }

  return (
    <div className={cx("pv-tasksquery", className)} data-testid="tasks-query" data-status={view ? "ok" : "loading"}>
      {view?.notices.map((note) => (
        <div key={note.line} className="pv-tasksquery-hint" data-testid="tasks-query-hint">
          <AlertTriangle size={ICON.ui} />
          <div>
            {t("tasksQuery.lineLabel", { line: note.line })} <code>{note.source}</code> — {note.text}
          </div>
        </div>
      ))}
      {explanation && (
        <div className="pv-tasksquery-explain" data-testid="tasks-query-explain">
          <h6>{t("tasksQuery.explainTitle")}</h6>
          {explanation.rows.map((row, i) => (
            <div key={i} className={cx("pv-tasksquery-xl", row.depth > 0 && DEPTH_CLASS[Math.min(row.depth, 3) - 1])}>
              <code>{row.source}</code>
              {row.status && <span className={cx("pv-tasksquery-pill", PILL_CLASS[row.status])}>{t(`tasksQuery.status.${row.status}`)}</span>}
              {row.detail && <span className="pv-tasksquery-xd">{row.detail}</span>}
            </div>
          ))}
          {explanation.notes.map((note, i) => (
            <p key={i} className="pv-tasksquery-xnote">{note}</p>
          ))}
        </div>
      )}
      <div className="pv-tasksquery-body">
        {!view ? (
          <p className="pv-tasksquery-loading">{t("tasksQuery.loading")}</p>
        ) : (
          <>
            <TaskPlannerList
              sections={view.sections}
              emptyLabel={t("tasksQuery.empty")}
              databaseLabel=""
              onToggle={toggle}
              onOpen={onOpen}
              onMenu={readOnly ? undefined : onMenu}
              wrapRow={readOnly ? undefined : wrapRow}
              rowProps={readOnly ? undefined : rowProps}
              links={links}
              linkLookup={linkLookup}
              subtasks={view.subtasks}
              display={view.display}
              readOnly={readOnly}
            />
            {view.hidden > 0 && (
              <Button variant="ghost" size="sm" className="pv-tasksquery-more" onClick={() => setShowAll(true)} data-testid="tasks-query-more">
                {t("tasksQuery.showAll", { count: view.total })}
              </Button>
            )}
          </>
        )}
      </div>
      <div className="pv-tasksquery-foot">
        {view && view.layout.taskCount && (
          <span data-testid="tasks-query-count">
            {view.hidden > 0 || view.shown < view.total ? t("tasksQuery.shownOfTotal", { shown: view.shown - view.hidden, total: view.total }) : t("tasksQuery.taskCount", { count: view.total })}
          </span>
        )}
        <span className="pv-tasksquery-spacer" />
        {!query.explain && (
          <label className="pv-tasksquery-toggle">
            <Switch checked={explainOn} onChange={setExplainOn} label={t("tasksQuery.explanation")} testId="tasks-query-explain-switch" />
            {t("tasksQuery.explanation")}
          </label>
        )}
        {editLink?.(null)}
      </div>
    </div>
  );
}
