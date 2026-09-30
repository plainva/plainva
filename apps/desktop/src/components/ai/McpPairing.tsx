import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlugZap } from "lucide-react";
import { Button, Checkbox, ICON, Modal } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { listenQuietly, mcpAnswerPairing, topLevelFolders, type McpPairRequest } from "../../services/ai/mcpBridge";

/**
 * The pairing question (plan KI-Harness §17.3): an AI app on this computer
 * asks to read the vault. It names the app and the program that started it,
 * and the user picks the folders it may read — nothing is ticked by default,
 * so allowing needs a choice. Closing the dialog is a refusal; so is waiting
 * too long (the native side gives up after two minutes).
 */
export function McpPairing() {
  const { t } = useTranslation();
  const { queryService } = useVault();
  const [request, setRequest] = useState<McpPairRequest | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);

  useEffect(
    () =>
      listenQuietly<McpPairRequest>("mcp-pair", (payload) => {
        setChosen([]);
        setRequest(payload);
      }),
    [],
  );

  useEffect(() => {
    if (!request || !queryService) return;
    let alive = true;
    void queryService
      .getAllFolders()
      .catch(() => [] as string[])
      .then((all) => {
        if (alive) setFolders(topLevelFolders(all));
      });
    return () => {
      alive = false;
    };
  }, [request, queryService]);

  if (!request) return null;
  const whole = chosen.includes("");
  const toggle = (folder: string) => setChosen((list) => (list.includes(folder) ? list.filter((f) => f !== folder) : [...list, folder]));
  const answer = (allow: boolean) => {
    void mcpAnswerPairing(request.requestId, allow, allow ? (whole ? [""] : chosen) : []);
    setRequest(null);
  };

  return (
    <Modal
      title={t(request.known ? "ai.mcp.pairKnownTitle" : "ai.mcp.pairTitle", { client: request.client })}
      icon={<PlugZap size={ICON.ui} />}
      onClose={() => answer(false)}
      closeOnOverlay={false}
      testId="mcp-pairing"
      footer={
        <>
          <Button variant="ghost" onClick={() => answer(false)}>
            {t("ai.mcp.pairDeny")}
          </Button>
          <Button variant="primary" disabled={chosen.length === 0} onClick={() => answer(true)} data-testid="mcp-pair-allow">
            {t("ai.mcp.pairAllow")}
          </Button>
        </>
      }
    >
      <p className="pv-mcp-pair-body">{t("ai.mcp.pairBody", { program: request.program })}</p>
      <fieldset className="pv-mcp-pair-folders">
        <legend>{t("ai.mcp.pairFolders")}</legend>
        <Checkbox checked={whole} onChange={() => toggle("")}>
          {t("ai.mcp.pairWhole")}
        </Checkbox>
        {folders.map((folder) => (
          <Checkbox key={folder} checked={whole || chosen.includes(folder)} disabled={whole} onChange={() => toggle(folder)}>
            {folder}
          </Checkbox>
        ))}
      </fieldset>
      {chosen.length === 0 && <p className="pv-mcp-pair-hint">{t("ai.mcp.pairNone")}</p>}
    </Modal>
  );
}
