import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare, ChevronLeft, Database, RefreshCw, Square, Table } from "lucide-react";
import {
  EmptyState,
  TaskMutationGate,
  applyTaskCompletion,
  applyTaskStatusOption,
  createTaskInDatabase,
  filterTaskDbRows,
  filterTasks,
  groupTasksByNote,
  noteDisplayName,
  parseBaseConfig,
  parseInlineMarkdown,
  promoteTask,
  setPendingSearchJump,
  statusModelOf,
  taskDbRows,
  toast,
  toggleTaskAtIndex,
  resolveTaskCompletionModel,
  type InlineNode,
  type TaskCompletionModel,
  type TaskDbRow,
  type TaskStatusFilter,
} from "@plainva/ui";
import {
  readFrontmatterPath,
  scanTasks,
  setFrontmatterPath,
  type TaskRecord,
} from "@plainva/core";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { getMobileSettings } from "../services/mobileSettings";
import { mPrompt, mSelect } from "../services/mobileDialogs";
import { syncSoon } from "../services/syncService";
import { vaultOps, type MobileVault } from "../services/vaultService";

/**
 * Tasks on the phone (plan P7, S22/S23).
 *
 * Two sections, the same two the desktop has: the vault's task DATABASE (row
 * based — one note per task, with status and due date) and every `- [ ]` in the
 * vault grouped by note (line based — the aggregation a `.base` structurally
 * cannot do). Which tasks a filter leaves, what "done" means in a database and
 * how a checkbox is promoted all come from `@plainva/ui`, so this screen and
 * the desktop answer those questions identically.
 *
 * OKF-safe: checking a box rewrites exactly the one `[ ]`/`[x]` character; a
 * database entry is an ordinary note whose frontmatter is edited surgically.
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
  onOpenBase,
}: {
  vault: MobileVault;
  bump: number;
  onBack?: () => void;
  onOpenNote: (path: string) => void;
  onOpenBase?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TaskStatusFilter>("open");
  const [text, setText] = useState("");
  const [tick, setTick] = useState(0);
  const [taskDb, setTaskDb] = useState("");
  const [dbRows, setDbRows] = useState<TaskDbRow[] | null>(null);
  const [dbCompletion, setDbCompletion] = useState<TaskCompletionModel | null>(null);
  // A listTasks() read is asynchronous; a checkbox write can finish while an
  // older read is still in flight, and that older result must never roll the
  // box back to its pre-write value.
  const [gate] = useState(() => new TaskMutationGate());
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

  /** Promotion and creation write through vaultOps.save, so the new note lands
   *  in the index, the backup chain and the sync queue like any other write. */
  const promotionAdapter = useMemo(
    () => ({
      readTextFile: (path: string) => vaultOps.read(vault, path),
      writeTextFile: (path: string, content: string) => vaultOps.save(vault, path, content),
      exists: (path: string) => vault.files.exists(path),
    }),
    [vault]
  );

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

  // The task database: its rows, its completion model and its date column, all
  // derived from the `.base`'s own schema — never guessed by column name.
  useEffect(() => {
    const db = getMobileSettings().taskDatabase.trim();
    setTaskDb(db);
    const service = vault.queryService;
    if (!db || !service) {
      setDbRows(null);
      setDbCompletion(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const config = parseBaseConfig(await vaultOps.read(vault, db));
        const rows = await service.queryDatabaseFiles(config);
        if (!alive) return;
        const completion = resolveTaskCompletionModel(config);
        setDbCompletion(completion);
        setDbRows(taskDbRows(rows as Record<string, unknown>[], config, completion));
      } catch {
        if (alive) setDbRows(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [vault, bump, tick]);

  const groups = useMemo(
    () => groupTasksByNote(filterTasks(tasks, { status, text })),
    [tasks, status, text]
  );
  const dbVisible = useMemo(() => filterTaskDbRows(dbRows ?? [], { status, text }), [dbRows, status, text]);

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

  /** Surgical frontmatter edit of a database note, then a refresh. */
  const writeDbNote = useCallback(
    async (path: string, mutate: (raw: string) => string) => {
      try {
        const raw = await vaultOps.read(vault, path);
        const next = mutate(raw);
        if (next !== raw) {
          await vaultOps.save(vault, path, next);
          syncSoon();
        }
        setTick((x) => x + 1);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [vault]
  );

  const toggleDbRow = useCallback(
    (row: TaskDbRow) => {
      if (!dbCompletion) return;
      const model = dbCompletion;
      void writeDbNote(row.path, (raw) =>
        applyTaskCompletion(
          raw,
          model,
          !row.done,
          (c, p) => readFrontmatterPath(c, p),
          (c, p, v) => setFrontmatterPath(c, p, v)
        )
      );
    },
    [dbCompletion, writeDbNote]
  );

  const pickDbStatus = useCallback(
    (row: TaskDbRow) => {
      const model = dbCompletion;
      const statusModel = statusModelOf(model);
      if (!model || !statusModel) return;
      void (async () => {
        const picked = await mSelect({
          title: t("tasks.setStatus"),
          options: statusModel.options.map((o) => ({ value: o, label: o })),
          value: row.status ?? "",
        });
        if (picked === null) return;
        await writeDbNote(row.path, (raw) =>
          applyTaskStatusOption(raw, model, picked, (c, p, v) => setFrontmatterPath(c, p, v))
        );
      })();
    },
    [dbCompletion, writeDbNote, t]
  );

  const createDbTask = useCallback(() => {
    if (!taskDb) return;
    void (async () => {
      const answer = await mPrompt({ title: t("tasks.newDbTask"), message: t("tasks.newDbTaskPrompt") });
      const title = answer.cancelled ? "" : answer.value.trim();
      if (!title) return;
      const res = await createTaskInDatabase({
        adapter: promotionAdapter,
        dbPath: taskDb,
        title,
        noteType: getMobileSettings().defaultNoteType,
      }).catch(() => null);
      if (!res || !res.ok) {
        toast.error(t(res && res.reason === "noFolder" ? "tasks.promoteNoFolder" : "tasks.promoteFailed"));
        return;
      }
      syncSoon();
      setTick((x) => x + 1);
      onOpenNote(res.notePath);
    })();
  }, [taskDb, promotionAdapter, onOpenNote, t]);

  /** Promotes a checkbox into the task database — the same shared path the
   *  desktop uses, so a task promoted on either device looks identical. */
  const promote = useCallback(
    (task: TaskRecord) => {
      if (!taskDb) {
        toast.info(t("tasks.promoteNoDb"));
        return;
      }
      void (async () => {
        const allNotePaths = vault.queryService
          ? (await vault.queryService.listNotes().catch(() => [])).map((n) => n.path)
          : [];
        const res = await promoteTask({
          adapter: promotionAdapter,
          sourcePath: task.path,
          task,
          dbPath: taskDb,
          noteType: getMobileSettings().defaultNoteType,
          allNotePaths,
          fallbackTitle: t("tasks.promoteFallbackTitle"),
        }).catch(() => null);
        if (!res || !res.ok) {
          const reason = res && !res.ok ? res.reason : null;
          if (reason === "stale") {
            toast.info(t("tasks.promoteStale"));
            setTick((x) => x + 1);
          } else {
            toast.error(t(reason === "noFolder" ? "tasks.promoteNoFolder" : "tasks.promoteFailed"));
          }
          return;
        }
        syncSoon();
        toast.info(t("tasks.promoted", { name: res.title }));
        setTick((x) => x + 1);
      })();
    },
    [taskDb, promotionAdapter, vault, t]
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

      {taskDb && (
        <section data-testid="task-db-section">
          <p className="m-sectionlabel">{t("tasks.dbSection")}</p>
          <div className="m-card">
            {dbVisible.length === 0 ? (
              <p className="m-hint">{t("tasks.dbEmpty")}</p>
            ) : (
              dbVisible.map((row) => (
                <div className="m-row" key={row.path}>
                  <button
                    aria-label={t(row.done ? "tasks.open" : "tasks.done")}
                    className="m-iconbtn"
                    data-testid="task-db-toggle"
                    disabled={!dbCompletion}
                    onClick={() => toggleDbRow(row)}
                  >
                    {row.done ? <CheckSquare className="m-accent" size={18} /> : <Square size={18} />}
                  </button>
                  <button className="m-linestack" onClick={() => onOpenNote(row.path)}>
                    <span style={row.done ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                      {noteDisplayName(row.title)}
                    </span>
                    {row.due && (
                      <small>
                        <span className="m-badge-muted">{row.due}</span>
                      </small>
                    )}
                  </button>
                  {row.status && (
                    <button className="m-chip" data-testid="task-db-status" onClick={() => pickDbStatus(row)}>
                      {row.status}
                    </button>
                  )}
                </div>
              ))
            )}
            <div className="m-btnrow">
              {onOpenBase && (
                <button className="m-btn" onClick={() => onOpenBase(taskDb)} type="button">
                  <Table size={18} />
                  {t("tasks.openDb")}
                </button>
              )}
              <button className="m-btn m-btn--tonal" data-testid="task-db-new" onClick={createDbTask} type="button">
                {t("tasks.newDbTask")}
              </button>
            </div>
          </div>
          <p className="m-sectionlabel">{t("tasks.notesSection")}</p>
        </section>
      )}

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
                  {taskDb && (
                    <button
                      aria-label={t("tasks.promote")}
                      className="m-iconbtn"
                      data-testid="task-promote"
                      onClick={() => promote(task)}
                    >
                      <Database size={18} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
