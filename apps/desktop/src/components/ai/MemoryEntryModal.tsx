import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookMarked } from "lucide-react";
import type { MemoryPlace } from "@plainva/core";
import { Banner, Button, Checkbox, ICON, Modal, Segmented, TextArea, useAiSession, useAiState, useMemoryEntryForm } from "@plainva/ui";

/**
 * One entry of the memory, new or reworded (plan KI-Harness P6, mockup
 * chapter 22, step 2): a sentence, when it is with a conversation, and whom
 * it is for. What the fields hold and when they may be saved is the phone's
 * as well (`useMemoryEntryForm`); written is what the session makes of them —
 * one line in one of the two files.
 */
export function MemoryEntryModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const [busy, setBusy] = useState(false);
  const form = useMemoryEntryForm(session, state?.memory ?? null, id);
  if (!form) return null;
  const number = new Intl.NumberFormat(i18n.language);
  const save = async () => {
    setBusy(true);
    const done = await form.save();
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Modal
      title={t(form.editing ? "ai.memory.form.titleEdit" : "ai.memory.form.titleNew")}
      icon={<BookMarked size={ICON.ui} />}
      size="md"
      onClose={onClose}
      testId="ai-memory-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("ai.memory.form.cancel")}
          </Button>
          <Button variant="primary" disabled={busy || !form.ready} onClick={() => void save()} data-testid="ai-memory-save">
            {t(form.editing ? "ai.memory.form.save" : "ai.memory.form.create")}
          </Button>
        </>
      }
    >
      {/* A column of fields, each a label over its control over its hint — the form grid the script form uses. */}
      <div className="pv-script-form">
        <div className="pv-script-field">
          <label className="pv-modal-label" htmlFor="pv-memory-text">
            {t("ai.memory.form.text")}
          </label>
          <TextArea id="pv-memory-text" rows={3} value={form.text} onChange={(event) => form.setText(event.target.value)} data-testid="ai-memory-text" />
          <p className="pv-modal-hint">
            {t("ai.memory.form.textHint")} {form.count}
          </p>
        </div>
        {!form.editing && (
          <div className="pv-script-field">
            <span className="pv-modal-label">{t("ai.memory.form.when")}</span>
            {/* The control keeps its own width: a field's grid would stretch it across the dialog. */}
            <div>
              <Segmented<MemoryPlace>
                ariaLabel={t("ai.memory.form.when")}
                value={form.place}
                onChange={form.setPlace}
                options={[
                  { value: "active", label: t("ai.memory.active"), testId: "ai-memory-place-active" },
                  { value: "long", label: t("ai.memory.long"), testId: "ai-memory-place-long" },
                ]}
              />
            </div>
            <p className="pv-modal-hint">{form.place === "active" ? t("ai.memory.form.whenActive", { left: number.format(form.left) }) : t("ai.memory.form.whenLong")}</p>
          </div>
        )}
        <div className="pv-script-field">
          <span className="pv-modal-label">{t("ai.memory.form.whom")}</span>
          <Checkbox checked={form.local || form.locked} disabled={form.locked} onChange={(event) => form.setLocal(event.target.checked)} data-testid="ai-memory-local">
            {t("ai.memory.form.local")}
          </Checkbox>
        </div>
        {form.locked && (
          <Banner kind="warning" rounded>
            {t("ai.memory.form.locked")}
          </Banner>
        )}
        {form.overBudget && (
          <Banner kind="warning" rounded testId="ai-memory-over">
            {t("ai.memory.form.over")}
          </Banner>
        )}
        {form.error && (
          <Banner kind="error" rounded>
            {form.error}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
