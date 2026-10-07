import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Banner, Button, ICON, Modal, problemText, TextArea, TextInput, toast, useAiSession } from "@plainva/ui";

/**
 * A new skill from three fields (plan KI-Harness P3-5): a name that becomes
 * its folder, a description the AI chooses it by, and the instructions. It is
 * written as `.agent/skills/<name>/SKILL.md` in the Agent Skills format and
 * approved on this device with exactly what was written — the user wrote it
 * here. Further edits open the file; each then asks for an approval again.
 */
export function NewSkillModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const session = useAiSession();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  const create = async () => {
    setBusy(true);
    const result = await session.createSkill({ name, description, body });
    setBusy(false);
    if (result.ok) {
      toast.success(t("ai.workshop.created", { path: result.path }));
      onClose();
    } else if (result.reason === "exists") setError(t("ai.workshop.form.nameTaken"));
    else if (result.reason === "invalid") setError(t("ai.workshop.form.invalid", { problems: (result.problems ?? []).map((p) => problemText(t, p)).join(" ") }));
    else setError(t("ai.workshop.writeFailed"));
  };
  return (
    <Modal
      title={t("ai.workshop.form.title")}
      icon={<Plus size={ICON.ui} />}
      size="md"
      onClose={onClose}
      testId="ai-skill-new-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("ai.workshop.form.cancel")}
          </Button>
          <Button variant="primary" disabled={busy || !name.trim() || !description.trim() || !body.trim()} onClick={() => void create()} data-testid="ai-skill-create">
            {t("ai.workshop.form.create")}
          </Button>
        </>
      }
    >
      <label className="pv-modal-label" htmlFor="pv-skill-name">
        {t("ai.workshop.form.name")}
      </label>
      <TextInput id="pv-skill-name" value={name} onChange={(event) => setName(event.target.value.toLowerCase())} data-testid="ai-skill-name" />
      <p className="pv-modal-hint">{t("ai.workshop.form.nameHint")}</p>
      <label className="pv-modal-label" htmlFor="pv-skill-description">
        {t("ai.workshop.form.description")}
      </label>
      <TextArea id="pv-skill-description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} data-testid="ai-skill-description" />
      <p className="pv-modal-hint">{t("ai.workshop.form.descriptionHint")}</p>
      <label className="pv-modal-label" htmlFor="pv-skill-body">
        {t("ai.workshop.form.body")}
      </label>
      <TextArea id="pv-skill-body" rows={10} value={body} onChange={(event) => setBody(event.target.value)} data-testid="ai-skill-body" />
      <p className="pv-modal-hint">{t("ai.workshop.form.bodyHint")}</p>
      {error && (
        <Banner kind="error" rounded>
          {error}
        </Banner>
      )}
    </Modal>
  );
}
