import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, problemText, TextArea, TextInput, toast } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

/** A new skill from three fields on the phone (plan KI-Harness P3-5) — the desktop's dialog as a sheet. */
export function NewSkillSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-skill-new-dialog">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("ai.workshop.form.title")}</p>
        <TextInput value={name} autoCapitalize="none" placeholder={t("ai.workshop.form.name")} aria-label={t("ai.workshop.form.name")} onChange={(event) => setName(event.target.value.toLowerCase())} data-testid="ai-skill-name" />
        <p className="m-hint">{t("ai.workshop.form.nameHint")}</p>
        <TextArea rows={3} value={description} placeholder={t("ai.workshop.form.description")} aria-label={t("ai.workshop.form.description")} onChange={(event) => setDescription(event.target.value)} data-testid="ai-skill-description" />
        <p className="m-hint">{t("ai.workshop.form.descriptionHint")}</p>
        <TextArea rows={8} value={body} placeholder={t("ai.workshop.form.body")} aria-label={t("ai.workshop.form.body")} onChange={(event) => setBody(event.target.value)} data-testid="ai-skill-body" />
        <p className="m-hint">{t("ai.workshop.form.bodyHint")}</p>
        {error && <Banner kind="error">{error}</Banner>}
        <Button variant="primary" disabled={busy || !name.trim() || !description.trim() || !body.trim()} onClick={() => void create()} data-testid="ai-skill-create">
          {t("ai.workshop.form.create")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("ai.workshop.form.cancel")}
        </Button>
      </div>
    </div>
  );
}
