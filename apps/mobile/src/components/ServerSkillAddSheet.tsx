import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, serverSkillAddText, TextInput, toast } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

/**
 * A skill of a connected server by its address, on the phone (plan
 * KI-Harness P9-4b): the desktop's dialog as a sheet. Plainva asks the
 * server for the skill's entry — nothing of its files —, and the skill then
 * waits for its approval like any other.
 */
export function ServerSkillAddSheet({ serverId, label, onClose }: { serverId: string; label: string; onClose: () => void }) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    const result = await session.addServerSkill(serverId, address);
    setBusy(false);
    const text = serverSkillAddText(t, result);
    if (text === null) {
      toast.success(t("ai.workshop.server.added"));
      onClose();
    } else setProblem(text);
  };
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-server-skill-add-dialog">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("ai.workshop.server.addTitle", { server: label })}</p>
        <TextInput
          value={address}
          autoCapitalize="none"
          inputMode="url"
          placeholder={t("ai.workshop.server.addLabel")}
          aria-label={t("ai.workshop.server.addLabel")}
          onChange={(event) => {
            setAddress(event.target.value);
            setProblem(null);
          }}
          data-testid="ai-server-skill-address"
        />
        <p className="m-hint">{t("ai.workshop.server.addHint")}</p>
        {problem && (
          <Banner kind="error" testId="ai-server-skill-add-problem">
            {problem}
          </Banner>
        )}
        <Button variant="primary" disabled={busy || !address.trim()} onClick={() => void add()} data-testid="ai-server-skill-add-load">
          {t("ai.workshop.server.addLoad")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
