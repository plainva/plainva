import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare, Square, RefreshCw, CalendarClock, FileText, EyeOff, Eye, Database, Table } from "lucide-react";
import { scanTasks, setFrontmatterPath, deleteFrontmatterPath, type TaskRecord } from "@plainva/core";
import { toggleTaskAtIndex, setPendingSearchJump, noteDisplayName, IconButton, Button, parseInlineMarkdown, type InlineNode, toast, MenuSurface, MenuItem, MenuLabel, parseBaseConfig } from "@plainva/ui";
import { useVault, templateFolderKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { getTaskDatabasePath } from "../../services/taskDatabase";
import { promoteTask } from "../../services/taskPromotion";
import { getConfiguredNoteType } from "../../services/newNote";
import { applyIndexChanges } from "../../services/fileActions";
import { notifyFileOps } from "../../services/indexMdAutoUpdate";

const inlineLinkStyle: React.CSSProperties = { color: "var(--accent-color)" };
const inlineCodeStyle: React.CSSProperties = { background: "var(--code-bg)", borderRadius: "var(--radius-xs)", padding: "0 3px", fontSize: "0.9em" };
const inlineMarkStyle: React.CSSProperties = { background: "var(--highlight-bg)", color: "inherit", borderRadius: "var(--radius-xs)" };

/** Renders the inline-markdown token tree to React nodes. In the Tasks view the
 * whole row opens the note, so links render as their (tinted) display text —
 * never as separate interactive elements nested inside the row button. */
function renderInlineNodes(nodes: InlineNode[], keyPrefix = ""): React.ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}${i}`;
    switch (n.kind) {
      case "text": return <span key={key}>{n.text}</span>;
      case "br": return <br key={key} />;
      case "code": return <code key={key} style={inlineCodeStyle}>{n.text}</code>;
      case "strong": return <strong key={key}>{renderInlineNodes(n.children, `${key}.`)}</strong>;
      case "em": return <em key={key}>{renderInlineNodes(n.children, `${key}.`)}</em>;
      case "strike": return <del key={key}>{renderInlineNodes(n.children, `${key}.`)}</del>;
      case "strongEm": return <strong key={key}><em>{renderInlineNodes(n.children, `${key}.`)}</em></strong>;
      case "highlight": return <mark key={key} style={inlineMarkStyle}>{renderInlineNodes(n.children, `${key}.`)}</mark>;
      case "wikiLink": return <span key={key} style={inlineLinkStyle}>{n.display}</span>;
      case "link": return <span key={key} style={inlineLinkStyle}>{n.label}</span>;
      case "url": return <span key={key} style={inlineLinkStyle}>{n.href}</span>;
      default: return null;
    }
  });
}

/** Task line without the `#tags` and `📅 date` — those already render as chips
 * and a due pill, so they must not appear twice in the text. */
function stripTaskMeta(text: string): string {
  return text
    .replace(/📅\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/(^|\s)#[\p{L}\p{N}][\p{L}\p{N}_/-]*/gu, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Task text rendered as inline markdown (bold/italic/code/==highlight==/links),
 * meta stripped; falls back to the raw text, then the empty label. */
function renderTaskText(text: string, emptyLabel: string): React.ReactNode {
  const shown = stripTaskMeta(text) || text;
  return shown ? renderInlineNodes(parseInlineMarkdown(shown)) : emptyLabel;
}

interface Props {
  /** Open a note (the search-jump store already carries the line to reveal). */
  onOpenPath: (path: string, newTab?: boolean) => void;
}

type StatusFilter = "open" | "done" | "all";

/**
 * Vault-wide Tasks view (B4) — the file-based aggregation a `.base` cannot do
 * (it is row/note-based, not line-based). Every `- [ ]`/`- [x]` in the vault,
 * grouped by note, with status/text/folder/tag/due filters. A checkbox flips the
 * marker back through the shared toggleTaskAtIndex + an atomic write; a click on
 * the task opens the note and jumps to the line. OKF-safe: tasks are ordinary
 * Markdown list items, never touched beyond the single `[ ]`/`[x]` character.
 *
 * A note opts out of aggregation with `plainva.tasks: false` in its frontmatter
 * (the truth stays in the file, syncs, is visible in Obsidian). The view hides
 * such notes by default and offers one-click hide/show per note plus a bulk
 * "hide templates" that stamps the marker into the template folder's notes.
 */
export function TasksView({ onOpenPath }: Props) {
  const { t } = useTranslation();
  const { queryService, vaultAdapter, vaultPath, fileTreeVersion, indexer, triggerFileTreeUpdate } = useVault();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [text, setText] = useState("");
  const [folder, setFolder] = useState("");
  const [tag, setTag] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [templateFolder, setTemplateFolder] = useState("Templates");
  const [refreshTick, setRefreshTick] = useState(0);
  // Standard task database (PIM plan 1a): its entries render as an own section
  // above the checkbox groups, and every checkbox row can be promoted into it.
  const [taskDb, setTaskDb] = useState<string | null>(null);
  const [dbRows, setDbRows] = useState<{ path: string; title: string; status: string | null; due: string | null }[] | null>(null);
  const [promoteMenu, setPromoteMenu] = useState<{ task: TaskRecord; at: { x: number; y: number } } | null>(null);
  const [allBases, setAllBases] = useState<{ path: string; title: string }[]>([]);

  useEffect(() => {
    let alive = true;
    if (!queryService) {
      setTasks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    queryService
      .listTasks()
      .then((rows) => {
        if (alive) {
          setTasks(rows);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setTasks([]);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [queryService, fileTreeVersion, refreshTick]);

  useEffect(() => {
    if (!vaultPath) return;
    let alive = true;
    getSettingsStore()
      .then((s) => s.get<string>(templateFolderKey(vaultPath)))
      .then((v) => {
        if (alive) setTemplateFolder(v || "Templates");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [vaultPath]);

  // Task-database section: configured `.base` path + its rows (title, status,
  // due — derived from the database's own column schema). Reloads with the
  // index like the checkbox list; unaffected by the checkbox filters (the rich
  // filtering lives in the `.base` itself).
  useEffect(() => {
    let alive = true;
    if (!vaultPath) {
      setTaskDb(null);
      setDbRows(null);
      return;
    }
    void (async () => {
      const db = await getTaskDatabasePath(vaultPath);
      if (!alive) return;
      setTaskDb(db);
      if (!db || !queryService || !vaultAdapter) {
        setDbRows(null);
        return;
      }
      try {
        const config = parseBaseConfig(await vaultAdapter.readTextFile(db));
        const rows = await queryService.queryDatabaseFiles(config);
        const cols: Record<string, any> = config?.columns ?? {};
        const dueKey = Object.keys(cols).find((k) => cols[k]?.input === "date" || cols[k]?.input === "datetime") ?? null;
        const statusKey = Object.keys(cols).find((k) => cols[k]?.input === "status" || cols[k]?.input === "select") ?? null;
        if (!alive) return;
        // queryDatabaseFiles rows carry `file.*` fields plus the bare
        // frontmatter property keys (the same shape every base view reads).
        setDbRows(
          rows.map((r: any) => ({
            path: String(r["file.path"] ?? ""),
            title: String(r["file.name"] ?? String(r["file.path"] ?? "").split("/").pop()?.replace(/\.md$/i, "") ?? ""),
            status: statusKey && r[statusKey] != null && r[statusKey] !== "" ? String(r[statusKey]) : null,
            due: dueKey && r[dueKey] != null && r[dueKey] !== "" ? String(r[dueKey]).slice(0, 10) : null,
          }))
        );
      } catch {
        if (alive) setDbRows(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath, queryService, vaultAdapter, fileTreeVersion, refreshTick]);

  // Promote a checkbox into the task database (default DB on click; any DB via
  // the context menu). The service re-verifies the ordinal against the fresh
  // file — a stale listing refreshes instead of rewriting the wrong line.
  const promote = useCallback(
    async (task: TaskRecord, dbOverride?: string) => {
      if (!vaultAdapter || !vaultPath) return;
      const db = dbOverride ?? (await getTaskDatabasePath(vaultPath));
      if (!db) {
        toast.info(t("tasks.promoteNoDb", { defaultValue: "Keine Standard-Aufgabendatenbank festgelegt." }));
        return;
      }
      try {
        const allNotePaths = queryService ? (await queryService.listNotes()).map((n) => n.path) : [];
        const res = await promoteTask({
          adapter: vaultAdapter,
          sourcePath: task.path,
          task,
          dbPath: db,
          noteType: await getConfiguredNoteType(vaultPath),
          allNotePaths,
          fallbackTitle: t("tasks.promoteFallbackTitle", { defaultValue: "Aufgabe" }),
        });
        if (!res.ok) {
          if (res.reason === "stale") {
            toast.info(t("tasks.promoteStale", { defaultValue: "Die Notiz hat sich geändert — Liste aktualisiert." }));
            setRefreshTick((x) => x + 1);
          } else if (res.reason === "noFolder") {
            toast.error(t("tasks.promoteNoFolder", { defaultValue: "Die Datenbank hat keinen Ablage-Ordner." }));
          } else {
            toast.error(t("tasks.promoteFailed", { defaultValue: "Verschieben fehlgeschlagen." }));
          }
          return;
        }
        // Targeted reindex of the new note + rewritten source (Issue #9 rule:
        // never a full-vault scan per file op), then refresh both sections.
        if (indexer) {
          await applyIndexChanges(indexer, { added: [res.notePath, task.path] }).catch(() => {});
          triggerFileTreeUpdate([res.notePath, task.path]);
          notifyFileOps([{ type: "create", path: res.notePath }]);
        }
        toast.info(t("tasks.promoted", { defaultValue: "Verschoben: {{name}}", name: res.title }));
        setRefreshTick((x) => x + 1);
      } catch (e) {
        console.error("[TasksView] promoting a task failed", e);
        toast.error(t("tasks.promoteFailed", { defaultValue: "Verschieben fehlgeschlagen." }));
      }
    },
    [vaultAdapter, vaultPath, queryService, indexer, triggerFileTreeUpdate, t]
  );

  const openPromoteMenu = useCallback(
    async (task: TaskRecord, at: { x: number; y: number }) => {
      try {
        setAllBases(queryService ? await queryService.listBases() : []);
      } catch {
        setAllBases([]);
      }
      setPromoteMenu({ task, at });
    },
    [queryService]
  );

  const visibleTasks = useMemo(
    () => (showHidden ? tasks : tasks.filter((tk) => !tk.excluded)),
    [tasks, showHidden]
  );

  const allFolders = useMemo(() => {
    const s = new Set<string>();
    for (const tk of visibleTasks) {
      const i = tk.path.lastIndexOf("/");
      if (i > 0) s.add(tk.path.slice(0, i));
    }
    return [...s].sort();
  }, [visibleTasks]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const tk of visibleTasks) for (const g of tk.tags) s.add(g);
    return [...s].sort();
  }, [visibleTasks]);

  // Not-yet-excluded notes under the template folder — the "hide templates"
  // bulk action targets exactly these (and the button hides once none remain).
  const templateNotePaths = useMemo(() => {
    const base = templateFolder.replace(/\/+$/, "");
    if (!base) return [] as string[];
    const prefix = base + "/";
    const s = new Set<string>();
    for (const tk of tasks) {
      if (!tk.excluded && (tk.path === base || tk.path.startsWith(prefix))) s.add(tk.path);
    }
    return [...s];
  }, [tasks, templateFolder]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return visibleTasks.filter((tk) => {
      if (status === "open" && tk.done) return false;
      if (status === "done" && !tk.done) return false;
      if (folder && tk.path !== folder && !tk.path.startsWith(folder + "/")) return false;
      if (tag && !tk.tags.includes(tag)) return false;
      if (dueOnly && !tk.due) return false;
      if (q && !tk.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [visibleTasks, status, folder, tag, dueOnly, text]);

  const groups = useMemo(() => {
    const m = new Map<string, { title: string; excluded: boolean; items: TaskRecord[] }>();
    for (const tk of filtered) {
      const g = m.get(tk.path);
      if (g) g.items.push(tk);
      else m.set(tk.path, { title: tk.title, excluded: tk.excluded, items: [tk] });
    }
    return [...m.entries()];
  }, [filtered]);

  const toggle = useCallback(
    async (task: TaskRecord) => {
      if (!vaultAdapter) return;
      try {
        const fresh = await vaultAdapter.readTextFile(task.path);
        // Guard against a stale ordinal (the note changed since it was listed):
        // only flip when the ordinal still points at the same task text.
        if (scanTasks(fresh)[task.ordinal]?.text !== task.text) {
          setRefreshTick((x) => x + 1);
          return;
        }
        const res = toggleTaskAtIndex(fresh, task.ordinal, !task.done);
        if (!res.changed) return;
        await vaultAdapter.writeTextFile(task.path, res.content);
        setTasks((prev) =>
          prev.map((t2) => (t2.path === task.path && t2.ordinal === task.ordinal ? { ...t2, done: !t2.done } : t2))
        );
      } catch {
        setRefreshTick((x) => x + 1);
      }
    },
    [vaultAdapter]
  );

  // Writes/removes the `plainva.tasks: false` opt-out marker in the note's
  // frontmatter (through the adapter's atomic + backup chain), then optimistically
  // updates the local state; a metadata re-index re-derives it from disk.
  const setNoteExcluded = useCallback(
    async (path: string, excluded: boolean) => {
      if (!vaultAdapter) return;
      try {
        const raw = await vaultAdapter.readTextFile(path);
        const next = excluded
          ? setFrontmatterPath(raw, ["plainva", "tasks"], false)
          : deleteFrontmatterPath(raw, ["plainva", "tasks"]);
        if (next !== raw) await vaultAdapter.writeTextFile(path, next);
        setTasks((prev) => prev.map((t2) => (t2.path === path ? { ...t2, excluded } : t2)));
      } catch (e) {
        console.error("[TasksView] toggling note exclusion failed", path, e);
        setRefreshTick((x) => x + 1);
      }
    },
    [vaultAdapter]
  );

  const hideAllTemplates = useCallback(async () => {
    for (const p of templateNotePaths) await setNoteExcluded(p, true);
  }, [templateNotePaths, setNoteExcluded]);

  const open = useCallback(
    (task: TaskRecord) => {
      setPendingSearchJump({ path: task.path, term: task.text.slice(0, 80) });
      onOpenPath(task.path, false);
    },
    [onOpenPath]
  );

  const segBtn = (value: StatusFilter, label: string) => (
    <button
      type="button"
      onClick={() => setStatus(value)}
      aria-pressed={status === value}
      style={{
        padding: "0.25rem 0.65rem",
        border: "none",
        cursor: "pointer",
        fontSize: "0.8rem",
        borderRadius: "var(--radius-pill)",
        background: status === value ? "var(--accent-color)" : "transparent",
        color: status === value ? "var(--accent-on)" : "var(--text-muted)",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.6rem 0.9rem", borderBottom: "1px solid var(--border-color)" }}>
        <strong style={{ fontSize: "1rem" }}>{t("tasks.title", { defaultValue: "Aufgaben" })}</strong>
        <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{filtered.length}</span>
        <div style={{ flex: 1 }} />
        {templateNotePaths.length > 0 && (
          <Button variant="ghost" onClick={() => void hideAllTemplates()}>
            {t("tasks.hideTemplates", { defaultValue: "Vorlagen ausblenden" })}
          </Button>
        )}
        <IconButton label={t("tasks.refresh", { defaultValue: "Aktualisieren" })} onClick={() => setRefreshTick((x) => x + 1)}>
          <RefreshCw size={15} />
        </IconButton>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "0.5rem 0.9rem", borderBottom: "1px solid var(--border-color)" }}>
        <div style={{ display: "inline-flex", gap: 2, background: "var(--bg-secondary)", borderRadius: "var(--radius-pill)", padding: 2 }}>
          {segBtn("open", t("tasks.open", { defaultValue: "Offen" }))}
          {segBtn("done", t("tasks.done", { defaultValue: "Erledigt" }))}
          {segBtn("all", t("tasks.all", { defaultValue: "Alle" }))}
        </div>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("tasks.filterText", { defaultValue: "Aufgaben filtern…" })}
          style={{ flex: "1 1 12rem", minWidth: "8rem", padding: "0.3rem 0.5rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-main)", fontSize: "0.85rem" }}
        />
        <select value={folder} onChange={(e) => setFolder(e.target.value)} style={selectStyle} aria-label={t("tasks.allFolders", { defaultValue: "Alle Ordner" })}>
          <option value="">{t("tasks.allFolders", { defaultValue: "Alle Ordner" })}</option>
          {allFolders.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select value={tag} onChange={(e) => setTag(e.target.value)} style={selectStyle} aria-label={t("tasks.allTags", { defaultValue: "Alle Tags" })}>
          <option value="">{t("tasks.allTags", { defaultValue: "Alle Tags" })}</option>
          {allTags.map((g) => (
            <option key={g} value={g}>#{g}</option>
          ))}
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.8rem", color: "var(--text-muted)", cursor: "pointer" }}>
          <input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} />
          {t("tasks.dueOnly", { defaultValue: "Nur mit Fälligkeit" })}
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.8rem", color: "var(--text-muted)", cursor: "pointer" }}>
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          {t("tasks.showHidden", { defaultValue: "Ausgeblendete anzeigen" })}
        </label>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0.4rem 0" }}>
        {taskDb && (
          <div data-testid="task-db-section" style={{ margin: "0 0.7rem 0.6rem", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.4rem 0.6rem", background: "var(--bg-secondary)", borderLeft: "3px solid var(--accent-color)" }}>
              <Database size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span style={{ fontWeight: 500, fontSize: "0.85rem", color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t("tasks.dbSection", { defaultValue: "Aufgaben-Datenbank" })}
              </span>
              <span style={{ flexShrink: 0, fontSize: "0.72rem", padding: "0.05rem 0.45rem", borderRadius: "var(--radius-pill)", background: "color-mix(in srgb, var(--accent-color) 16%, transparent)", color: "var(--accent-color)" }}>
                {dbRows?.length ?? 0}
              </span>
              <button
                type="button"
                onClick={() => onOpenPath(taskDb, false)}
                style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent", cursor: "pointer", padding: 0, color: "var(--text-muted)", fontSize: "0.78rem", flexShrink: 0 }}
              >
                <Table size={13} /> {t("tasks.openDb", { defaultValue: "Als Datenbank öffnen" })}
              </button>
            </div>
            <div style={{ padding: "0.25rem 0 0.35rem" }}>
              {(dbRows ?? []).length === 0 ? (
                <div style={{ color: "var(--text-muted)", padding: "0.35rem 0.65rem", fontSize: "0.85rem" }}>
                  {t("tasks.dbEmpty", { defaultValue: "Noch keine Einträge" })}
                </div>
              ) : (
                dbRows!.map((r) => (
                  <div key={r.path} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "0.3rem 0.65rem" }}>
                    <button
                      type="button"
                      onClick={() => onOpenPath(r.path, false)}
                      style={{ flex: 1, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0, color: "var(--text-main)", fontSize: "0.9rem", lineHeight: 1.4 }}
                    >
                      {noteDisplayName(r.title)}
                      {r.status ? (
                        <span style={{ marginLeft: 6, display: "inline-block", fontSize: "0.72rem", padding: "0.02rem 0.4rem", borderRadius: "var(--radius-pill)", background: "color-mix(in srgb, var(--accent-color) 16%, transparent)", color: "var(--accent-color)", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                          {r.status}
                        </span>
                      ) : null}
                      {r.due ? (
                        <span style={{ marginLeft: 6, display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.72rem", padding: "0.02rem 0.4rem", borderRadius: "var(--radius-pill)", background: "var(--warning-bg)", color: "var(--warning-text)", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                          <CalendarClock size={11} /> {r.due}
                        </span>
                      ) : null}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {taskDb && (
          <div style={{ margin: "0.2rem 0.9rem 0.4rem", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", fontWeight: 500 }}>
            {t("tasks.notesSection", { defaultValue: "Aus Notizen" })}
          </div>
        )}
        {loading ? null : groups.length === 0 ? (
          <div style={{ color: "var(--text-muted)", padding: "2rem", textAlign: "center", fontSize: "0.9rem" }}>
            {t("tasks.empty", { defaultValue: "Keine Aufgaben" })}
          </div>
        ) : (
          groups.map(([path, group]) => (
            <div
              key={path}
              style={{
                margin: "0 0.7rem 0.6rem",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                overflow: "hidden",
                opacity: group.excluded ? 0.55 : 1,
              }}
            >
              <div
                onClick={() => onOpenPath(path, false)}
                title={path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "0.4rem 0.6rem",
                  background: "var(--bg-secondary)",
                  borderLeft: "3px solid var(--accent-color)",
                  cursor: "pointer",
                }}
              >
                <FileText size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <span style={{ fontWeight: 500, fontSize: "0.85rem", color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {noteDisplayName(group.title)}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    flexShrink: 0,
                    fontSize: "0.72rem",
                    padding: "0.05rem 0.45rem",
                    borderRadius: "var(--radius-pill)",
                    background: "color-mix(in srgb, var(--accent-color) 16%, transparent)",
                    color: "var(--accent-color)",
                  }}
                >
                  {group.items.length}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void setNoteExcluded(path, !group.excluded);
                  }}
                  aria-label={group.excluded ? t("tasks.showInView", { defaultValue: "Wieder in Aufgaben einblenden" }) : t("tasks.hideFromView", { defaultValue: "Aus Aufgaben ausblenden" })}
                  title={group.excluded ? t("tasks.showInView", { defaultValue: "Wieder in Aufgaben einblenden" }) : t("tasks.hideFromView", { defaultValue: "Aus Aufgaben ausblenden" })}
                  style={{ marginLeft: 6, border: "none", background: "transparent", cursor: "pointer", padding: 0, color: "var(--text-muted)", flexShrink: 0, display: "inline-flex", alignItems: "center" }}
                >
                  {group.excluded ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </div>
              <div style={{ padding: "0.25rem 0 0.35rem" }}>
                {group.items.map((task) => (
                  <div key={task.ordinal} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "0.3rem 0.65rem" }}>
                    <button
                      type="button"
                      onClick={() => toggle(task)}
                      aria-label={task.done ? t("tasks.done", { defaultValue: "Erledigt" }) : t("tasks.open", { defaultValue: "Offen" })}
                      style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, marginTop: 2, color: task.done ? "var(--accent-color)" : "var(--text-muted)", flexShrink: 0 }}
                    >
                      {task.done ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => open(task)}
                      style={{ flex: 1, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0, color: task.done ? "var(--text-muted)" : "var(--text-main)", textDecoration: task.done ? "line-through" : "none", fontSize: "0.9rem", lineHeight: 1.4 }}
                    >
                      {renderTaskText(task.text, t("tasks.empty", { defaultValue: "Keine Aufgaben" }))}
                      {task.due ? (
                        <span style={{ marginLeft: 6, display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.72rem", padding: "0.02rem 0.4rem", borderRadius: "var(--radius-pill)", background: "var(--warning-bg)", color: "var(--warning-text)", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                          <CalendarClock size={11} /> {task.due}
                        </span>
                      ) : null}
                      {task.tags.map((g) => (
                        <span key={g} style={{ marginLeft: 6, display: "inline-block", fontSize: "0.72rem", padding: "0.02rem 0.4rem", borderRadius: "var(--radius-pill)", background: "color-mix(in srgb, var(--accent-color) 16%, transparent)", color: "var(--accent-color)", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                          #{g}
                        </span>
                      ))}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (taskDb) void promote(task);
                        else void openPromoteMenu(task, { x: e.clientX, y: e.clientY });
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void openPromoteMenu(task, { x: e.clientX, y: e.clientY });
                      }}
                      aria-label={t("tasks.promote", { defaultValue: "Zur Aufgaben-Datenbank verschieben" })}
                      title={t("tasks.promote", { defaultValue: "Zur Aufgaben-Datenbank verschieben" })}
                      data-testid="task-promote"
                      style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, marginTop: 2, color: "var(--text-muted)", flexShrink: 0, display: "inline-flex", alignItems: "center" }}
                    >
                      <Database size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {promoteMenu && (
        <MenuSurface open onClose={() => setPromoteMenu(null)} at={promoteMenu.at} ariaLabel={t("tasks.promoteTo", { defaultValue: "In Datenbank verschieben" })}>
          <MenuLabel>{t("tasks.promoteTo", { defaultValue: "In Datenbank verschieben" })}</MenuLabel>
          {allBases.map((b) => (
            <MenuItem
              key={b.path}
              onSelect={() => {
                const task = promoteMenu.task;
                setPromoteMenu(null);
                void promote(task, b.path);
              }}
            >
              {b.path === taskDb ? `${b.title} ★` : b.title}
            </MenuItem>
          ))}
          {allBases.length === 0 && <MenuLabel>{t("sidebar.noDatabases", { defaultValue: "Keine Datenbanken" })}</MenuLabel>}
        </MenuSurface>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "0.3rem 0.5rem",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border-color)",
  background: "var(--bg-primary)",
  color: "var(--text-main)",
  fontSize: "0.85rem",
  maxWidth: "10rem",
};
