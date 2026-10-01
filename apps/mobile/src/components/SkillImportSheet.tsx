import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { SkillImport } from "@plainva/core";
import { Banner, Button, Checkbox, GroupCard, importFacts, Row, RowList, toast } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

/** The check of a picked skill on the phone before anything is written (plan KI-Harness P3-5) — the desktop's dialog as a sheet. */
export function SkillImportSheet({ label, imported, onClose }: { label: string; imported: SkillImport; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-skill-import-dialog">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("ai.workshop.importDialog.title")}</p>
        <p className="m-hint">{label}</p>
        {facts.blocked && <Banner kind="error">{[facts.blocked, ...facts.problems].join(" ")}</Banner>}
        {facts.ok && (
          <GroupCard>
            <RowList>
              <Row title={facts.ok} subtitle={facts.notes.join(" · ")} wrap />
            </RowList>
          </GroupCard>
        )}
        {facts.exists && (
          <Checkbox checked={replace} onChange={(event) => setReplace(event.target.checked)} data-testid="ai-skill-import-replace">
            {t("ai.workshop.importDialog.replace")}
          </Checkbox>
        )}
        {facts.lands && <p className="m-hint">{facts.lands}</p>}
        {error && <Banner kind="error">{error}</Banner>}
        {facts.ok && (
          <Button variant="primary" disabled={busy || (facts.exists && !replace)} onClick={() => void run()} data-testid="ai-skill-import-run">
            {t("ai.workshop.importDialog.importAndApprove")}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          {t("ai.workshop.form.cancel")}
        </Button>
      </div>
    </div>
  );
}
