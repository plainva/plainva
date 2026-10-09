import { useEffect, useState, useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { useTranslation } from "react-i18next";
import { ExternalLink, Plus } from "lucide-react";
import { AI_AUDIO_PROFILE, AI_EMBEDDING_PROFILE, AI_PROFILE_IDS, customEndpointId, normalizeBaseUrl, providerById, type AiProfileId, type AiProfileSlot, type ModelChoice, type ProviderInfo } from "@plainva/core";
import {
  AI_FEEDBACK_URL,
  addableProviders,
  configuredProviders,
  describesItself,
  getPlatformServices,
  GroupCard,
  HISTORY_DAY_CHOICES,
  ICON,
  modeFacts,
  profileFacts,
  providerStatus,
  readStatedWindow,
  Row,
  RowList,
  SectionLabel,
  statedChoice,
  STATED_WINDOW_BOUNDS,
  Switch,
  toast,
  type AiSession,
} from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { MobileSemanticSection } from "../components/MobileSemanticSection";
import { MobileGistsSection } from "../components/MobileGistsSection";
import { MobileSystemAssistantSection } from "../components/MobileSystemAssistantSection";
import { getMobileAiSession } from "../services/ai/mobileAi";
import { PlatformModel } from "../platform/platformModel";
import { mActions, mConfirm, mPrompt, mSelect } from "../services/mobileDialogs";

/** The system whose own model this phone may offer (plan KI-Harness P2c). */
function platformOs(): "ios" | "android" | null {
  const p = Capacitor.getPlatform();
  return p === "ios" || p === "android" ? p : null;
}

/**
 * Settings → AI & automation on the phone (plan KI-Harness §19.1), APP world:
 * the same model as the desktop page — the per-device switch, providers and
 * keys, profiles, history — told in the phone's grammar of rows and sheets.
 * Servers "on this computer" are a desktop matter; a phone reaches a server in
 * the network as an own server with https (parity decision `ai-local-servers`).
 * The system's own model is the phone's free way instead (plan P2c, parity
 * decision `ai-platform-models`): offered first, checked on opening.
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

  // The system's own model says on opening whether it is there (plan P2c).
  useEffect(() => {
    for (const row of configuredProviders(session.getState())) {
      if (row.provider.kind === "platform-device" && !session.getState().tests[row.provider.id]) void session.testProvider(row.provider.id);
    }
  }, [session, state.loaded]);

  if (!state.loaded) return null;
  const settings = state.settings;
  const rows = configuredProviders(state);
  const labelOf = (id: string) => providerById(id, settings.custom)?.label ?? id;
  // The mode this device is in (plan KI-Harness P7): the same view model the desktop's card draws.
  const mode = modeFacts(t, state, i18n.language);
  /** A profile's line: its provider and model, and what the user said about a model on a server of this device. */
  const choiceLine = (choice: ModelChoice) => [`${labelOf(choice.providerId)} · ${choice.model}`, ...profileFacts(t, choice, (value) => number.format(value))].join(" · ");

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

  /** Asks the system to load its model (Android); the row says when it is there. */
  const loadPlatformModel = async (provider: ProviderInfo) => {
    toast.info(t("ai.settings.loadPlatformStarted", { provider: provider.label }));
    try {
      await PlatformModel.download();
      toast.success(t("ai.settings.loadPlatformDone", { provider: provider.label }));
    } catch {
      toast.error(t("ai.settings.loadPlatformFailed", { provider: provider.label }));
    }
    void session.testProvider(provider.id);
  };

  const providerActions = async (provider: ProviderInfo) => {
    const hasKey = Boolean(state.keys[provider.id]);
    const platform = provider.kind === "platform-device";
    const failure = state.tests[provider.id]?.failure;
    const loadable = platform && failure?.kind === "platform_unavailable" && failure.reason === "downloadable";
    const choice = await mActions({
      title: provider.label,
      options: [
        { value: "test", label: platform ? t("ai.settings.checkPlatform") : t("ai.settings.test") },
        ...(loadable ? [{ value: "load", label: t("ai.settings.loadPlatformModel") }] : []),
        ...(provider.endpoint.needsKey ? [{ value: "key", label: hasKey ? t("ai.settings.replaceKey") : t("ai.settings.enterKey") }] : []),
        ...(provider.keyUrl ? [{ value: "console", label: t("ai.settings.getKey", { provider: provider.label }) }] : []),
        ...(hasKey ? [{ value: "deleteKey", label: t("ai.settings.deleteKey"), danger: true }] : []),
        { value: "remove", label: t("ai.settings.removeProvider"), danger: true },
      ],
    });
    if (choice === "test") void session.testProvider(provider.id);
    else if (choice === "load") void loadPlatformModel(provider);
    else if (choice === "key") void enterKey(provider);
    else if (choice === "console" && provider.keyUrl) void getPlatformServices().openExternal(provider.keyUrl);
    else if (choice === "deleteKey") {
      if (await mConfirm({ title: t("ai.settings.deleteKeyConfirm", { provider: provider.label }), danger: true, confirmLabel: t("ai.settings.deleteKey") })) void session.deleteKey(provider.id);
    } else if (choice === "remove") {
      if (await mConfirm({ title: t("ai.settings.removeProviderConfirm", { provider: provider.label }), danger: true, confirmLabel: t("ai.settings.removeProvider") })) void session.removeProvider(provider.id);
    }
  };

  const addProvider = async () => {
    const groups = addableProviders(state, { localServers: false, platformOs: platformOs() });
    const options = [
      // The system's own model first: the phone's way without a key (plan P2c).
      ...[...groups.device, ...groups.cloud, ...groups.gateways].map((p) => ({ value: p.id, label: p.label, desc: p.hints.map((h) => t(h)).join(" ") })),
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
    if (provider?.kind === "platform-device") void session.testProvider(provider.id);
    else if (provider?.endpoint.needsKey) void enterKey(provider);
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
    // "Audio" lists what can transcribe, "Embeddings" what embeds, every other profile what can chat. Any id can still be typed.
    const models = (test.models ?? []).filter((m) => (profile === AI_AUDIO_PROFILE ? Boolean(m.transcribe) : profile === AI_EMBEDDING_PROFILE ? Boolean(m.embed) : m.chat));
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
    if (!model) return;
    const named = { providerId, model };
    let choice: ModelChoice = named;
    // What the user says about a model on a server of this device (plan KI-Harness P7): its window, and whether it
    // takes tools. A provider's list and the system's own model say both themselves, and neither is asked of a
    // model that transcribes or embeds.
    const provider = providerById(providerId, settings.custom);
    if (!describesItself(provider) && profile !== AI_AUDIO_PROFILE && profile !== AI_EMBEDDING_PROFILE) {
      const before = settings.profiles[profile];
      const same = before && before.providerId === providerId && before.model === model ? before : undefined;
      let window: number | undefined;
      for (;;) {
        const typed = await mPrompt({
          title: t("ai.settings.modelWindow"),
          message: t("ai.settings.modelWindowDesc"),
          placeholder: t("ai.settings.modelWindowPlaceholder"),
          initial: same?.contextTokens ? String(same.contextTokens) : "",
        });
        if (typed.cancelled) return;
        const read = readStatedWindow(typed.value);
        if (read.ok) {
          window = read.value;
          break;
        }
        await mConfirm({ title: t("ai.settings.modelWindowInvalid", { min: number.format(STATED_WINDOW_BOUNDS.min), max: number.format(STATED_WINDOW_BOUNDS.max) }) });
      }
      const tools = await mSelect({
        title: t("ai.settings.modelTools"),
        message: t("ai.settings.modelToolsDesc"),
        options: [
          { value: "on", label: t("ai.settings.modelTools") },
          { value: "off", label: t("ai.settings.modelToolsNo") },
        ],
        value: same?.tools === false ? "off" : "on",
      });
      if (!tools) return;
      choice = statedChoice(provider, named, { window, tools: tools === "on" });
    }
    await session.updateSettings((s) => ({ ...s, profiles: { ...s.profiles, [profile]: choice } }));
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

        {/* The mode this device is in, and the one switch that promises something (plan KI-Harness P7). */}
        {settings.enabled && (
          <>
            <SectionLabel>{t("ai.mode.title")}</SectionLabel>
            <GroupCard>
              <RowList>
                <Row wrap title={mode.title} subtitle={mode.body} data-testid="ai-mode-now" />
                {mode.empty && <Row icon={<Plus size={ICON.ui} />} title={t("ai.mode.setUp")} onClick={() => void addProvider()} data-testid="ai-mode-setup" />}
                <Row
                  wrap
                  title={t("ai.mode.switch")}
                  subtitle={t("ai.mode.switchDesc")}
                  end={<Switch checked={mode.localOnly} label={t("ai.mode.switch")} onChange={(on) => void session.updateSettings((s) => ({ ...s, localOnly: on }))} />}
                  data-testid="ai-local-only"
                />
              </RowList>
            </GroupCard>
            {mode.localOnly ? (
              <>
                {/* Only what is set up is listed: a row per thing that rests, each with what resting means for it. */}
                <p className="m-hint">{mode.rests.length ? t("ai.mode.rests.title") : t("ai.mode.rests.none")}</p>
                {mode.rests.length > 0 && (
                  <GroupCard>
                    <RowList>
                      {mode.rests.map((rest) => (
                        <Row key={rest.kind} wrap title={rest.label} subtitle={rest.desc} data-testid="ai-mode-rest" />
                      ))}
                    </RowList>
                  </GroupCard>
                )}
                <p className="m-hint">{t("ai.mode.notThis")}</p>
              </>
            ) : (
              <p className="m-hint">{t("ai.mode.note")}</p>
            )}
          </>
        )}

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
                  subtitle={choice ? choiceLine(choice) : t("ai.settings.profileEmpty")}
                  disabled={rows.length === 0}
                  onClick={() => void chooseModel(id)}
                  data-testid={`ai-profile-${id}`}
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
        <GroupCard>
          <RowList>
            {/* Search by meaning's own provider (plan P2a-5): beside the chat profiles as well. */}
            <Row
              title={t("ai.profile.embedding")}
              subtitle={settings.profiles.embedding ? `${labelOf(settings.profiles.embedding.providerId)} · ${settings.profiles.embedding.model}` : t("ai.settings.profileEmpty")}
              disabled={rows.length === 0}
              onClick={() => void chooseModel(AI_EMBEDDING_PROFILE)}
              data-testid="ai-profile-embedding"
            />
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("ai.settings.embeddingHint")}</p>

        {settings.enabled && <MobileSemanticSection session={session} onChooseModel={() => void chooseModel(AI_EMBEDDING_PROFILE)} />}
        {settings.enabled && <MobileGistsSection session={session} />}
        {settings.enabled && <MobileSystemAssistantSection session={session} />}

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
