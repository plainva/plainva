import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, CheckCheck, Hash, Inbox, ListTodo, Sun } from "lucide-react";
import { ICON } from "../lib/iconSizes";
import { TASK_VIEW_LISTS, type PlannerCounts, type TaskViewList } from "../lib/taskPlanner";
import { Row, RowList } from "./ui/GroupedRows";
import { Segmented } from "./ui/Segmented";

/**
 * The list switch of the tasks view (plan Aufgaben-Oberfläche, B1). ONE
 * definition of the lists, their order, icons and counts; the desktop draws it
 * as a rail beside the list, the phone as a segment above it.
 */
export interface TaskPlannerNavProps {
  variant: "rail" | "segment";
  value: TaskViewList;
  onChange: (list: TaskViewList) => void;
  counts: PlannerCounts;
  /** Open tasks in "all". */
  allCount: number;
  /**
   * Rail only: the tags that occur most among the open tasks, as one-click tag
   * filters. The phone has the tag chip in its filter row for the same job.
   */
  tags?: readonly { name: string; count: number }[];
  activeTag?: string;
  /** Called with the tag, or with "" when the active one is clicked again. */
  onTag?: (tag: string) => void;
}

const LIST_ICON = { today: Sun, upcoming: CalendarDays, inbox: Inbox, all: ListTodo, done: CheckCheck } as const;
const LIST_KEY: Record<TaskViewList, string> = {
  today: "tasks.plannerToday",
  upcoming: "tasks.plannerUpcoming",
  inbox: "tasks.plannerInbox",
  all: "tasks.all",
  done: "tasks.done",
};

export function TaskPlannerNav({ variant, value, onChange, counts, allCount, tags, activeTag, onTag }: TaskPlannerNavProps) {
  const { t } = useTranslation();
  // "Today" answers for what is late as well: overdue + today, said as one number
  // on the phone and as "2 + 3" where there is room for it.
  const countOf = (list: TaskViewList): number | null =>
    list === "today" ? counts.overdue + counts.today : list === "upcoming" ? counts.upcoming : list === "inbox" ? counts.inbox : list === "all" ? allCount : null;

  if (variant === "segment") {
    return (
      <Segmented
        ariaLabel={t("tasks.plannerLists")}
        className="pv-planner-segment"
        options={TASK_VIEW_LISTS.map((list) => {
          const n = countOf(list);
          return { value: list, label: n && list === "today" ? `${t(LIST_KEY[list])} ${n}` : t(LIST_KEY[list]), testId: `tasks-list-${list}` };
        })}
        value={value}
        onChange={onChange}
      />
    );
  }

  const end = (list: TaskViewList): ReactNode => {
    if (list === "today" && counts.overdue > 0) {
      return (
        <span className="pv-planner-late" data-testid="tasks-list-overdue">
          {counts.overdue} + {counts.today}
        </span>
      );
    }
    const n = countOf(list);
    return n ? n : undefined;
  };

  return (
    <nav className="pv-planner-rail" aria-label={t("tasks.plannerLists")}>
      <RowList>
        {TASK_VIEW_LISTS.map((list) => {
          const Icon = LIST_ICON[list];
          return (
            <Row
              key={list}
              className={list === value ? "is-on" : undefined}
              aria-current={list === value ? "page" : undefined}
              data-testid={`tasks-list-${list}`}
              icon={<Icon size={ICON.ui} />}
              title={t(LIST_KEY[list])}
              end={end(list)}
              onClick={() => onChange(list)}
            />
          );
        })}
      </RowList>
      {tags && tags.length > 0 && (
        <>
          <p className="pv-planner-railhead">{t("tasks.plannerTags")}</p>
          <RowList>
            {tags.map((tag) => (
              <Row
                key={tag.name}
                className={tag.name === activeTag ? "is-on" : undefined}
                aria-pressed={tag.name === activeTag}
                data-testid="tasks-rail-tag"
                icon={<Hash size={ICON.ui} />}
                title={tag.name}
                end={tag.count}
                onClick={() => onTag?.(tag.name === activeTag ? "" : tag.name)}
              />
            ))}
          </RowList>
        </>
      )}
    </nav>
  );
}
