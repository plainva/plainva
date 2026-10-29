import { Fragment, useMemo, useState, type HTMLAttributes, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarClock, CheckSquare, ChevronDown, ChevronRight, Repeat } from "lucide-react";
import { ICON } from "../lib/iconSizes";
import { formatDueLabel } from "../lib/dueLabel";
import { noteDisplayName } from "../lib/noteTitle";
import { isOpenState, type PlannerRow, type PlannerSection } from "../lib/taskPlanner";
import { nestPlannerRows, type PlannerTreeNode } from "../lib/taskPlannerTree";
import { taskPlainTitle } from "../lib/taskTitle";
import type { InlineLinkHandlers } from "../lib/inlineMarkdown";
import type { WikiTargetSet } from "../lib/wikiResolver";
import { IconButton } from "./ui/IconButton";
import { TaskDoneFold, useDoneFold } from "./TaskDoneFold";
import { TaskTitle } from "./TaskTitle";
import { Chip } from "./ui/Chip";
import { EmptyState } from "./ui/EmptyState";
import { GroupCard, Row, RowList, SectionLabel } from "./ui/GroupedRows";
import { Button } from "./ui/Button";
import { TaskCheckButton } from "./TaskCheckButton";
import { TaskPriorityFlag } from "./TaskPriorityFlag";

/**
 * One list of the planner (plan Aufgaben-Oberfläche, B1) — Today with Overdue on
 * top, Upcoming by day, Inbox, Done — drawn the same way in both shells from the
 * sections `buildPlanner` hands out. The desktop puts it beside its rail, the
 * phone under its segment.
 *
 * A row says what it is (state box, flag, title), when (time or day), and where
 * it comes from (the database, or the note a checkbox lives in). What a row can
 * DO stays with the shell: `wrapRow` lets the phone put its swipe and hold
 * gestures around a row, `onMenu` is the desktop's context menu.
 */
export interface TaskPlannerListProps {
  sections: readonly PlannerSection[];
  /** Shown when every section is empty. */
  emptyLabel: string;
  /** Label of the task database (its file name), for the source of a database row. */
  databaseLabel: string;
  onToggle: (row: PlannerRow) => void;
  onOpen: (row: PlannerRow) => void;
  onMenu?: (row: PlannerRow, at: { x: number; y: number }) => void;
  wrapRow?: (row: PlannerRow, element: ReactElement) => ReactNode;
  /** Extra attributes for a row — the phone's hold gesture lives on the row itself. */
  rowProps?: (row: PlannerRow) => Omit<HTMLAttributes<HTMLElement>, "onClick" | "title" | "className">;
  /**
   * A press on a row's date or time (W2): the shell opens its date picker — a
   * popover at `anchor` on the desktop, a sheet on the phone. Absent, or
   * answering `false` for a row, the date stays a label.
   */
  onDue?: (row: PlannerRow, anchor: HTMLElement) => void;
  canDue?: (row: PlannerRow) => boolean;
  /** "All to today" at the Overdue heading (W3). Absent: no button. */
  onOverdueToToday?: () => void;
  /**
   * Links in a title open their note (E3); a press beside a link still opens
   * the task. Absent: links are drawn and do nothing.
   */
  links?: InlineLinkHandlers;
  /** The vault's link targets: a link to a missing note reads as unresolved (`TaskTitle`). */
  linkLookup?: WikiTargetSet | null;
  /**
   * Subtasks under their task (E6): every row the view knows, where a task's
   * subtasks are looked up. Absent: every row stands on its own.
   */
  subtasks?: readonly PlannerRow[];
  /** Up to two bullets indented under a task, as a preview under it (E6). */
  details?: boolean;
  /**
   * Tasks finished today (E5), behind a "Done (n)" fold under Today — closed
   * until opened, remembered by the device. Absent or empty: no fold.
   */
  doneToday?: readonly PlannerRow[];
  /**
   * What a row shows besides its title (a Tasks query's `hide …` lines, plan
   * Tasks-Abfragen T3). Every part is shown unless it says `false`.
   */
  display?: PlannerRowDisplay;
  /** Rows only to look at — an embedded note: the box is drawn, a press does nothing. */
  readOnly?: boolean;
}

export interface PlannerRowDisplay {
  /** The note (or database) a row comes from. */
  source?: boolean;
  /** The same for a subtask under its task. */
  childSource?: boolean;
  due?: boolean;
  tags?: boolean;
  priority?: boolean;
  repeat?: boolean;
}

function dayHeading(dayKey: string, locale: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date(y, m - 1, d));
}

function clock(minutes: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

export function TaskPlannerList({ sections, emptyLabel, databaseLabel, onToggle, onOpen, onMenu, wrapRow, rowProps, onDue, canDue, onOverdueToToday, links, linkLookup, subtasks, details, doneToday, display, readOnly }: TaskPlannerListProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  // Which tasks show their subtasks folded away — for as long as the list is
  // on screen; a task opens with its subtasks in view.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [doneOpen, toggleDone] = useDoneFold();
  const trees = useMemo(
    () => new Map(sections.map((section) => [section.key, subtasks ? nestPlannerRows(section.rows, subtasks) : section.rows.map((row) => ({ row, children: [] }))])),
    [sections, subtasks],
  );
  const finished = doneToday ?? [];
  // A query's group heading over further groups has no rows of its own and still stands.
  const shown = sections.filter((s) => s.rows.length > 0 || s.kind === "today" || (s.kind === "group" && s.label !== undefined));
  const show = (part: keyof PlannerRowDisplay) => display?.[part] !== false;
  if (sections.every((s) => s.rows.length === 0) && finished.length === 0) {
    return <EmptyState icon={<CheckSquare size={ICON.empty} />}>{emptyLabel}</EmptyState>;
  }

  const heading = (section: PlannerSection): ReactNode => {
    if (section.kind === "overdue") {
      return (
        <span className="pv-planner-late">
          <AlertTriangle size={ICON.meta} /> {t("tasks.plannerOverdue")}
        </span>
      );
    }
    if (section.kind === "today") return t("tasks.plannerToday");
    if (section.kind === "day") return dayHeading(section.key, locale);
    if (section.kind === "inbox") return t("tasks.plannerInbox");
    if (section.kind === "group") {
      return section.late ? (
        <span className="pv-planner-late">
          <AlertTriangle size={ICON.meta} /> {section.label}
        </span>
      ) : (
        section.label
      );
    }
    return t("tasks.done");
  };

  const when = (row: PlannerRow, section: PlannerSection): ReactNode => {
    if (!row.due || !show("due")) return null;
    // The date is the way to change it (W2): where the shell can move this
    // row's day, the chip is a button, and it says so with the calendar glyph.
    const press = onDue && (canDue?.(row) ?? true) ? (e: MouseEvent<HTMLButtonElement>) => onDue(row, e.currentTarget) : undefined;
    const glyph = press ? <CalendarClock size={ICON.meta} /> : undefined;
    // Inside a day the day is the heading; the row only adds its time.
    if (section.kind === "today" || section.kind === "day" || section.dayHeading) {
      return row.dueMinutes != null ? <Chip size="sm" tone="muted" icon={glyph} onClick={press} testId="task-planner-due">{clock(row.dueMinutes, locale)}</Chip> : null;
    }
    const label = formatDueLabel(row.due, { locale, t });
    const text = row.dueMinutes != null ? `${label.text} · ${clock(row.dueMinutes, locale)}` : label.text;
    return (
      <Chip size="sm" tone={isOpenState(row.state) && label.tone === "due" ? "warning" : "muted"} icon={glyph} onClick={press} testId="task-planner-due">
        {text}
      </Chip>
    );
  };

  /**
   * One row and, below it, its subtasks while they are not folded away. A
   * subtask is a row like any other — its own box, date and source — moved in
   * by one step per level (`Row`'s indent).
   */
  const renderNode = (node: PlannerTreeNode, section: PlannerSection, depth: number): ReactNode => {
    const row = node.row;
    const hasChildren = node.children.length > 0;
    const isFolded = folded.has(row.id);
    const closed = !isOpenState(row.state);
    const element = (
      <Row
        wrap
        controls
        data-testid="task-planner-row"
        data-state={row.state}
        data-source={row.source}
        onContextMenu={onMenu ? (e) => { e.preventDefault(); onMenu(row, { x: e.clientX, y: e.clientY }); } : undefined}
        {...rowProps?.(row)}
        icon={
          <TaskCheckButton
            state={row.state}
            label={closed ? t("tasks.open") : t("tasks.done")}
            onToggle={() => onToggle(row)}
            disabled={readOnly}
            testId="task-planner-toggle"
          />
        }
        indent={depth === 0 ? undefined : depth === 1 ? 1 : 2}
        title={
          <span className={closed ? "pv-planner-closed" : undefined}>
            {show("priority") && <TaskPriorityFlag rank={row.priority} />}
            {row.source === "database" ? noteDisplayName(row.title) : <TaskTitle text={row.title} notePath={row.path} links={links} linkLookup={linkLookup} />}
          </span>
        }
        subtitle={
          <>
            {details && row.details && row.details.length > 0 && (
              <span className="pv-planner-details" data-testid="task-planner-details">
                {row.details.map((line, i) => (
                  <span key={i}>{taskPlainTitle(line)}</span>
                ))}
              </span>
            )}
            {when(row, section)}
            {show("repeat") && (row.repeats || row.repeatsAtProvider) && (
              <Chip size="sm" tone="muted" icon={<Repeat size={ICON.meta} />}>
                {row.repeatsAtProvider ? t("tasks.repeatsAtProvider") : t("tasks.repeat")}
              </Chip>
            )}
            {show("tags") && row.tags.map((tag) => (
              <Chip key={tag} size="sm" tone="muted">#{tag}</Chip>
            ))}
            {show(depth === 0 ? "source" : "childSource") && (
              <span className="pv-planner-source">
                {row.source === "database" ? databaseLabel : noteDisplayName(row.noteTitle ?? row.path)}
              </span>
            )}
          </>
        }
        // The fold sits at the row's end, away from the box: two small targets
        // side by side at the leading edge would make a tick easy to miss.
        end={
          hasChildren ? (
            <IconButton
              label={isFolded ? t("tasks.subtasksExpand") : t("tasks.subtasksCollapse")}
              aria-expanded={!isFolded}
              data-testid="task-planner-fold"
              onClick={() =>
                setFolded((was) => {
                  const next = new Set(was);
                  if (next.has(row.id)) next.delete(row.id);
                  else next.add(row.id);
                  return next;
                })
              }
            >
              {isFolded ? <ChevronRight size={ICON.ui} /> : <ChevronDown size={ICON.ui} />}
            </IconButton>
          ) : undefined
        }
        onClick={() => onOpen(row)}
      />
    );
    return (
      <Fragment key={row.id}>
        {wrapRow ? wrapRow(row, element) : element}
        {hasChildren && !isFolded && node.children.map((child) => renderNode(child, section, depth + 1))}
      </Fragment>
    );
  };

  return (
    <div className="pv-planner-list" data-testid="task-planner-list">
      {shown.map((section) => (
        <section
          key={section.key}
          data-testid={`task-planner-section-${section.kind}`}
          className={section.kind === "group" && section.level === 2 ? "pv-planner-group--l2" : section.kind === "group" && section.level === 3 ? "pv-planner-group--l3" : undefined}
        >
          {(section.kind !== "group" || section.label !== undefined) && <SectionLabel
            end={
              section.kind === "overdue" && onOverdueToToday ? (
                <>
                  {/* One press for the whole section; the shell answers with a
                      toast that carries Undo (W3). */}
                  <Button variant="ghost" size="sm" onClick={onOverdueToToday} data-testid="task-planner-overdue-today">
                    {t("tasks.overdueToToday")}
                  </Button>
                  {section.rows.length}
                </>
              ) : section.kind === "group" ? (
                section.count
              ) : (
                section.rows.length || undefined
              )
            }
          >
            {heading(section)}
          </SectionLabel>}
          {section.kind === "group" && section.rows.length === 0 ? null : section.rows.length === 0 && !(section.kind === "today" && finished.length > 0) ? (
            <p className="pv-planner-none">{t("tasks.plannerEmptyToday")}</p>
          ) : (
            <GroupCard>
              <RowList>
                {(trees.get(section.key) ?? []).map((node) => renderNode(node, section, 0))}
                {section.kind === "today" && finished.length > 0 && (
                  <>
                    <TaskDoneFold count={finished.length} open={doneOpen} onToggle={toggleDone} />
                    {/* Under their own key: a subtask finished today may hang under its task above as well. */}
                    {doneOpen && finished.map((row) => <Fragment key={`done:${row.id}`}>{renderNode({ row, children: [] }, section, 0)}</Fragment>)}
                  </>
                )}
              </RowList>
            </GroupCard>
          )}
        </section>
      ))}
    </div>
  );
}
