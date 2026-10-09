import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, TextArea, useMemoryRuleForm } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

/**
 * A rule for assistants on the phone (plan KI-Harness P6) — the desktop's
 * dialog as a sheet: one line for the vault's standing instructions. Written
 * here, it is approved here; the user's other devices ask.
 */
export function MemoryRuleSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  const [busy, setBusy] = useState(false);
  const form = useMemoryRuleForm(session);
  if (!form) return null;
  const save = async () => {
    setBusy(true);
    const done = await form.save();
    setBusy(false);
    if (done) onClose();
  };
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-memory-rule-dialog">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("ai.memory.rules.formTitle")}</p>
        <TextArea rows={3} value={form.text} placeholder={t("ai.memory.rules.text")} aria-label={t("ai.memory.rules.text")} onChange={(event) => form.setText(event.target.value)} data-testid="ai-memory-rule-text" />
        <p className="m-hint">
          {t("ai.memory.rules.hint")} {form.count}
        </p>
        {form.error && <Banner kind="error">{form.error}</Banner>}
        <Button variant="primary" disabled={busy || !form.ready} onClick={() => void save()} data-testid="ai-memory-rule-save">
          {t("ai.memory.rules.create")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("ai.memory.form.cancel")}
        </Button>
      </div>
    </div>
  );
}
