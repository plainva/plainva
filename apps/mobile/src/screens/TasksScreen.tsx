import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare, ChevronLeft, RefreshCw, Square } from "lucide-react";
import {
  EmptyState,
  TaskMutationGate,
  filterTasks,
  groupTasksByNote,
  noteDisplayName,
  parseInlineMarkdown,
  setPendingSearchJump,
  toast,
  toggleTaskAtIndex,
  type InlineNode,
  type TaskStatusFilter,
} from "@plainva/ui";
import { scanTasks, type TaskRecord } from "@plainva/core";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { vaultOps, type MobileVault } from "../services/vaultService";

/**
 * Tasks on the phone (plan P7, S22).
 *
 * Every `- [ ]` in the vault, grouped by note — the line-based aggregation a
 * `.base` cannot do, because a database is row-based. Which tasks a filter
 * leaves and how they group is decided by the shared helpers in `@plainva/ui`,
 * so this list and the desktop's answer the same question the same way.
 *
 * OKF-safe: checking a box rewrites exactly the one `[ ]`/`[x]` character
 * through the shared toggle, never the line around it.
 */

/** Strips the metadata that already has its own chip, so it is not said twice. */
function taskLabel(text: string): string {
  return text
    .replace(/#[^\s#]+/g, "")
    .replace(/📅\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Renders the inline markdown of a task line. Links stay visible TEXT: the row
 * itself is tappable, and a second target inside it would compete with it.
 */
function TaskText({ text }: { text: string }) {
  const render = (nodes: InlineNode[]): ReactNode[] =>
    nodes.map((n, i) => {
      switch (n.kind) {
        case "text":
          return <span key={i}>{n.text}</span>;
        case "code":
          return <code key={i}>{n.text}</code>;
        case "br":
          return <span key={i}> </span>;
        case "strong":
          return <strong key={i}>{render(n.children)}</strong>;
        case "em":
          return <em key={i}>{render(n.children)}</em>;
        case "strongEm":
          return (
            <strong key={i}>
              <em>{render(n.children)}</em>
            </strong>
          );
        case "strike":
          return <s key={i}>{render(n.children)}</s>;
        case "highlight":
          return <mark key={i}>{render(n.children)}</mark>;
        case "wikiLink":
          return <span key={i}>{n.display}</span>;
        case "link":
          return <span key={i}>{n.label}</span>;
        default:
          return <span key={i}>{n.href}</span>;
      }
    });
  return <>{render(parseInlineMarkdown(taskLabel(text)))}</>;
}

export function TasksScreen({
  vault,
  bump,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  bump: number;
  onBack?: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TaskStatusFilter>("open");
  const [text, setText] = useState("");
  const [tick, setTick] = useState(0);
  // A listTasks() read is asynchronous; a checkbox write can finish while an
  // older read is still in flight, and that older result must never roll the
  // box back to its pre-write value.
  const [gate] = useState(() => new TaskMutationGate());
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

  useEffect(() => {
    const service = vault.queryService;
    if (!service) {
      setTasks([]);
      setLoading(false);
      return;
    }
    let alive = true;
    const versionAtStart = gate.value;
    setLoading(true);
    service
      .listTasks()
      .then((rows) => {
        if (alive && gate.canCommit(versionAtStart)) {
          setTasks(rows);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive && gate.canCommit(versionAtStart)) {
          setTasks([]);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [vault, bump, tick, gate]);

  const groups = useMemo(
    () => groupTasksByNote(filterTasks(tasks, { status, text })),
    [tasks, status, text]
  );

  const toggle = useCallback(
    async (task: TaskRecord) => {
      gate.begin();
      try {
        const fresh = await vaultOps.read(vault, task.path);
        // The ordinal was taken from a snapshot; if the note changed since, it
        // may point at a different line now. Re-read and check before writing.
        if (scanTasks(fresh)[task.ordinal]?.text !== task.text) {
          setTick((x) => x + 1);
          return;
        }
        const next = toggleTaskAtIndex(fresh, task.ordinal, !task.done);
        if (!next.changed) {
          setTick((x) => x + 1);
          return;
        }
        await vaultOps.save(vault, task.path, next.content);
        setTasks((prev) =>
          prev.map((tk) => (tk.path === task.path && tk.ordinal === task.ordinal ? { ...tk, done: !task.done } : tk))
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        gate.finish();
      }
    },
    [gate, vault]
  );

  const open = (task: TaskRecord) => {
    // Opens the note AND jumps to the line — the same parking store the search
    // results use, because the editor is not mounted yet at this point.
    setPendingSearchJump({ path: task.path, term: taskLabel(task.text).slice(0, 40) });
    onOpenNote(task.path);
  };

  const count = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="m-page" ref={ptrRef}>
      {ptrIndicator}
      <header className="m-header">
        {onBack && (
          <button aria-label={t("common.back", { defaultValue: "Zurück" })} className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
        )}
        <h1>{t("tasks.title")}</h1>
        <button aria-label={t("tasks.refresh")} className="m-iconbtn" onClick={() => setTick((x) => x + 1)}>
          <RefreshCw size={18} />
        </button>
      </header>

      <div className="m-seg">
        {(["open", "done", "all"] as const).map((s) => (
          <button
            className={`m-seg-item ${status === s ? "is-on" : ""}`}
            data-testid={`tasks-filter-${s}`}
            key={s}
            onClick={() => setStatus(s)}
          >
            {t(`tasks.${s}`)}
          </button>
        ))}
      </div>

      <input
        className="m-searchfield"
        onChange={(e) => setText(e.target.value)}
        placeholder={t("tasks.filterText")}
        value={text}
      />

      {loading ? null : count === 0 ? (
        <EmptyState title={t("tasks.title")}>{t("tasks.empty")}</EmptyState>
      ) : (
        groups.map((group) => (
          <section key={group.path}>
            <p className="m-sectionlabel">{noteDisplayName(group.title || group.path)}</p>
            <div className="m-card">
              {group.items.map((task) => (
                <div className="m-row" key={`${task.path}:${task.ordinal}`}>
                  <button
                    aria-label={t(task.done ? "tasks.open" : "tasks.done")}
                    className="m-iconbtn"
                    data-testid="task-toggle"
                    onClick={() => void toggle(task)}
                  >
                    {task.done ? <CheckSquare className="m-accent" size={18} /> : <Square size={18} />}
                  </button>
                  <button className="m-linestack" onClick={() => open(task)}>
                    <span style={task.done ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                      <TaskText text={task.text} />
                    </span>
                    {(task.due || task.tags.length > 0) && (
                      <small>
                        {task.due && <span className="m-badge-muted">{task.due}</span>}
                        {task.tags.map((tag) => (
                          <span className="m-chip" key={tag}>
                            #{tag}
                          </span>
                        ))}
                      </small>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
