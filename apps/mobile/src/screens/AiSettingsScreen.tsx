import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Plus } from "lucide-react";
import { AI_AUDIO_PROFILE, AI_PROFILE_IDS, customEndpointId, normalizeBaseUrl, providerById, type AiProfileId, type AiProfileSlot, type ProviderInfo } from "@plainva/core";
import {
  AI_FEEDBACK_URL,
  addableProviders,
  configuredProviders,
  getPlatformServices,
  GroupCard,
  HISTORY_DAY_CHOICES,
  ICON,
  providerStatus,
  Row,
  RowList,
  SectionLabel,
  Switch,
  toast,
  type AiSession,
} from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { getMobileAiSession } from "../services/ai/mobileAi";
import { mActions, mConfirm, mPrompt, mSelect } from "../services/mobileDialogs";

/**
 * Settings → AI & automation on the phone (plan KI-Harness §19.1), APP world:
 * the same model as the desktop page — the per-device switch, providers and
 * keys, profiles, history — told in the phone's grammar of rows and sheets.
 * Servers "on this computer" are a desktop matter; a phone reaches a server in
 * the network as an own server with https (parity decision `ai-local-servers`).
 */
export function AiSettingsScreen({ onBack }: { onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [usage, setUsage] = useState<Awaited<ReturnType<AiSession["usage"]>>>([]);
  const number = new Intl.NumberFormat(i18n.language);

  useEffect(() => {
    let alive = true;
    void session.usage(new Date().toISOString().slice(0, 7)).then((rows) => {
      if (alive) setUsage(rows);
    });
    return () => {
      alive = false;
    };
  }, [session, state.summaries]);

  if (!state.loaded) return null;
  const settings = state.settings;
  const rows = configuredProviders(state);
  const labelOf = (id: string) => providerById(id, settings.custom)?.label ?? id;

  const enterKey = async (provider: ProviderInfo) => {
    const res = await mPrompt({ title: t("ai.settings.keyTitle", { provider: provider.label }), message: t("ai.settings.keyHint"), placeholder: t("ai.settings.keyField"), secure: true });
    if (res.cancelled || !res.value.trim()) return;
    try {
      await session.setKey(provider.id, res.value);
      await session.testProvider(provider.id);
    } catch (error) {
      // The secure store refused: say so. The message never holds the key.
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const providerActions = async (provider: ProviderInfo) => {
    const hasKey = Boolean(state.keys[provider.id]);
    const choice = await mActions({
      title: provider.label,
      options: [
        { value: "test", label: t("ai.settings.test") },
        ...(provider.endpoint.needsKey ? [{ value: "key", label: hasKey ? t("ai.settings.replaceKey") : t("ai.settings.enterKey") }] : []),
        ...(provider.keyUrl ? [{ value: "console", label: t("ai.settings.getKey", { provider: provider.label }) }] : []),
        ...(hasKey ? [{ value: "deleteKey", label: t("ai.settings.deleteKey"), danger: true }] : []),
        { value: "remove", label: t("ai.settings.removeProvider"), danger: true },
      ],
    });
    if (choice === "test") void session.testProvider(provider.id);
    else if (choice === "key") void enterKey(provider);
    else if (choice === "console" && provider.keyUrl) void getPlatformServices().openExternal(provider.keyUrl);
    else if (choice === "deleteKey") {
      if (await mConfirm({ title: t("ai.settings.deleteKeyConfirm", { provider: provider.label }), danger: true, confirmLabel: t("ai.settings.deleteKey") })) void session.deleteKey(provider.id);
    } else if (choice === "remove") {
      if (await mConfirm({ title: t("ai.settings.removeProviderConfirm", { provider: provider.label }), danger: true, confirmLabel: t("ai.settings.removeProvider") })) void session.removeProvider(provider.id);
    }
  };

  const addProvider = async () => {
    const groups = addableProviders(state, { localServers: false });
    const options = [
      ...[...groups.cloud, ...groups.gateways].map((p) => ({ value: p.id, label: p.label, desc: p.hints.map((h) => t(h)).join(" ") })),
      { value: "__custom", label: t("ai.add.custom"), desc: t("ai.add.customDesc") },
    ];
    const picked = await mActions({ title: t("ai.add.title"), message: t("ai.add.lead"), options });
    if (!picked) return;
    if (picked === "__custom") {
      const address = await mPrompt({ title: t("ai.add.custom"), message: t("ai.add.customUrlHint"), placeholder: "https://…/v1" });
      if (address.cancelled) return;
      const normalized = normalizeBaseUrl(address.value);
      if (!normalized) {
        await mConfirm({ title: t("ai.add.invalidUrl") });
        return;
      }
      const id = customEndpointId(settings.custom.map((c) => c.id));
      const added = await session.addCustom(new URL(normalized.baseUrl).host, normalized.baseUrl, id, normalized.local);
      if (added) void session.testProvider(id);
      return;
    }
    await session.addProvider(picked);
    const provider = providerById(picked, settings.custom);
    if (provider?.endpoint.needsKey) void enterKey(provider);
  };

  const chooseModel = async (profile: AiProfileSlot) => {
    const providerId = await mSelect({
      title: t("ai.settings.modelTitle", { profile: t(`ai.profile.${profile}`) }),
      message: t("ai.settings.provider"),
      options: rows.map((r) => ({ value: r.provider.id, label: r.provider.label })),
      value: settings.profiles[profile]?.providerId,
    });
    if (!providerId) return;
    const test = state.tests[providerId]?.state === "ok" ? state.tests[providerId] : await session.testProvider(providerId);
    // The profile "Audio" lists what can transcribe; every other profile what can chat. Any id can still be typed.
    const models = (test.models ?? []).filter((m) => (profile === AI_AUDIO_PROFILE ? Boolean(m.transcribe) : m.chat));
    let model: string | null = null;
    if (models.length) {
      model = await mSelect({
        title: t("ai.settings.modelFromList"),
        options: [...models.map((m) => ({ value: m.id, label: m.label ?? m.id, desc: m.label && m.label !== m.id ? m.id : undefined })), { value: "__typed", label: t("ai.settings.modelPlaceholder") }],
        value: settings.profiles[profile]?.model,
        search: t("ai.settings.model"),
      });
      if (!model) return;
    }
    if (!model || model === "__typed") {
      const typed = await mPrompt({ title: t("ai.settings.model"), placeholder: t("ai.settings.modelPlaceholder"), initial: settings.profiles[profile]?.model });
      if (typed.cancelled || !typed.value.trim()) return;
      model = typed.value.trim();
    }
    await session.updateSettings((s) => ({ ...s, profiles: { ...s.profiles, [profile]: { providerId, model: model! } } }));
  };

  return (
    <div className="m-page" data-testid="settings-ai">
      <AppBar onBack={onBack} title={t("ai.settings.title")} testId="appbar-area-ai" />
      <div className="m-settings">
        <SectionLabel>{t("ai.settings.betaTitle")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              title={t("ai.settings.betaSwitch")}
              subtitle={t("ai.settings.betaDesc")}
              end={<Switch checked={settings.enabled} label={t("ai.settings.betaSwitch")} onChange={(on) => void session.updateSettings((s) => ({ ...s, enabled: on }))} />}
            />
            <Row
              icon={<ExternalLink size={ICON.ui} />}
              title={t("ai.settings.feedback")}
              subtitle={t("ai.settings.feedbackDesc")}
              onClick={() => void getPlatformServices().openExternal(AI_FEEDBACK_URL)}
              data-testid="ai-feedback"
            />
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("ai.settings.experimental")}</p>

        <SectionLabel>{t("ai.settings.providers")}</SectionLabel>
        <GroupCard>
          <RowList>
            {rows.map((row) => (
              <Row key={row.provider.id} wrap title={row.provider.label} subtitle={providerStatus(t, row)} onClick={() => void providerActions(row.provider)} />
            ))}
            <Row icon={<Plus size={ICON.ui} />} title={t("ai.settings.addProvider")} onClick={() => void addProvider()} data-testid="ai-add-provider-open" />
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("ai.settings.providersHint")}</p>

        <SectionLabel>{t("ai.settings.keysTitle")}</SectionLabel>
        <p className="m-hint">{t("ai.settings.keysBody")}</p>

        <SectionLabel>{t("ai.settings.profiles")}</SectionLabel>
        <GroupCard>
          <RowList>
            {AI_PROFILE_IDS.map((id) => {
              const choice = settings.profiles[id];
              return (
                <Row
                  key={id}
                  title={t(`ai.profile.${id}`)}
                  subtitle={choice ? `${labelOf(choice.providerId)} · ${choice.model}` : t("ai.settings.profileEmpty")}
                  disabled={rows.length === 0}
                  onClick={() => void chooseModel(id)}
                />
              );
            })}
            <Row
              title={t("ai.settings.defaultProfile")}
              subtitle={t(`ai.profile.${settings.defaultProfile}`)}
              onClick={() => {
                void mSelect({ title: t("ai.settings.defaultProfile"), options: AI_PROFILE_IDS.map((id) => ({ value: id, label: t(`ai.profile.${id}`) })), value: settings.defaultProfile }).then((id) => {
                  if (id) void session.updateSettings((s) => ({ ...s, defaultProfile: id as AiProfileId }));
                });
              }}
            />
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("ai.settings.profilesHint")}</p>
        <GroupCard>
          <RowList>
            {/* Beside the chat profiles, never the default for a conversation (plan P1.5, E28). */}
            <Row
              title={t("ai.profile.audio")}
              subtitle={settings.profiles.audio ? `${labelOf(settings.profiles.audio.providerId)} · ${settings.profiles.audio.model}` : t("ai.settings.profileEmpty")}
              disabled={rows.length === 0}
              onClick={() => void chooseModel(AI_AUDIO_PROFILE)}
              data-testid="ai-profile-audio"
            />
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("ai.settings.audioHint")}</p>

        <SectionLabel>{t("ai.settings.sending")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              wrap
              title={t("ai.settings.confirmEvery")}
              subtitle={t("ai.settings.confirmEveryDesc")}
              end={<Switch checked={settings.confirmEveryRequest} label={t("ai.settings.confirmEvery")} onChange={(on) => void session.updateSettings((s) => ({ ...s, confirmEveryRequest: on }))} />}
            />
          </RowList>
        </GroupCard>

        <SectionLabel>{t("ai.settings.history")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              title={t("ai.settings.historyKeep")}
              subtitle={settings.historyDays === 0 ? t("ai.settings.historyForever") : t("ai.settings.historyDays", { count: settings.historyDays })}
              onClick={() => {
                void mSelect({
                  title: t("ai.settings.historyKeep"),
                  message: t("ai.settings.historyDesc"),
                  options: HISTORY_DAY_CHOICES.map((days) => ({ value: String(days), label: days === 0 ? t("ai.settings.historyForever") : t("ai.settings.historyDays", { count: days }) })),
                  value: String(settings.historyDays),
                }).then((value) => {
                  if (value !== null) void session.updateSettings((s) => ({ ...s, historyDays: Number(value) }));
                });
              }}
            />
            <Row
              title={t("ai.settings.historyClear")}
              disabled={!state.hasVault || state.summaries.length === 0}
              onClick={() => {
                void mConfirm({ title: t("ai.settings.historyClearConfirm"), message: t("ai.history.deleteBody"), danger: true, confirmLabel: t("ai.history.delete") }).then((ok) => {
                  if (ok) void session.removeAll();
                });
              }}
            />
          </RowList>
        </GroupCard>

        <SectionLabel>{t("ai.settings.usage")}</SectionLabel>
        <GroupCard>
          <RowList>
            {usage.length === 0 ? (
              <Row title={t("ai.settings.usageNone")} />
            ) : (
              usage.map((row) => (
                <Row
                  key={row.key}
                  wrap
                  title={`${labelOf(row.providerId)} · ${row.model}`}
                  subtitle={t("ai.settings.usageRow", { input: number.format(row.usage.inputTokens + row.usage.cacheReadTokens + row.usage.cacheWriteTokens), output: number.format(row.usage.outputTokens) })}
                />
              ))
            )}
          </RowList>
        </GroupCard>
      </div>
    </div>
  );
}
