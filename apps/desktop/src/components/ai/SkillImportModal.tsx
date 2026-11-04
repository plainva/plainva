import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import type { SkillImport } from "@plainva/core";
import { Banner, Button, Checkbox, ICON, importFacts, Modal, toast, useAiSession, useAiState } from "@plainva/ui";

/**
 * The check of a picked skill before anything is written (plan KI-Harness
 * P3-5, §14.3 "import only after a check of its origin"): one skill in the
 * format, its licence and size, what Plainva will not run or does not have,
 * where it lands. Imported, it is approved on this device with exactly this
 * content; an own skill of the same name is replaced only when asked.
 */
export function SkillImportModal({ label, imported, onClose }: { label: string; imported: SkillImport; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!session || !state) return null;
  const existing = state.skills.entries.some((e) => e.source.origin === "vault" && e.source.id === `.agent/skills/${imported.name}`);
  const facts = importFacts(t, imported, existing, i18n.language);
  const run = async () => {
    setBusy(true);
    const result = await session.importSkill(imported, { label, sha256: imported.contentHash }, replace);
    setBusy(false);
    if (result.ok) {
      toast.success(t("ai.workshop.imported"));
      onClose();
    } else if (result.reason === "exists") setError(t("ai.workshop.importDialog.exists"));
    else setError(t("ai.workshop.writeFailed"));
  };
  return (
    <Modal
      title={t("ai.workshop.importDialog.title")}
      icon={<Download size={ICON.ui} />}
      headerNote={label}
      size="md"
      onClose={onClose}
      testId="ai-skill-import-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("ai.workshop.form.cancel")}
          </Button>
          {facts.ok && (
            <Button variant="primary" disabled={busy || (facts.exists && !replace)} onClick={() => void run()} data-testid="ai-skill-import-run">
              {t("ai.workshop.importDialog.importAndApprove")}
            </Button>
          )}
        </>
      }
    >
      {facts.blocked && (
        <Banner kind="error" rounded>
          {[facts.blocked, ...facts.problems].join(" ")}
        </Banner>
      )}
      {facts.ok && (
        <dl className="pv-skill-facts">
          <dt>{t("ai.workshop.importDialog.file")}</dt>
          <dd>
            <span>{facts.ok}</span>
            {facts.notes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </dd>
        </dl>
      )}
      {facts.exists && (
        <Checkbox checked={replace} onChange={(event) => setReplace(event.target.checked)} data-testid="ai-skill-import-replace">
          {t("ai.workshop.importDialog.replace")}
        </Checkbox>
      )}
      {facts.lands && <p className="pv-modal-hint">{facts.lands}</p>}
      {error && (
        <Banner kind="error" rounded>
          {error}
        </Banner>
      )}
    </Modal>
  );
}
