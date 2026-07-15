import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare, Square, RefreshCw, CalendarClock } from "lucide-react";
import { scanTasks, type TaskRecord } from "@plainva/core";
import { toggleTaskAtIndex, setPendingSearchJump, noteDisplayName, IconButton } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";

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
 */
export function TasksView({ onOpenPath }: Props) {
  const { t } = useTranslation();
  const { queryService, vaultAdapter, fileTreeVersion } = useVault();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [text, setText] = useState("");
  const [folder, setFolder] = useState("");
  const [tag, setTag] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

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

  const allFolders = useMemo(() => {
    const s = new Set<string>();
    for (const tk of tasks) {
      const i = tk.path.lastIndexOf("/");
      if (i > 0) s.add(tk.path.slice(0, i));
    }
    return [...s].sort();
  }, [tasks]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const tk of tasks) for (const g of tk.tags) s.add(g);
    return [...s].sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return tasks.filter((tk) => {
      if (status === "open" && tk.done) return false;
      if (status === "done" && !tk.done) return false;
      if (folder && tk.path !== folder && !tk.path.startsWith(folder + "/")) return false;
      if (tag && !tk.tags.includes(tag)) return false;
      if (dueOnly && !tk.due) return false;
      if (q && !tk.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, status, folder, tag, dueOnly, text]);

  const groups = useMemo(() => {
    const m = new Map<string, { title: string; items: TaskRecord[] }>();
    for (const tk of filtered) {
      const g = m.get(tk.path);
      if (g) g.items.push(tk);
      else m.set(tk.path, { title: tk.title, items: [tk] });
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
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0.4rem 0" }}>
        {loading ? null : groups.length === 0 ? (
          <div style={{ color: "var(--text-muted)", padding: "2rem", textAlign: "center", fontSize: "0.9rem" }}>
            {t("tasks.empty", { defaultValue: "Keine Aufgaben" })}
          </div>
        ) : (
          groups.map(([path, group]) => (
            <div key={path}>
              <div
                onClick={() => onOpenPath(path, false)}
                title={path}
                style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", padding: "0.5rem 0.9rem 0.15rem", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {noteDisplayName(group.title)}
              </div>
              {group.items.map((task) => (
                <div key={task.ordinal} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "0.3rem 0.9rem" }}>
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
                    {task.text || t("tasks.empty", { defaultValue: "Keine Aufgaben" })}
                    {task.due ? (
                      <span style={{ marginLeft: 6, display: "inline-flex", alignItems: "center", gap: 2, fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        <CalendarClock size={12} /> {task.due}
                      </span>
                    ) : null}
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
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
