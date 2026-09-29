import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Plus } from "lucide-react";
import { AI_PROFILE_IDS, type AiProfileId, type ProviderInfo } from "@plainva/core";
import {
  Button,
  configuredProviders,
  getPlatformServices,
  HISTORY_DAY_CHOICES,
  ICON,
  IconButton,
  MenuItem,
  MenuSeparator,
  MenuSurface,
  providerStatus,
  Select,
  SettingCard,
  SettingCardNote,
  SettingRow,
  Switch,
  useAiState,
  AiSessionContext,
  type AiSession,
} from "@plainva/ui";
import { appConfirm } from "../../services/appDialogs";
import { getDesktopAiSession } from "../../services/ai/desktopAi";
import { AreaHead } from "./AppPages";
import { AiAddProviderDialog, AiKeyDialog, AiModelDialog } from "./AiDialogs";
import { McpSettingsCard } from "./McpSettingsCard";

/**
 * Settings → AI & automation, APP world (plan KI-Harness §19.1): what holds
 * for Plainva on this device in every vault — the per-device switch, the
 * providers and their keys, the profiles, the history. Nothing here is synced.
 */
export function AiSettingsPage() {
  const session = getDesktopAiSession();
  if (!session) return null;
  return (
    <AiSessionContext.Provider value={session}>
      <AiSettingsBody session={session} />
    </AiSessionContext.Provider>
  );
}

function AiSettingsBody({ session }: { session: AiSession }) {
  const { t, i18n } = useTranslation();
  const state = useAiState();
  const [adding, setAdding] = useState(false);
  const [keyFor, setKeyFor] = useState<ProviderInfo | null>(null);
  const [modelFor, setModelFor] = useState<AiProfileId | null>(null);
  const [menu, setMenu] = useState<{ provider: ProviderInfo; at: { x: number; y: number } } | null>(null);
  const [usage, setUsage] = useState<Awaited<ReturnType<AiSession["usage"]>>>([]);
  const number = new Intl.NumberFormat(i18n.language);
  const money = new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

  const summaries = state?.summaries;
  useEffect(() => {
    let alive = true;
    void session.usage(new Date().toISOString().slice(0, 7)).then((rows) => {
      if (alive) setUsage(rows);
    });
    return () => {
      alive = false;
    };
  }, [session, summaries]);

  if (!state?.loaded) return null;
  const settings = state.settings;
  const rows = configuredProviders(state);
  const profileLine = (id: AiProfileId) => {
    const choice = settings.profiles[id];
    if (!choice) return t("ai.settings.profileEmpty");
    return `${session.providers().find((p) => p.id === choice.providerId)?.label ?? choice.providerId} · ${choice.model}`;
  };

  return (
    <div className="pv-setpage" data-testid="settings-ai">
      <AreaHead areaId="ai" />

      <SettingCard label={t("ai.settings.betaTitle")}>
        <SettingRow label={t("ai.settings.betaSwitch")} desc={t("ai.settings.betaDesc")}>
          <Switch checked={settings.enabled} label={t("ai.settings.betaSwitch")} onChange={(on) => void session.updateSettings((s) => ({ ...s, enabled: on }))} data-testid="ai-beta-switch" />
        </SettingRow>
        <SettingCardNote>{t("ai.settings.experimental")}</SettingCardNote>
      </SettingCard>

      <SettingCard label={t("ai.settings.providers")}>
        {rows.map((row) => (
          <SettingRow key={row.provider.id} label={row.provider.label} desc={providerStatus(t, row)}>
            <div className="pv-ai-rowactions">
              <Button size="sm" variant="secondary" disabled={row.test?.state === "testing" || (row.needsKey && !row.hasKey)} onClick={() => void session.testProvider(row.provider.id)} data-testid={`ai-test-${row.provider.id}`}>
                {t("ai.settings.test")}
              </Button>
              {row.needsKey && (
                <Button size="sm" variant={row.hasKey ? "ghost" : "primary"} onClick={() => setKeyFor(row.provider)} data-testid={`ai-key-${row.provider.id}`}>
                  {row.hasKey ? t("ai.settings.replaceKey") : t("ai.settings.enterKey")}
                </Button>
              )}
              <IconButton label={t("common.moreActions")} size="sm" onClick={(e) => setMenu({ provider: row.provider, at: { x: e.clientX, y: e.clientY } })}>
                <MoreHorizontal size={ICON.ui} />
              </IconButton>
            </div>
          </SettingRow>
        ))}
        <SettingCardNote>
          <span className="pv-ai-notewithaction">
            <span>{t("ai.settings.providersHint")}</span>
            <Button size="sm" variant="tonal" icon={<Plus size={ICON.ui} />} onClick={() => setAdding(true)} data-testid="ai-add-provider-open">
              {t("ai.settings.addProvider")}
            </Button>
          </span>
        </SettingCardNote>
      </SettingCard>

      <SettingCard label={t("ai.settings.keysTitle")}>
        <SettingCardNote>{t("ai.settings.keysBody")}</SettingCardNote>
      </SettingCard>

      <SettingCard label={t("ai.settings.profiles")}>
        {AI_PROFILE_IDS.map((id) => (
          <SettingRow key={id} label={t(`ai.profile.${id}`)} desc={profileLine(id)}>
            <Button size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => setModelFor(id)} data-testid={`ai-profile-${id}`}>
              {t("ai.settings.change")}
            </Button>
          </SettingRow>
        ))}
        <SettingRow label={t("ai.settings.defaultProfile")}>
          <Select
            ariaLabel={t("ai.settings.defaultProfile")}
            value={settings.defaultProfile}
            options={AI_PROFILE_IDS.map((id) => ({ value: id, label: t(`ai.profile.${id}`) }))}
            onChange={(id) => void session.updateSettings((s) => ({ ...s, defaultProfile: id }))}
          />
        </SettingRow>
        <SettingCardNote>{t("ai.settings.profilesHint")}</SettingCardNote>
      </SettingCard>

      <SettingCard label={t("ai.settings.sending")}>
        <SettingRow label={t("ai.settings.confirmEvery")} desc={t("ai.settings.confirmEveryDesc")}>
          <Switch
            checked={settings.confirmEveryRequest}
            label={t("ai.settings.confirmEvery")}
            onChange={(on) => void session.updateSettings((s) => ({ ...s, confirmEveryRequest: on }))}
            data-testid="ai-confirm-every"
          />
        </SettingRow>
      </SettingCard>

      {settings.enabled && <McpSettingsCard session={session} enabled={settings.mcpEnabled} />}

      <SettingCard label={t("ai.settings.history")}>
        <SettingRow label={t("ai.settings.historyKeep")} desc={t("ai.settings.historyDesc")}>
          <Select
            ariaLabel={t("ai.settings.historyKeep")}
            value={String(settings.historyDays)}
            options={HISTORY_DAY_CHOICES.map((days) => ({ value: String(days), label: days === 0 ? t("ai.settings.historyForever") : t("ai.settings.historyDays", { count: days }) }))}
            onChange={(value) => void session.updateSettings((s) => ({ ...s, historyDays: Number(value) }))}
          />
        </SettingRow>
        <SettingRow label={t("ai.settings.historyClear")}>
          <Button
            size="sm"
            variant="danger-soft"
            disabled={!state.hasVault || state.summaries.length === 0}
            onClick={() => {
              void appConfirm({ title: t("ai.settings.historyClearConfirm"), message: t("ai.history.deleteBody"), confirmLabel: t("ai.history.delete") }).then((ok) => {
                if (ok) void session.removeAll();
              });
            }}
          >
            {t("ai.history.delete")}
          </Button>
        </SettingRow>
      </SettingCard>

      <SettingCard label={t("ai.settings.usage")}>
        {usage.length === 0 ? (
          <SettingCardNote>{t("ai.settings.usageNone")}</SettingCardNote>
        ) : (
          usage.map((row) => (
            <SettingRow
              key={row.key}
              label={`${session.providers().find((p) => p.id === row.providerId)?.label ?? row.providerId} · ${row.model}`}
              desc={[t("ai.settings.usageRow", { input: number.format(row.usage.inputTokens + row.usage.cacheReadTokens + row.usage.cacheWriteTokens), output: number.format(row.usage.outputTokens) }), row.costUsd !== undefined ? `≈ ${money.format(row.costUsd)}` : ""].filter(Boolean).join(" · ")}
            />
          ))
        )}
      </SettingCard>

      {menu && (
        <MenuSurface open onClose={() => setMenu(null)} at={menu.at} ariaLabel={t("common.moreActions")}>
          {menu.provider.endpoint.needsKey && state.keys[menu.provider.id] && (
            <MenuItem
              onSelect={() => {
                const provider = menu.provider;
                void appConfirm({ title: t("ai.settings.deleteKeyConfirm", { provider: provider.label }), message: t("ai.settings.keysBody"), confirmLabel: t("ai.settings.deleteKey") }).then((ok) => {
                  if (ok) void session.deleteKey(provider.id);
                });
              }}
            >
              {t("ai.settings.deleteKey")}
            </MenuItem>
          )}
          {menu.provider.keyUrl && (
            <MenuItem onSelect={() => void getPlatformServices().openExternal(menu.provider.keyUrl!)}>{t("ai.settings.getKey", { provider: menu.provider.label })}</MenuItem>
          )}
          <MenuSeparator />
          <MenuItem
            danger
            onSelect={() => {
              const provider = menu.provider;
              void appConfirm({ title: t("ai.settings.removeProviderConfirm", { provider: provider.label }), message: t("ai.settings.keysBody"), confirmLabel: t("ai.settings.removeProvider") }).then((ok) => {
                if (ok) void session.removeProvider(provider.id);
              });
            }}
          >
            {t("ai.settings.removeProvider")}
          </MenuItem>
        </MenuSurface>
      )}
      {adding && (
        <AiAddProviderDialog
          session={session}
          state={state}
          onClose={() => setAdding(false)}
          onAdded={(provider) => {
            setAdding(false);
            if (provider.endpoint.needsKey) setKeyFor(provider);
            else void session.testProvider(provider.id);
          }}
        />
      )}
      {keyFor && <AiKeyDialog session={session} provider={keyFor} onClose={() => setKeyFor(null)} />}
      {modelFor && <AiModelDialog session={session} state={state} profile={modelFor} onClose={() => setModelFor(null)} />}
    </div>
  );
}
