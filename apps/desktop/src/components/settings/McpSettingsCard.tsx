import { Fragment, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Package, Trash2 } from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Button, ICON, IconButton, SettingCard, SettingCardNote, SettingRow, Switch, toast, type AiSession } from "@plainva/ui";
import { appConfirm } from "../../services/appDialogs";
import { claudeCodeCommand, mcpClientConfig, mcpRevoke, mcpSetWrites, mcpStatus, mcpWritePackage, type McpAuditEntry, type McpStatus } from "../../services/ai/mcpBridge";

/**
 * Settings → AI & automation → "AI apps on this computer" (plan KI-Harness
 * §17.3): the switch that opens the private channel, how to set a client up,
 * the apps that were allowed (with their folders in the vault open now, and
 * — stage 2 — whether each may propose changes there) and what they asked
 * for lately. Desktop only (parity catalog `mcp-server`).
 */
export function McpSettingsCard({ session, enabled }: { session: AiSession; enabled: boolean }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<McpStatus | null>(null);

  const refresh = useCallback(() => {
    void mcpStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh, enabled]);

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success(t("ai.mcp.copied")));
  };
  const writePackage = async () => {
    const target = await saveDialog({ defaultPath: "plainva.mcpb", filters: [{ name: "MCP Bundle", extensions: ["mcpb"] }] });
    if (!target) return;
    try {
      await mcpWritePackage(target);
      toast.success(t("ai.mcp.packageDone"));
    } catch (error) {
      toast.error(t("ai.mcp.packageFailed", { message: String(error) }));
    }
  };
  const revoke = (id: string, name: string) => {
    void appConfirm({ title: t("ai.mcp.revokeConfirm", { client: name }), message: t("ai.mcp.revokeBody"), confirmLabel: t("ai.mcp.revoke") }).then((ok) => {
      if (ok) void mcpRevoke(id).then(refresh);
    });
  };
  const setWrites = (id: string, name: string, on: boolean) => {
    void mcpSetWrites(id, on)
      .then(() => {
        // It holds from the app's next request on; the tools it lists are the ones of its connection.
        if (on) toast.info(t("ai.mcp.writesOnToast", { client: name }));
      })
      .catch(() => undefined)
      .then(refresh);
  };
  /** What became of a request, in the record's own fixed words: a plan that waits, a no, or a refusal. */
  const auditOutcome = (entry: McpAuditEntry) =>
    entry.note === "asked" ? ` · ${t("ai.mcp.auditAsked")}` : entry.note === "declined" ? ` · ${t("ai.mcp.auditDeclined")}` : entry.ok ? "" : ` · ${t("ai.mcp.refused")}`;
  const folderText = (folders: string[]) =>
    folders.length === 0 ? t("ai.mcp.noFolders") : folders.map((f) => (f === "" ? t("ai.mcp.wholeVault") : f)).join(", ");
  const when = (at: string) => {
    const secs = Number(at);
    return Number.isFinite(secs) && secs > 0 ? new Date(secs * 1000).toLocaleString() : "—";
  };
  const helper = status?.helperPath ?? null;

  return (
    <SettingCard label={t("ai.mcp.title")}>
      <SettingRow label={t("ai.mcp.switch")} desc={t("ai.mcp.switchDesc")}>
        <Switch
          checked={enabled}
          label={t("ai.mcp.switch")}
          onChange={(on) => void session.updateSettings((s) => ({ ...s, mcpEnabled: on }))}
          data-testid="mcp-switch"
        />
      </SettingRow>
      {enabled && (
        <>
          {helper ? (
            <>
              <SettingRow label={t("ai.mcp.claudeCode")} desc={claudeCodeCommand(helper, status!.identifier)}>
                <IconButton label={t("ai.mcp.copy")} onClick={() => copy(claudeCodeCommand(helper, status!.identifier))}>
                  <Copy size={ICON.ui} />
                </IconButton>
              </SettingRow>
              <SettingRow label={t("ai.mcp.otherApps")} desc={t("ai.mcp.otherAppsDesc")}>
                <IconButton label={t("ai.mcp.copy")} onClick={() => copy(mcpClientConfig(helper, status!.identifier))}>
                  <Copy size={ICON.ui} />
                </IconButton>
              </SettingRow>
              <SettingRow label={t("ai.mcp.package")} desc={t("ai.mcp.packageDesc")}>
                <Button size="sm" variant="secondary" icon={<Package size={ICON.ui} />} onClick={() => void writePackage()}>
                  {t("ai.mcp.packageAction")}
                </Button>
              </SettingRow>
            </>
          ) : (
            <SettingCardNote>{t("ai.mcp.helperMissing")}</SettingCardNote>
          )}
          {(status?.clients ?? []).length === 0 ? (
            <SettingCardNote>{t("ai.mcp.noClients")}</SettingCardNote>
          ) : (
            status!.clients.map((client) => (
              <Fragment key={client.id}>
                <SettingRow label={client.name} desc={`${t("ai.mcp.folders", { folders: folderText(client.folders) })} · ${t("ai.mcp.lastSeen", { when: when(client.lastSeen) })}`}>
                  <IconButton label={t("ai.mcp.revokeLabel", { client: client.name })} onClick={() => revoke(client.id, client.name)}>
                    <Trash2 size={ICON.ui} />
                  </IconButton>
                </SettingRow>
                {/* Stage 2: proposing changes is its own grant, per app and vault — and only where the app reads at all. */}
                {client.folders.length > 0 && (
                  <SettingRow label={t("ai.mcp.writesRow", { client: client.name })} desc={t(client.writes ? "ai.mcp.writesOn" : "ai.mcp.writesOff", { client: client.name })}>
                    <Switch checked={client.writes} label={t("ai.mcp.writesRow", { client: client.name })} onChange={(on) => setWrites(client.id, client.name, on)} data-testid="mcp-writes-switch" />
                  </SettingRow>
                )}
              </Fragment>
            ))
          )}
          <SettingCardNote>
            {status && status.audit.length > 0 ? (
              <ul className="pv-mcp-audit" aria-label={t("ai.mcp.audit")}>
                {status.audit.slice(0, 8).map((a, i) => (
                  <li key={`${a.at}-${i}`}>
                    {when(a.at)} · {a.client} · {t(`ai.tool.${a.tool}`, { defaultValue: a.tool })}
                    {auditOutcome(a)}
                  </li>
                ))}
              </ul>
            ) : (
              t("ai.mcp.auditNone")
            )}
          </SettingCardNote>
        </>
      )}
    </SettingCard>
  );
}
