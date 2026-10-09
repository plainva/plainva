import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { MemoryPlace } from "@plainva/core";
import { Banner, Button, Checkbox, Segmented, TextArea, useMemoryEntryForm } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

/**
 * One entry of the memory on the phone, new or reworded (plan KI-Harness P6,
 * mockup chapter 22) — the desktop's dialog as a sheet. What the fields hold
 * and when they may be saved is shared (`useMemoryEntryForm`).
 */
export function MemoryEntrySheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [busy, setBusy] = useState(false);
  const form = useMemoryEntryForm(session, state.memory, id);
  if (!form) return null;
  const number = new Intl.NumberFormat(i18n.language);
  const save = async () => {
    setBusy(true);
    const done = await form.save();
    setBusy(false);
    if (done) onClose();
  };
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-memory-dialog">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t(form.editing ? "ai.memory.form.titleEdit" : "ai.memory.form.titleNew")}</p>
        <TextArea rows={3} value={form.text} placeholder={t("ai.memory.form.text")} aria-label={t("ai.memory.form.text")} onChange={(event) => form.setText(event.target.value)} data-testid="ai-memory-text" />
        <p className="m-hint">
          {t("ai.memory.form.textHint")} {form.count}
        </p>
        {!form.editing && (
          <>
            <Segmented<MemoryPlace>
              ariaLabel={t("ai.memory.form.when")}
              value={form.place}
              onChange={form.setPlace}
              options={[
                { value: "active", label: t("ai.memory.active"), testId: "ai-memory-place-active" },
                { value: "long", label: t("ai.memory.long"), testId: "ai-memory-place-long" },
              ]}
            />
            <p className="m-hint">{form.place === "active" ? t("ai.memory.form.whenActive", { left: number.format(form.left) }) : t("ai.memory.form.whenLong")}</p>
          </>
        )}
        <Checkbox checked={form.local || form.locked} disabled={form.locked} onChange={(event) => form.setLocal(event.target.checked)} data-testid="ai-memory-local">
          {t("ai.memory.form.local")}
        </Checkbox>
        {form.locked && <Banner kind="warning">{t("ai.memory.form.locked")}</Banner>}
        {form.overBudget && (
          <Banner kind="warning" testId="ai-memory-over">
            {t("ai.memory.form.over")}
          </Banner>
        )}
        {form.error && <Banner kind="error">{form.error}</Banner>}
        <Button variant="primary" disabled={busy || !form.ready} onClick={() => void save()} data-testid="ai-memory-save">
          {t(form.editing ? "ai.memory.form.save" : "ai.memory.form.create")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("ai.memory.form.cancel")}
        </Button>
      </div>
    </div>
  );
}
