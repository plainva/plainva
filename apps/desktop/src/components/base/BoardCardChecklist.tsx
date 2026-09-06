import { useCallback, useEffect, useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { appendTaskLine, Button, Checkbox, ICON, listTaskLines, parseTaskProgress, TextInput, toast, toggleTaskAtIndex, type TaskLine } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { applyIndexChanges } from "../../services/fileActions";

/**
 * The checklist on a board card (issue #83, plan Issue-Durchsicht 2026-09-06,
 * P4/E5): the note's own `- [ ]` lines. Folded, the card shows the progress
 * the index counted (`file.tasks`); unfolded, the lines with a checkbox each
 * and a field for one more. A tick flips exactly its line through the shared
 * toggle, a new line lands after the last checkbox — both write through the
 * adapter chain and re-index the path, the pinboard's pattern. Editing the
 * wording of a sub-task is what opening the note is for.
 *
 * Every pointer event stops here: the card underneath is a drag handle and a
 * link, and a tick must be neither.
 */
export function BoardCardChecklist({ path, progress }: { path: string; progress: unknown }) {
  const { t } = useTranslation();
  const { vaultAdapter, indexer } = useVault();
  const parsed = parseTaskProgress(progress);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<TaskLine[] | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    if (!vaultAdapter) return;
    try {
      setLines(listTaskLines(await vaultAdapter.readTextFile(path)));
    } catch {
      setLines([]);
    }
  }, [vaultAdapter, path]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // The note may change under the card (the editor, another card): re-read.
  useEffect(() => {
    if (!open) return;
    const onSaved = (e: Event) => {
      if ((e as CustomEvent<{ path?: string }>).detail?.path === path) void load();
    };
    window.addEventListener("plainva-note-saved", onSaved);
    return () => window.removeEventListener("plainva-note-saved", onSaved);
  }, [open, path, load]);

  const write = useCallback(
    async (mutate: (fresh: string) => string | null) => {
      if (!vaultAdapter) return;
      try {
        const fresh = await vaultAdapter.readTextFile(path);
        const next = mutate(fresh);
        if (next === null || next === fresh) return;
        await vaultAdapter.writeTextFile(path, next);
        if (indexer) await applyIndexChanges(indexer, { added: [path] }).catch(() => {});
        window.dispatchEvent(new CustomEvent("plainva-note-saved", { detail: { path } }));
        await load();
      } catch (e: unknown) {
        toast.error(String((e as { message?: string })?.message ?? e));
      }
    },
    [vaultAdapter, indexer, path, load],
  );

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const shown = lines ?? [];
  const done = lines ? shown.filter((l) => l.done).length : parsed?.done ?? 0;
  const total = lines ? shown.length : parsed?.total ?? 0;
  if (!parsed && !open) return null;

  return (
    <div data-testid="board-card-checklist" onClick={stop} onPointerDown={stop} onKeyDown={stop} style={{ display: "grid", gap: "var(--space-1)" }}>
      <Button
        variant="ghost"
        size="sm"
        data-testid="board-card-progress"
        aria-expanded={open}
        aria-label={t("database.checklistProgress", { done, total })}
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", justifyContent: "flex-start", gap: "var(--space-2)", padding: 0 }}
      >
        {open ? <ChevronDown size={ICON.ui} /> : <ChevronRight size={ICON.ui} />}
        <span aria-hidden style={{ flex: 1, height: 4, borderRadius: "var(--radius-pill)", background: "var(--bg-hover)", overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%", background: done === total && total > 0 ? "var(--success-text, var(--accent-color))" : "var(--accent-color)" }} />
        </span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{total > 0 ? `${done}/${total}` : ""}</span>
      </Button>
      {open && (
        <div style={{ display: "grid", gap: "var(--space-1)", paddingLeft: "var(--space-2)" }}>
          {shown.map((l) => (
            <Checkbox
              key={l.ordinal}
              checked={l.done}
              data-testid={`board-card-task-${l.ordinal}`}
              onChange={(e) => {
                // Read the box NOW: the write awaits the file first, and by then
                // React has reset the controlled box to the old value — read late,
                // the toggle saw "unchanged" and never wrote (E2E finding 2026-09-06).
                const checked = e.target.checked;
                void write((fresh) => { const r = toggleTaskAtIndex(fresh, l.ordinal, checked); return r.changed ? r.content : null; });
              }}
            >
              <span style={{ fontSize: "var(--text-sm)", color: l.done ? "var(--text-faint)" : "var(--text-main)", textDecoration: l.done ? "line-through" : "none", overflowWrap: "anywhere" }}>{l.text}</span>
            </Checkbox>
          ))}
          <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
            <TextInput
              compact
              value={draft}
              placeholder={t("database.checklistAddPlaceholder")}
              aria-label={t("database.checklistAdd")}
              data-testid="board-card-task-add"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const text = draft.trim();
                if (!text) return;
                void write((fresh) => appendTaskLine(fresh, text)).then(() => setDraft(""));
              }}
              style={{ flex: 1 }}
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("database.checklistAdd")}
              data-tip={t("database.checklistAdd")}
              disabled={!draft.trim()}
              onClick={() => {
                const text = draft.trim();
                if (!text) return;
                void write((fresh) => appendTaskLine(fresh, text)).then(() => setDraft(""));
              }}
            >
              <Plus size={ICON.ui} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
