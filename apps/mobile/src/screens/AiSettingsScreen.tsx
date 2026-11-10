import { useEffect, useState, useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { useTranslation } from "react-i18next";
import { ExternalLink, Plus } from "lucide-react";
import { AI_AUDIO_PROFILE, AI_EMBEDDING_PROFILE, AI_PROFILE_IDS, customEndpointId, normalizeBaseUrl, providerById, type AiProfileId, type AiProfileSlot, type ModelChoice, type ProviderInfo } from "@plainva/core";
import { AreaBoundary,
  AI_FEEDBACK_URL,
  addableProviders,
  aiSetupStep,
  configuredProviders,
  getPlatformServices,
  GroupCard,
  HISTORY_DAY_CHOICES,
  ICON,
  modeFacts,
  profileFacts,
  providerStatus,
  Row,
  RowList,
  savingsLine,
  SectionLabel,
  Switch,
  takeAiSettingsIntent,
  toast,
  usageRowLine,
  type AiSession,
} from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { MobileSemanticSection } from "../components/MobileSemanticSection";
import { MobileNoteHintsSection } from "../components/MobileNoteHintsSection";
import { MobileGistsSection } from "../components/MobileGistsSection";
import { MobileSystemAssistantSection } from "../components/MobileSystemAssistantSection";
import { AiModelSheet } from "../components/AiModelSheet";
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
  const [saved, setSaved] = useState<Awaited<ReturnType<AiSession["savings"]>>>({ savedTokens: 0, runs: 0 });
  // The model of one profile, in one sheet (plan KI-Oberflächen K4).
  const [modelFor, setModelFor] = useState<AiProfileSlot | null>(null);
  const number = new Intl.NumberFormat(i18n.language);
  // As the desktop says it: the cost where the provider publishes prices (plan P9-6).
  const money = new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

  useEffect(() => {
    let alive = true;
    const month = new Date().toISOString().slice(0, 7);
    void Promise.all([session.usage(month), session.savings(month)]).then(([rows, savings]) => {
      if (!alive) return;
      setUsage(rows);
      setSaved(savings);
    });
    return () => {
      alive = false;
    };
  }, [session, state.summaries]);
  const savedText = savingsLine(t, saved, { number, money });

  // The system's own model says on opening whether it is there (plan P2c).
  useEffect(() => {
    for (const row of configuredProviders(session.getState())) {
      if (row.provider.kind === "platform-device" && !session.getState().tests[row.provider.id]) void session.testProvider(row.provider.id);
    }
  }, [session, state.loaded]);

  /** After a key or a provider: where the profile new conversations start with is still empty, its model is next (plan K3, E6). */
  const nextAfterProvider = () => {
    const now = session.getState().settings;
    if (!now.profiles[now.defaultProfile]) setModelFor(now.defaultProfile);
  };
  const enterKey = async (provider: ProviderInfo) => {
    const res = await mPrompt({ title: t("ai.settings.keyTitle", { provider: provider.label }), message: t("ai.settings.keyHint"), placeholder: t("ai.settings.keyField"), secure: true });
    if (res.cancelled || !res.value.trim()) return;
    try {
      await session.setKey(provider.id, res.value);
      const test = await session.testProvider(provider.id);
      if (test.state === "ok") nextAfterProvider();
    } catch (error) {
      // The secure store refused: say so. The message never holds the key.
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  // A notice in a conversation may send the user here for one fix (plan KI-Oberflächen K10): taken once, when the page shows.
  useEffect(() => {
    if (!state.loaded) return;
    const intent = takeAiSettingsIntent();
    if (intent?.kind === "model") setModelFor(intent.profile);
    else if (intent?.kind === "key") {
      const provider = providerById(intent.providerId, session.getState().settings.custom);
      if (provider) void enterKey(provider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- taken once, when the page has loaded
  }, [state.loaded]);

  if (!state.loaded) return null;
  const settings = state.settings;
  const rows = configuredProviders(state);
  const labelOf = (id: string) => providerById(id, settings.custom)?.label ?? id;
  // The mode this device is in (plan KI-Harness P7): the same view model the desktop's card draws.
  const mode = modeFacts(t, state, i18n.language);
  /** A profile's line: its provider and model, and what the user said about a model on a server of this device. */
  const choiceLine = (choice: ModelChoice) => [`${labelOf(choice.providerId)} · ${choice.model}`, ...profileFacts(t, choice, (value) => number.format(value))].join(" · ");
  /** The profile new conversations start with carries the word, instead of a row of its own (plan E3). */
  const profileLine = (id: AiProfileSlot) => {
    const choice = settings.profiles[id];
    const line = choice ? choiceLine(choice) : t("ai.settings.profileEmpty");
    return id === settings.defaultProfile ? `${t("ai.settings.defaultBadge")} · ${line}` : line;
  };
  const step = aiSetupStep(state);
  /** A profile row: its sheet straight away while it is empty; otherwise what can be done with it. */
  const profileActions = async (id: AiProfileSlot) => {
    if (!settings.profiles[id]) {
      setModelFor(id);
      return;
    }
    const choice = await mActions({
      title: t(`ai.profile.${id}`),
      options: [
        { value: "change", label: t("ai.settings.changeModel") },
        ...(id !== settings.defaultProfile && (AI_PROFILE_IDS as readonly string[]).includes(id) ? [{ value: "default", label: t("ai.settings.makeDefault") }] : []),
        { value: "clear", label: t("ai.settings.clearProfile"), danger: true },
      ],
    });
    if (choice === "change") setModelFor(id);
    else if (choice === "default") void session.updateSettings((s) => ({ ...s, defaultProfile: id as AiProfileId }));
    else if (choice === "clear") void session.updateSettings((s) => ({ ...s, profiles: Object.fromEntries(Object.entries(s.profiles).filter(([key]) => key !== id)) }));
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
      if (added) void session.testProvider(id).then((test) => test.state === "ok" && nextAfterProvider());
      return;
    }
    await session.addProvider(picked);
    const provider = providerById(picked, settings.custom);
    if (provider?.endpoint.needsKey) void enterKey(provider);
    else if (provider) void session.testProvider(provider.id).then((test) => test.state === "ok" && nextAfterProvider());
  };

  return (
    <div className="m-page" data-testid="settings-ai">
      <AppBar onBack={onBack} title={t("ai.settings.title")} testId="appbar-area-ai" />
      <div className="m-settings">
        <SectionLabel>{t("ai.settings.betaTitle")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              wrap
              title={t("ai.settings.betaSwitch")}
              subtitle={t("ai.settings.betaDesc")}
              end={<Switch checked={settings.enabled} label={t("ai.settings.betaSwitch")} onChange={(on) => void session.updateSettings((s) => ({ ...s, enabled: on }))} />}
            />
            <Row
              wrap
              icon={<ExternalLink size={ICON.ui} />}
              title={t("ai.settings.feedback")}
              subtitle={t("ai.settings.feedbackDesc")}
              onClick={() => void getPlatformServices().openExternal(AI_FEEDBACK_URL)}
              data-testid="ai-feedback"
            />
          </RowList>
        </GroupCard>
        {!settings.enabled && <p className="m-hint">{t("ai.settings.offNextPhone")}</p>}
        <p className="m-hint">{t("ai.settings.experimental")}</p>

        {/* Off, the page is the switch alone (plan KI-Oberflächen E7). On, the same groups in the same order as the desktop (K2). */}
        {settings.enabled && (
          <>
            <SectionLabel info={t("ai.settings.keysBody")}>{t("ai.settings.models")}</SectionLabel>
            <GroupCard>
              <RowList>
                {/* One card with one way while a step is missing (plan K3); the mode line once a conversation can start. */}
                {step === "provider" ? (
                  <Row wrap title={t("ai.setup.title")} subtitle={t("ai.setup.bodyPhone")} data-testid="ai-mode-now" />
                ) : step === "model" ? (
                  <Row
                    wrap
                    title={t("ai.setup.modelTitle")}
                    subtitle={t("ai.setup.modelBody", { profile: t(`ai.profile.${settings.defaultProfile}`) })}
                    onClick={() => setModelFor(settings.defaultProfile)}
                    data-testid="ai-setup-model"
                  />
                ) : (
                  <Row wrap title={mode.title} subtitle={mode.body} data-testid="ai-mode-now" />
                )}
                {/* Fully local, and no profile names a model on this device: the way there (plan KI-Harness P7). */}
                {step === null && mode.empty && <Row icon={<Plus size={ICON.ui} />} title={t("ai.mode.setUp")} onClick={() => void addProvider()} data-testid="ai-mode-setup" />}
                {rows.map((row) => (
                  <Row key={row.provider.id} wrap title={row.provider.label} subtitle={providerStatus(t, row)} onClick={() => void providerActions(row.provider)} />
                ))}
                <Row icon={<Plus size={ICON.ui} />} title={t("ai.settings.addProvider")} onClick={() => void addProvider()} data-testid="ai-add-provider-open" />
                {AI_PROFILE_IDS.map((id) => (
                  <Row key={id} wrap title={t(`ai.profile.${id}`)} subtitle={profileLine(id)} disabled={rows.length === 0} onClick={() => void profileActions(id)} data-testid={`ai-profile-${id}`} />
                ))}
              </RowList>
            </GroupCard>
            <p className="m-hint">{t("ai.settings.moreModels")}</p>
            <GroupCard>
              <RowList>
                {/* Beside the chat profiles, never the default for a conversation (plan P1.5, E28). */}
                <Row wrap title={t("ai.profile.audio")} subtitle={profileLine(AI_AUDIO_PROFILE)} info={t("ai.settings.audioHint")} disabled={rows.length === 0} onClick={() => void profileActions(AI_AUDIO_PROFILE)} data-testid="ai-profile-audio" />
                {/* Search by meaning's own provider (plan P2a-5): beside the chat profiles as well. */}
                <Row wrap title={t("ai.profile.embedding")} subtitle={profileLine(AI_EMBEDDING_PROFILE)} info={t("ai.settings.embeddingHint")} disabled={rows.length === 0} onClick={() => void profileActions(AI_EMBEDDING_PROFILE)} data-testid="ai-profile-embedding" />
              </RowList>
            </GroupCard>

            {/* What may leave this device, in one place (plan K2): the promise "Fully local", and the question before each request. */}
            <SectionLabel info={mode.localOnly ? t("ai.mode.notThis") : t("ai.mode.note")}>{t("ai.settings.privacy")}</SectionLabel>
            <GroupCard>
              <RowList>
                <Row
                  wrap
                  title={t("ai.mode.switch")}
                  info={t("ai.mode.switchDesc")}
                  end={<Switch checked={mode.localOnly} label={t("ai.mode.switch")} onChange={(on) => void session.updateSettings((s) => ({ ...s, localOnly: on }))} />}
                  data-testid="ai-local-only"
                />
                <Row
                  wrap
                  title={t("ai.settings.confirmEvery")}
                  info={t("ai.settings.confirmEveryDesc")}
                  end={<Switch checked={settings.confirmEveryRequest} label={t("ai.settings.confirmEvery")} onChange={(on) => void session.updateSettings((s) => ({ ...s, confirmEveryRequest: on }))} />}
                />
              </RowList>
            </GroupCard>
            {mode.localOnly && (
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
              </>
            )}
            <p className="m-hint">{t("ai.settings.privacyVaultNote")}</p>

            {/* What runs on this device without a model (plan K5). */}
            <MobileSemanticSection session={session} onChooseModel={() => setModelFor(AI_EMBEDDING_PROFILE)} />
            <MobileNoteHintsSection session={session} />
            <MobileGistsSection session={session} />
            {/* The system's assistant — only the phone has it (parity entry ai-system-intents). */}
            {settings.enabled && <MobileSystemAssistantSection session={session} />}

          </>
        )}

        {/* History and usage stay when the AI is off (plan KI-Oberflächen § 7): deleting the stored conversations is a
            privacy step nobody should have to switch the AI on for. */}
        <SectionLabel>{t("ai.settings.historyUsage")}</SectionLabel>
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
              data-testid="ai-history-clear"
            />
          </RowList>
        </GroupCard>
        <p className="m-hint">{t("ai.settings.usage")}</p>
        <GroupCard>
          <RowList>
            {usage.length === 0 ? (
              <Row title={t("ai.settings.usageNone")} />
            ) : (
              usage.map((row) => (
                <Row key={row.key} wrap title={`${labelOf(row.providerId)} · ${row.model}`} subtitle={usageRowLine(t, row, { number, money })} />
              ))
            )}
          </RowList>
        </GroupCard>
        {/* About the whole card, as the desktop says it in its note: below it, on the page edge (plan P9-6). */}
        {savedText && (
          <p className="m-hint" data-testid="m-ai-usage-saved">
            {savedText}
          </p>
        )}
      </div>
      {modelFor && <AreaBoundary area="sheet:aiModel" size="dialog" exit={{ label: t("common.close"), onExit: () => setModelFor(null) }}><AiModelSheet session={session} state={state} rows={rows} profile={modelFor} onClose={() => setModelFor(null)} /></AreaBoundary>}
    </div>
  );
}
