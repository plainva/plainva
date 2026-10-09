import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollText } from "lucide-react";
import { Banner, Button, ICON, Modal, TextArea, useAiSession, useMemoryRuleForm } from "@plainva/ui";

/**
 * A rule for assistants (plan KI-Harness P6): one line for the vault's
 * standing instructions. What an assistant should always do is no memory —
 * it is an instruction, stands in `AGENTS.md`, and counts on a device only
 * once that device approved the file. Written here, it is approved here; the
 * user's other devices ask.
 */
export function MemoryRuleModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const session = useAiSession();
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
    <Modal
      title={t("ai.memory.rules.formTitle")}
      icon={<ScrollText size={ICON.ui} />}
      size="md"
      onClose={onClose}
      testId="ai-memory-rule-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("ai.memory.form.cancel")}
          </Button>
          <Button variant="primary" disabled={busy || !form.ready} onClick={() => void save()} data-testid="ai-memory-rule-save">
            {t("ai.memory.rules.create")}
          </Button>
        </>
      }
    >
      {/* The form grid the script form uses: a label over its control over its hint. */}
      <div className="pv-script-form">
        <div className="pv-script-field">
          <label className="pv-modal-label" htmlFor="pv-memory-rule">
            {t("ai.memory.rules.text")}
          </label>
          <TextArea id="pv-memory-rule" rows={3} value={form.text} onChange={(event) => form.setText(event.target.value)} data-testid="ai-memory-rule-text" />
          <p className="pv-modal-hint">
            {t("ai.memory.rules.hint")} {form.count}
          </p>
        </div>
        {form.error && (
          <Banner kind="error" rounded>
            {form.error}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
