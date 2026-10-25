import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2 } from "lucide-react";
import { Banner, Button, ICON, Modal, serverSkillAddText, TextInput, toast, useAiSession } from "@plainva/ui";

/**
 * A skill of a connected server by its address (plan KI-Harness P9-4b, MCP
 * skills extension): for one the server serves without listing it. Plainva
 * asks the server for its entry (`skills/get`) — nothing of its files — and
 * the skill then waits for its approval like any other; the address is kept
 * with the server on this device.
 */
export function ServerSkillAddModal({ serverId, label, onClose }: { serverId: string; label: string; onClose: () => void }) {
  const { t } = useTranslation();
  const session = useAiSession();
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!session) return null;
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
    <Modal
      title={t("ai.workshop.server.addTitle", { server: label })}
      icon={<Link2 size={ICON.ui} />}
      size="md"
      onClose={onClose}
      testId="ai-server-skill-add-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={busy || !address.trim()} onClick={() => void add()} data-testid="ai-server-skill-add-load">
            {t("ai.workshop.server.addLoad")}
          </Button>
        </>
      }
    >
      {problem && (
        <Banner kind="error" rounded testId="ai-server-skill-add-problem">
          {problem}
        </Banner>
      )}
      <label className="pv-modal-label" htmlFor="pv-server-skill-address">
        {t("ai.workshop.server.addLabel")}
      </label>
      <TextInput
        id="pv-server-skill-address"
        value={address}
        autoCapitalize="off"
        onChange={(event) => {
          setAddress(event.target.value);
          setProblem(null);
        }}
        data-testid="ai-server-skill-address"
      />
      <p className="pv-modal-hint">{t("ai.workshop.server.addHint")}</p>
    </Modal>
  );
}
