import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { mcpServerStanding } from "@plainva/core";
import { Button, externalStatusText, ICON, SettingCard, SettingCardNote, SettingRow, Switch } from "@plainva/ui";
import { getDesktopAiSession } from "../../services/ai/desktopAi";
import { ExternalAddDialog, ExternalReviewDialog } from "./ExternalToolsDialogs";

const NOOP = () => () => {};
const NONE = () => null;

/**
 * External tools for this vault (plan KI-Harness P4.5): the servers this
 * device knows — a server is added and its texts are approved once per
 * device — and, per server, whether this vault uses it. A server nobody
 * looked at yet, or whose texts changed, offers nothing: its row leads to
 * the review instead of a switch.
 */
export function ExternalToolsCard() {
  const { t } = useTranslation();
  const session = getDesktopAiSession();
  const state = useSyncExternalStore(session ? session.subscribe : NOOP, session ? session.getState : NONE, session ? session.getState : NONE);
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  useEffect(() => {
    void session?.mcp.refresh();
  }, [session]);
  if (!session || !state || !state.mcp.available || !state.mcp.loaded) return null;
  const servers = state.mcp.servers;
  return (
    <>
      <SettingCard label={t("ai.ext.title")}>
        <SettingCardNote>{t("ai.ext.desc")}</SettingCardNote>
        {/* Fully local (plan P7): no server is asked or called. */}
        {state.settings.localOnly && <SettingCardNote>{t("ai.mode.restsHere")}</SettingCardNote>}
        {servers.length === 0 && <SettingCardNote>{t("ai.ext.none")}</SettingCardNote>}
        {servers.map((server) => {
          const standing = mcpServerStanding(server);
          const usable = standing === "ready" || standing === "off";
          return (
            <SettingRow key={server.id} label={server.label} desc={externalStatusText(t, server)}>
              <div className="pv-ai-rowactions">
                <Button size="sm" variant={usable ? "ghost" : "tonal"} onClick={() => setReviewing(server.id)} data-testid="settings-ai-ext-open">
                  {usable ? t("ai.ext.details") : t("ai.ext.reviewAction")}
                </Button>
                {usable && <Switch checked={server.enabled} label={t("ai.ext.use", { server: server.label })} onChange={(enabled) => void session.mcp.setVault(server.id, { enabled })} />}
              </div>
            </SettingRow>
          );
        })}
        <SettingRow label={t("ai.ext.device")} desc={t("ai.ext.deviceDesc")}>
          <Button size="sm" variant="secondary" icon={<Plus size={ICON.ui} />} onClick={() => setAdding(true)} data-testid="settings-ai-ext-add">
            {t("ai.ext.addAction")}
          </Button>
        </SettingRow>
      </SettingCard>
      {adding && (
        <ExternalAddDialog
          session={session}
          programs={state.mcp.programs}
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            setReviewing(id);
          }}
        />
      )}
      {reviewing && <ExternalReviewDialog session={session} servers={servers} serverId={reviewing} onClose={() => setReviewing(null)} />}
    </>
  );
}
