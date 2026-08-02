import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CalendarPlus, CheckSquare, ChevronLeft, Database, RefreshCw, Repeat, Square, Table } from "lucide-react";
import { applyTaskCompletion, applyTaskStatusOption, Button, canRepeat, Chip, createTaskInDatabase, createTaskTimeBlock, describeRule, EmptyState, filterTaskDbRows, filterTasks, groupTasksByNote, IconButton, type InlineNode, isMirroredNamespace, localIsoKey, minutesToTime, nextDueDate, nextHalfHourMinutes, noteDisplayName, parseBaseConfig, parseInlineMarkdown, promoteTask, readRepeatRule, repeatFromNamespace, type RepeatRule, resolveDefaultCalendarKey, resolveTaskCompletionModel, SearchField, Segmented, setPendingSearchJump, statusModelOf, type TaskBlockValues, type TaskCompletionModel, taskDbDueKey, type TaskDbRow, taskDbRows, TaskMutationGate, type TaskStatusFilter, toast, toggleTaskAtIndex, writeNextOccurrenceNote, writeRepeatRule } from "@plainva/ui";
import {
  readFrontmatterPath,
  scanTasks,
  setFrontmatterPath,
  type TaskRecord,
} from "@plainva/core";
import { RepeatTaskSheet } from "../components/RepeatTaskSheet";
import { TimeBlockSheet } from "../components/TimeBlockSheet";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { getMobileSettings } from "../services/mobileSettings";
import { mPrompt, mSelect } from "../services/mobileDialogs";
import { pimSyncNow, pimTargetForCalendarKey, writablePimCalendarOptions } from "../services/pim/pimService";
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
  /** The database's date column — where a generated occurrence writes its
   *  next due date. Resolved from the schema, never from a column name. */
  const [dbDueKey, setDbDueKey] = useState<string | null>(null);
  /** Repeat rule + provider origin per row, read from the INDEXED `plainva`
   *  namespace — so a badge costs no file read. */
  const [dbMeta, setDbMeta] = useState<Record<string, { repeat: RepeatRule | null; mirrored: boolean }>>({});
  const [repeatTarget, setRepeatTarget] = useState<{ path: string; title: string; rule: RepeatRule | null; due: string | null } | null>(null);
  /** "Block time": `notePath` is the note that receives the anchor (a database
   *  entry has one, a checkbox does not); `linkPath` is what the event links
   *  back to. */
  const [blockTarget, setBlockTarget] = useState<{ title: string; due: string | null; notePath?: string; linkPath: string } | null>(null);
  const [calendarOptions, setCalendarOptions] = useState<Array<{ value: string; label: string }>>([]);
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
        setDbDueKey(taskDbDueKey(config));
        const raw = rows as Record<string, unknown>[];
        setDbRows(taskDbRows(raw, config, completion));
        setDbMeta(
          Object.fromEntries(
            raw.map((r) => [
              String(r["file.path"] ?? ""),
              { repeat: repeatFromNamespace(r["plainva"]), mirrored: isMirroredNamespace(r["plainva"]) },
            ])
          )
        );
      } catch {
        if (alive) setDbRows(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [vault, bump, tick]);

  // Writable calendars for "block time" — the SAME rule the calendar uses
  // (shared helper), so the two pickers can never disagree about which
  // calendars accept a write. Visibility is not a write permission.
  useEffect(() => {
    let alive = true;
    void writablePimCalendarOptions()
      .then((options) => {
        if (alive) setCalendarOptions(options);
      })
      .catch(() => {
        if (alive) setCalendarOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [vault, bump, tick]);

  const submitBlock = useCallback(
    async (values: TaskBlockValues, calendarKey: string) => {
      const target = blockTarget;
      if (!target) return;
      const provider = await pimTargetForCalendarKey(calendarKey);
      if (!provider) throw new Error(t("pim.eventWriteFailed"));
      const allPaths = vault.queryService
        ? (await vault.queryService.listNotes().catch(() => [])).map((n) => n.path)
        : [target.linkPath];
      const res = await createTaskTimeBlock({
        adapter: vault.files,
        target: provider,
        calendarKey,
        title: target.title,
        values,
        notePath: target.notePath,
        linkPath: target.linkPath,
        allPaths,
      });
      setBlockTarget(null);
      // An event that exists but could not be linked is a warning, never a
      // failure — saying "done" would hide half the outcome.
      toast.info(
        target.notePath && !res.anchored
          ? t("pim.blockNotAnchored")
          : t("pim.blockCreated", { title: target.title })
      );
      if (target.notePath) setTick((x) => x + 1);
      pimSyncNow();
    },
    [blockTarget, vault, t]
  );

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

  /**
   * Writes the NEXT occurrence of a repeating task: a copy of the note, open
   * again, with the next due date, beside the completed one. The completed note
   * stays as the record of what was done — that is the point of a generator
   * over a rule: history is real notes, not a projection.
   */
  const spawnNextOccurrence = useCallback(
    async (path: string) => {
      if (!dbCompletion) return;
      try {
        const raw = await vaultOps.read(vault, path);
        const rule = readRepeatRule(raw);
        if (!rule || !canRepeat(raw)) return;
        const currentDue = dbDueKey ? String(readFrontmatterPath(raw, [dbDueKey]) ?? "").slice(0, 10) : null;
        const next = nextDueDate(rule, currentDue || null, localIsoKey(new Date()));
        if (!next) return;
        let content = applyTaskCompletion(
          raw,
          dbCompletion,
          false,
          (c, p) => readFrontmatterPath(c, p),
          (c, p, v) => setFrontmatterPath(c, p, v)
        );
        if (dbDueKey) content = setFrontmatterPath(content, [dbDueKey], next);
        const created = await writeNextOccurrenceNote(
          { exists: (p) => vault.files.exists(p), writeTextFile: (p, c) => vaultOps.save(vault, p, c) },
          path,
          content
        );
        if (!created) return;
        syncSoon();
        setTick((x) => x + 1);
        toast.info(t("tasks.repeatSpawned", { date: next }));
      } catch {
        toast.error(t("tasks.repeatFailed"));
      }
    },
    [dbCompletion, dbDueKey, vault, t]
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
      ).then(() => {
        // Checking a repeating task off is what CREATES the next one — there is
        // no hidden series, so nothing exists until it is earned.
        if (!row.done) void spawnNextOccurrence(row.path);
      });
    },
    [dbCompletion, writeDbNote, spawnNextOccurrence]
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
      {/* Only when this screen was PUSHED. As a tab root the shell's large app
          bar is already above it — two stacked headers were the visible half of
          the tab never having been wired (the other half was the router). Every
          other tab root gates the same way; refreshing at the root is the pull
          gesture, exactly as on Browse, Today, Tags, Bookmarks and Databases. */}
      {onBack && (
        <header className="m-header">
          <IconButton label={t("common.back", { defaultValue: "Zurück" })} onClick={onBack}>
            <ChevronLeft size={20} />
          </IconButton>
          <h1>{t("tasks.title")}</h1>
          <IconButton label={t("tasks.refresh")} onClick={() => setTick((x) => x + 1)}>
            <RefreshCw size={18} />
          </IconButton>
        </header>
      )}

      <Segmented
        ariaLabel={t("tasks.title")}
        options={(["open", "done", "all"] as const).map((s) => ({
          value: s,
          label: t(`tasks.${s}`),
          testId: `tasks-filter-${s}`,
        }))}
        value={status}
        onChange={setStatus}
      />

      <SearchField
        clearLabel={t("sidebar.clearSearch")}
        onValueChange={setText}
        placeholder={t("tasks.filterText")}
        value={text}
      />

      {taskDb && (
        <section data-testid="task-db-section">
          <p className="m-sectionlabel">{t("tasks.dbSection")}</p>
          <div className="pv-card m-card">
            {dbVisible.length === 0 ? (
              <p className="m-hint">{t("tasks.dbEmpty")}</p>
            ) : (
              dbVisible.map((row) => (
                <div className="m-row" key={row.path}>
                  <IconButton
                    label={t(row.done ? "tasks.open" : "tasks.done")}
                    data-testid="task-db-toggle"
                    disabled={!dbCompletion}
                    onClick={() => toggleDbRow(row)}
                  >
                    {row.done ? <CheckSquare className="m-accent" size={18} /> : <Square size={18} />}
                  </IconButton>
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
                  {dbMeta[row.path]?.repeat && (
                    <Chip testId="task-db-repeat-badge">
                      {describeRule(dbMeta[row.path].repeat as RepeatRule, (key, o) => t(key, o))}
                    </Chip>
                  )}
                  {row.status && (
                    <Chip testId="task-db-status" onClick={() => pickDbStatus(row)}>
                      {row.status}
                    </Chip>
                  )}
                  {calendarOptions.length > 0 && (
                    <IconButton
                      label={t("pim.blockTime")}
                      data-testid="task-db-block"
                      onClick={() =>
                        setBlockTarget({
                          title: noteDisplayName(row.title),
                          due: row.due,
                          notePath: row.path,
                          linkPath: row.path,
                        })
                      }
                    >
                      <CalendarPlus size={18} />
                    </IconButton>
                  )}
                  {/* A task mirrored from a provider list keeps ITS recurrence —
                      a local generator on top would push duplicates back. */}
                  {!dbMeta[row.path]?.mirrored && (
                    <IconButton
                      label={t("tasks.repeat")}
                      data-testid="task-db-repeat"
                      onClick={() =>
                        setRepeatTarget({
                          path: row.path,
                          title: noteDisplayName(row.title),
                          rule: dbMeta[row.path]?.repeat ?? null,
                          due: row.due,
                        })
                      }
                    >
                      <Repeat size={18} />
                    </IconButton>
                  )}
                </div>
              ))
            )}
            <div className="m-btnrow">
              {onOpenBase && (
                <Button variant="ghost" onClick={() => onOpenBase(taskDb)}>
                  <Table size={18} />
                  {t("tasks.openDb")}
                </Button>
              )}
              <Button variant="tonal" data-testid="task-db-new" onClick={createDbTask}>
                {t("tasks.newDbTask")}
              </Button>
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
            <div className="pv-card m-card">
              {group.items.map((task) => (
                <div className="m-row" key={`${task.path}:${task.ordinal}`}>
                  <IconButton
                    label={t(task.done ? "tasks.open" : "tasks.done")}
                    data-testid="task-toggle"
                    onClick={() => void toggle(task)}
                  >
                    {task.done ? <CheckSquare className="m-accent" size={18} /> : <Square size={18} />}
                  </IconButton>
                  <button className="m-linestack" onClick={() => open(task)}>
                    <span style={task.done ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>
                      <TaskText text={task.text} />
                    </span>
                    {(task.due || task.tags.length > 0) && (
                      <small>
                        {task.due && <span className="m-badge-muted">{task.due}</span>}
                        {task.tags.map((tag) => (
                          <Chip size="sm" key={tag}>
                            #{tag}
                          </Chip>
                        ))}
                      </small>
                    )}
                  </button>
                  {calendarOptions.length > 0 && (
                    <IconButton
                      label={t("pim.blockTime")}
                      data-testid="task-block"
                      onClick={() =>
                        setBlockTarget({
                          title: taskLabel(task.text) || task.text,
                          due: task.due ?? null,
                          // A checkbox has no note of its own — only the event is
                          // created, linking back to the note the line lives in.
                          linkPath: task.path,
                        })
                      }
                    >
                      <CalendarPlus size={18} />
                    </IconButton>
                  )}
                  {taskDb && (
                    <IconButton
                      label={t("tasks.promote")}
                      data-testid="task-promote"
                      onClick={() => promote(task)}
                    >
                      <Database size={18} />
                    </IconButton>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {repeatTarget && (
        <RepeatTaskSheet
          currentDue={repeatTarget.due}
          initial={repeatTarget.rule}
          onClose={() => setRepeatTarget(null)}
          onSubmit={async (rule) => {
            const path = repeatTarget.path;
            await writeDbNote(path, (raw) => {
              if (rule && !canRepeat(raw)) throw new Error(t("tasks.repeatRemote"));
              return writeRepeatRule(raw, rule);
            });
            setRepeatTarget(null);
          }}
          taskTitle={repeatTarget.title}
        />
      )}

      {blockTarget && (
        <TimeBlockSheet
          calendarOptions={calendarOptions}
          initialCalendarKey={resolveDefaultCalendarKey(calendarOptions, "")}
          // A due task blocks on its due day by default, everything else today.
          initialDayKey={blockTarget.due ?? localIsoKey(new Date())}
          initialStartTime={minutesToTime(nextHalfHourMinutes(new Date()))}
          onClose={() => setBlockTarget(null)}
          onSubmit={submitBlock}
          taskTitle={blockTarget.title}
        />
      )}
    </div>
  );
}
