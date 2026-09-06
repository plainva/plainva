import { useCallback, useEffect, useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { appendTaskLine, Checkbox, ICON, IconButton, listTaskLines, parseTaskProgress, TextInput, toast, toggleTaskAtIndex, type TaskLine } from "@plainva/ui";
import { vaultOps, type MobileVault } from "../../services/vaultService";

/**
 * The checklist on a board card, phone edition (issue #83, P4/E5) — the same
 * card the desktop has: the progress the index counted, unfolded the note's
 * own `- [ ]` lines with a checkbox each and a field for one more. Writes go
 * through the conflict-aware save and re-index the path; the caller re-queries
 * so the count on the card follows.
 */
export function CardChecklist({ vault, path, progress, onChanged }: { vault: MobileVault; path: string; progress: unknown; onChanged: () => void }) {
  const { t } = useTranslation();
  const parsed = parseTaskProgress(progress);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<TaskLine[] | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    try {
      setLines(listTaskLines(await vaultOps.read(vault, path)));
    } catch {
      setLines([]);
    }
  }, [vault, path]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const write = useCallback(
    async (mutate: (fresh: string) => string | null) => {
      try {
        const fresh = await vaultOps.read(vault, path);
        const next = mutate(fresh);
        if (next === null || next === fresh) return;
        await vaultOps.save(vault, path, next);
        await vault.indexer?.indexPath(path).catch(() => {});
        await load();
        onChanged();
      } catch (e: unknown) {
        toast.error(String((e as { message?: string })?.message ?? e));
      }
    },
    [vault, path, load, onChanged],
  );

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const shown = lines ?? [];
  const done = lines ? shown.filter((l) => l.done).length : (parsed?.done ?? 0);
  const total = lines ? shown.length : (parsed?.total ?? 0);
  if (!parsed && !open) return null;

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    void write((fresh) => appendTaskLine(fresh, text)).then(() => setDraft(""));
  };

  return (
    <div className="m-basecard-checklist" data-testid="board-card-checklist" onClick={stop} onPointerDown={stop}>
      <IconButton
        className="m-basecard-progress"
        label={t("database.checklistProgress", { done, total })}
        aria-expanded={open}
        data-testid="board-card-progress"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={ICON.ui} /> : <ChevronRight size={ICON.ui} />}
        <span aria-hidden className="m-basecard-progressbar">
          <i style={{ width: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%" }} />
        </span>
        <span className="m-basecard-progresstext">{total > 0 ? `${done}/${total}` : ""}</span>
      </IconButton>
      {open && (
        <>
          {shown.map((l) => (
            <Checkbox
              key={l.ordinal}
              className="m-basecard-checkline"
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
              <span className={l.done ? "is-done" : undefined}>{l.text}</span>
            </Checkbox>
          ))}
          <div className="m-basecard-checkadd">
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
                submit();
              }}
            />
            <IconButton label={t("database.checklistAdd")} disabled={!draft.trim()} onClick={submit}>
              <Plus size={ICON.ui} />
            </IconButton>
          </div>
        </>
      )}
    </div>
  );
}
