import { Fragment, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckSquare, Repeat, Square, SquareMinus, SquareSlash } from "lucide-react";
import { ICON } from "../lib/iconSizes";
import { formatDueLabel } from "../lib/dueLabel";
import { noteDisplayName } from "../lib/noteTitle";
import { isOpenState, type PlannerRow, type PlannerSection } from "../lib/taskPlanner";
import { Chip } from "./ui/Chip";
import { EmptyState } from "./ui/EmptyState";
import { GroupCard, Row, RowList, SectionLabel } from "./ui/GroupedRows";
import { IconButton } from "./ui/IconButton";
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
}

const STATE_ICON = { open: Square, progress: SquareSlash, done: CheckSquare, cancelled: SquareMinus } as const;

function dayHeading(dayKey: string, locale: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date(y, m - 1, d));
}

function clock(minutes: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

export function TaskPlannerList({ sections, emptyLabel, databaseLabel, onToggle, onOpen, onMenu, wrapRow, rowProps }: TaskPlannerListProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const shown = sections.filter((s) => s.rows.length > 0 || s.kind === "today");
  if (sections.every((s) => s.rows.length === 0)) {
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
    return t("tasks.done");
  };

  const when = (row: PlannerRow, section: PlannerSection): ReactNode => {
    if (!row.due) return null;
    // Inside a day the day is the heading; the row only adds its time.
    if (section.kind === "today" || section.kind === "day") {
      return row.dueMinutes != null ? <Chip size="sm" tone="muted">{clock(row.dueMinutes, locale)}</Chip> : null;
    }
    const label = formatDueLabel(row.due, { locale, t });
    const text = row.dueMinutes != null ? `${label.text} · ${clock(row.dueMinutes, locale)}` : label.text;
    return (
      <Chip size="sm" tone={isOpenState(row.state) && label.tone === "due" ? "warning" : "muted"}>
        {text}
      </Chip>
    );
  };

  return (
    <div className="pv-planner-list" data-testid="task-planner-list">
      {shown.map((section) => (
        <section key={section.key} data-testid={`task-planner-section-${section.kind}`}>
          <SectionLabel end={section.rows.length || undefined}>{heading(section)}</SectionLabel>
          {section.rows.length === 0 ? (
            <p className="pv-planner-none">{t("tasks.plannerEmptyToday")}</p>
          ) : (
            <GroupCard>
              <RowList>
                {section.rows.map((row) => {
                  const StateIcon = STATE_ICON[row.state];
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
                        <IconButton
                          label={closed ? t("tasks.open") : t("tasks.done")}
                          onClick={() => onToggle(row)}
                          data-testid="task-planner-toggle"
                        >
                          <StateIcon size={ICON.ui} />
                        </IconButton>
                      }
                      title={
                        <span className={closed ? "pv-planner-closed" : undefined}>
                          <TaskPriorityFlag rank={row.priority} />
                          {row.source === "database" ? noteDisplayName(row.title) : row.title}
                        </span>
                      }
                      subtitle={
                        <>
                          {when(row, section)}
                          {(row.repeats || row.repeatsAtProvider) && (
                            <Chip size="sm" tone="muted" icon={<Repeat size={ICON.meta} />}>
                              {row.repeatsAtProvider ? t("tasks.repeatsAtProvider") : t("tasks.repeat")}
                            </Chip>
                          )}
                          {row.tags.map((tag) => (
                            <Chip key={tag} size="sm" tone="muted">#{tag}</Chip>
                          ))}
                          <span className="pv-planner-source">
                            {row.source === "database" ? databaseLabel : noteDisplayName(row.noteTitle ?? row.path)}
                          </span>
                        </>
                      }
                      onClick={() => onOpen(row)}
                    />
                  );
                  return <Fragment key={row.id}>{wrapRow ? wrapRow(row, element) : element}</Fragment>;
                })}
              </RowList>
            </GroupCard>
          )}
        </section>
      ))}
    </div>
  );
}
