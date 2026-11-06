import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, MoreHorizontal, Plus } from "lucide-react";
import { AI_AUDIO_PROFILE, AI_EMBEDDING_PROFILE, AI_PROFILE_IDS, type AiProfileSlot, type ProviderInfo } from "@plainva/core";
import {
  AI_FEEDBACK_URL,
  aiSetupStep,
  Button,
  configuredProviders,
  getPlatformServices,
  HISTORY_DAY_CHOICES,
  ICON,
  IconButton,
  MenuItem,
  MenuSeparator,
  MenuSurface,
  profileFacts,
  providerStatus,
  savingsLine,
  Select,
  SettingCard,
  SettingCardNote,
  SettingRow,
  Switch,
  takeAiSettingsIntent,
  usageRowLine,
  useAiState,
  AiSessionContext,
  type AiSession,
  type ProviderRowModel,
} from "@plainva/ui";
import { appConfirm } from "../../services/appDialogs";
import { getDesktopAiSession } from "../../services/ai/desktopAi";
import { AreaHead } from "./AppPages";
import { AiAddProviderDialog, AiKeyDialog, AiModelDialog } from "./AiDialogs";
import { AiModeRow, AiPrivacyCard } from "./AiModeParts";
import { ExternalAgentsCard } from "./ExternalAgentsCard";
import { McpSettingsCard } from "./McpSettingsCard";
import { SemanticSearchCard } from "./SemanticSearchCard";
import { NoteHintsCard } from "./NoteHintsCard";
import { GistsCard } from "./GistsCard";

/**
 * Settings → AI, APP world (plan KI-Harness §19.1, plan KI-Oberflächen K2):
 * what holds for Plainva on this device in every vault. Off, the page is the
 * one switch. On, both shells show the same groups in the same order: the
 * models (with the mode line, or the setup card while a step is missing),
 * privacy, what runs without a model, the programs of one shell, and
 * history and usage. Nothing here is synced.
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

type MenuWhat = { kind: "provider"; row: ProviderRowModel } | { kind: "profile"; profile: AiProfileSlot };
type MenuFor = MenuWhat & { at: { x: number; y: number } };

function AiSettingsBody({ session }: { session: AiSession }) {
  const { t, i18n } = useTranslation();
  const state = useAiState();
  const [adding, setAdding] = useState(false);
  const [keyFor, setKeyFor] = useState<ProviderInfo | null>(null);
  const [modelFor, setModelFor] = useState<AiProfileSlot | null>(null);
  const [menu, setMenu] = useState<MenuFor | null>(null);
  const [usage, setUsage] = useState<Awaited<ReturnType<AiSession["usage"]>>>([]);
  const [saved, setSaved] = useState<Awaited<ReturnType<AiSession["savings"]>>>({ savedTokens: 0, runs: 0 });
  const number = new Intl.NumberFormat(i18n.language);
  const money = new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

  const summaries = state?.summaries;
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
  }, [session, summaries]);

  // A notice in a conversation may send the user here for one fix (plan KI-Oberflächen K10): open that dialog.
  const loaded = Boolean(state?.loaded);
  useEffect(() => {
    if (!loaded) return;
    const intent = takeAiSettingsIntent();
    if (!intent) return;
    if (intent.kind === "model") setModelFor(intent.profile);
    else {
      const provider = session.providers().find((p) => p.id === intent.providerId);
      if (provider) setKeyFor(provider);
    }
  }, [loaded, session]);

  const savedText = savingsLine(t, saved, { number, money });
  if (!state?.loaded) return null;
  const settings = state.settings;
  const rows = configuredProviders(state);
  const step = aiSetupStep(state);
  const profileLine = (id: AiProfileSlot) => {
    const choice = settings.profiles[id];
    if (!choice) return t("ai.settings.profileEmpty");
    const line = `${session.providers().find((p) => p.id === choice.providerId)?.label ?? choice.providerId} · ${choice.model}`;
    // What the user said about a model on a server of this device (plan P7): its window, and that it takes no tools.
    const parts = [line, ...profileFacts(t, choice, (value) => number.format(value))];
    // The profile new conversations start with carries the word, instead of a select of its own (plan E3).
    return (id === settings.defaultProfile ? [t("ai.settings.defaultBadge"), ...parts] : parts).join(" · ");
  };
  /** After a key or a provider: where the profile new conversations start with is still empty, its model is next (plan K3, E6). */
  const nextAfterProvider = () => {
    if (!session.getState().settings.profiles[session.getState().settings.defaultProfile]) setModelFor(session.getState().settings.defaultProfile);
  };
  const openMenu = (event: MouseEvent, value: MenuWhat) => setMenu({ ...value, at: { x: event.clientX, y: event.clientY } });

  return (
    <div className="pv-setpage" data-testid="settings-ai">
      <AreaHead areaId="ai" />

      <SettingCard label={t("ai.settings.betaTitle")}>
        <SettingRow label={t("ai.settings.betaSwitch")} desc={t("ai.settings.betaDesc")}>
          <Switch checked={settings.enabled} label={t("ai.settings.betaSwitch")} onChange={(on) => void session.updateSettings((s) => ({ ...s, enabled: on }))} testId="ai-beta-switch" />
        </SettingRow>
        <SettingRow label={t("ai.settings.feedback")} desc={t("ai.settings.feedbackDesc")}>
          <Button size="sm" variant="secondary" icon={<ExternalLink size={ICON.ui} />} onClick={() => void getPlatformServices().openExternal(AI_FEEDBACK_URL)} data-testid="ai-feedback">
            {t("ai.settings.feedbackOpen")}
          </Button>
        </SettingRow>
        {!settings.enabled && <SettingCardNote>{t("ai.settings.offNextDesktop")}</SettingCardNote>}
        <SettingCardNote>{t("ai.settings.experimental")}</SettingCardNote>
      </SettingCard>

      {/* Off, the page is the switch alone (plan KI-Oberflächen E7): nothing to set up for a feature nobody uses. */}
      {settings.enabled && (
        <>
          <SettingCard label={t("ai.settings.models")} info={t("ai.settings.keysBody")}>
            {/* One card with one way while a step is missing (plan K3); the mode line once a conversation can start. */}
            {step === "provider" ? (
              <SettingRow label={t("ai.setup.title")} desc={t("ai.setup.bodyDesktop")}>
                <Button size="sm" variant="primary" icon={<Plus size={ICON.ui} />} onClick={() => setAdding(true)} data-testid="ai-setup-provider">
                  {t("ai.settings.addProvider")}
                </Button>
              </SettingRow>
            ) : step === "model" ? (
              <SettingRow label={t("ai.setup.modelTitle")} desc={t("ai.setup.modelBody", { profile: t(`ai.profile.${settings.defaultProfile}`) })}>
                <Button size="sm" variant="primary" onClick={() => setModelFor(settings.defaultProfile)} data-testid="ai-setup-model">
                  {t("ai.setup.chooseModel")}
                </Button>
              </SettingRow>
            ) : (
              <AiModeRow state={state} onSetUp={() => setAdding(true)} />
            )}
            {rows.map((row) => {
              const failed = row.test?.state === "failed";
              return (
                <SettingRow key={row.provider.id} label={row.provider.label} desc={providerStatus(t, row)}>
                  <div className="pv-ai-rowactions">
                    {/* A row carries a button only while something is missing (plan K4); the rest is in its menu. */}
                    {row.needsKey && !row.hasKey ? (
                      <Button size="sm" variant="primary" onClick={() => setKeyFor(row.provider)} data-testid={`ai-key-${row.provider.id}`}>
                        {t("ai.settings.enterKey")}
                      </Button>
                    ) : failed ? (
                      <Button size="sm" variant="secondary" onClick={() => void session.testProvider(row.provider.id)} data-testid={`ai-test-${row.provider.id}`}>
                        {t("ai.settings.retry")}
                      </Button>
                    ) : null}
                    <IconButton label={t("common.moreActions")} size="sm" onClick={(e) => openMenu(e, { kind: "provider", row })} data-testid={`ai-provider-more-${row.provider.id}`}>
                      <MoreHorizontal size={ICON.ui} />
                    </IconButton>
                  </div>
                </SettingRow>
              );
            })}
            <SettingCardNote>
              <Button size="sm" variant="tonal" icon={<Plus size={ICON.ui} />} onClick={() => setAdding(true)} data-testid="ai-add-provider-open">
                {t("ai.settings.addProvider")}
              </Button>
            </SettingCardNote>
            {AI_PROFILE_IDS.map((id) => (
              <SettingRow key={id} label={t(`ai.profile.${id}`)} desc={profileLine(id)}>
                <div className="pv-ai-rowactions">
                  <Button size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => setModelFor(id)} data-testid={`ai-profile-${id}`}>
                    {t("ai.settings.change")}
                  </Button>
                  <IconButton label={t("common.moreActions")} size="sm" disabled={!settings.profiles[id]} onClick={(e) => openMenu(e, { kind: "profile", profile: id })} data-testid={`ai-profile-more-${id}`}>
                    <MoreHorizontal size={ICON.ui} />
                  </IconButton>
                </div>
              </SettingRow>
            ))}
            <SettingCardNote>{t("ai.settings.moreModels")}</SettingCardNote>
            {/* Beside the chat profiles, never the default for a conversation (plan P1.5, E28). */}
            <SettingRow label={t("ai.profile.audio")} desc={profileLine(AI_AUDIO_PROFILE)} info={t("ai.settings.audioHint")}>
              <Button size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => setModelFor(AI_AUDIO_PROFILE)} data-testid="ai-profile-audio">
                {t("ai.settings.change")}
              </Button>
            </SettingRow>
            {/* Search by meaning's own provider (plan P2a-5): beside the chat profiles as well. */}
            <SettingRow label={t("ai.profile.embedding")} desc={profileLine(AI_EMBEDDING_PROFILE)} info={t("ai.settings.embeddingHint")}>
              <Button size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => setModelFor(AI_EMBEDDING_PROFILE)} data-testid="ai-profile-embedding">
                {t("ai.settings.change")}
              </Button>
            </SettingRow>
          </SettingCard>

          {/* What may leave this device, in one place (plan K2): the promise "Fully local", and the question before each request. */}
          <AiPrivacyCard session={session} state={state} />

          {/* What runs on this device without a model (plan K5). */}
          <SemanticSearchCard session={session} onChooseModel={() => setModelFor(AI_EMBEDDING_PROFILE)} />
          <NoteHintsCard session={session} />
          <GistsCard session={session} />
          {/* The programs of other makers — only the desktop has them (parity decisions ai-mcp-server, ai-external-agents). */}
          <McpSettingsCard session={session} enabled={settings.mcpEnabled} resting={settings.localOnly} />
          <ExternalAgentsCard />
        </>
      )}

      {/* History and usage stay when the AI is off (plan KI-Oberflächen § 7): deleting the stored conversations is a
          privacy step nobody should have to switch the AI on for. */}
      <SettingCard label={t("ai.settings.historyUsage")}>
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
            data-testid="ai-history-clear"
          >
            {t("ai.history.delete")}
          </Button>
        </SettingRow>
        <SettingCardNote>{t("ai.settings.usage")}</SettingCardNote>
        {usage.length === 0 ? (
          <SettingCardNote>{t("ai.settings.usageNone")}</SettingCardNote>
        ) : (
          usage.map((row) => (
            <SettingRow
              key={row.key}
              label={`${session.providers().find((p) => p.id === row.providerId)?.label ?? row.providerId} · ${row.model}`}
              desc={usageRowLine(t, row, { number, money })}
            />
          ))
        )}
        {savedText && (
          <SettingCardNote>
            <span data-testid="ai-usage-saved">{savedText}</span>
          </SettingCardNote>
        )}
      </SettingCard>

      {menu?.kind === "provider" && (
        <MenuSurface open onClose={() => setMenu(null)} at={menu.at} ariaLabel={t("common.moreActions")}>
          <MenuItem onSelect={() => void session.testProvider(menu.row.provider.id)} data-testid="ai-provider-test">
            {menu.row.provider.kind === "platform-device" ? t("ai.settings.checkPlatform") : t("ai.settings.test")}
          </MenuItem>
          {menu.row.needsKey && menu.row.hasKey && <MenuItem onSelect={() => setKeyFor(menu.row.provider)}>{t("ai.settings.replaceKey")}</MenuItem>}
          {menu.row.provider.keyUrl && (
            <MenuItem onSelect={() => void getPlatformServices().openExternal(menu.row.provider.keyUrl!)}>{t("ai.settings.getKey", { provider: menu.row.provider.label })}</MenuItem>
          )}
          {menu.row.needsKey && menu.row.hasKey && (
            <MenuItem
              onSelect={() => {
                const provider = menu.row.provider;
                void appConfirm({ title: t("ai.settings.deleteKeyConfirm", { provider: provider.label }), message: t("ai.settings.keysBody"), confirmLabel: t("ai.settings.deleteKey") }).then((ok) => {
                  if (ok) void session.deleteKey(provider.id);
                });
              }}
            >
              {t("ai.settings.deleteKey")}
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem
            danger
            onSelect={() => {
              const provider = menu.row.provider;
              void appConfirm({ title: t("ai.settings.removeProviderConfirm", { provider: provider.label }), message: t("ai.settings.keysBody"), confirmLabel: t("ai.settings.removeProvider") }).then((ok) => {
                if (ok) void session.removeProvider(provider.id);
              });
            }}
          >
            {t("ai.settings.removeProvider")}
          </MenuItem>
        </MenuSurface>
      )}
      {menu?.kind === "profile" && (
        <MenuSurface open onClose={() => setMenu(null)} at={menu.at} ariaLabel={t("common.moreActions")}>
          {menu.profile !== settings.defaultProfile && (AI_PROFILE_IDS as readonly string[]).includes(menu.profile) && (
            <MenuItem onSelect={() => void session.updateSettings((s) => ({ ...s, defaultProfile: menu.profile as (typeof AI_PROFILE_IDS)[number] }))} data-testid="ai-profile-make-default">
              {t("ai.settings.makeDefault")}
            </MenuItem>
          )}
          <MenuItem
            danger
            onSelect={() => void session.updateSettings((s) => ({ ...s, profiles: Object.fromEntries(Object.entries(s.profiles).filter(([id]) => id !== menu.profile)) }))}
            data-testid="ai-profile-clear"
          >
            {t("ai.settings.clearProfile")}
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
            else void session.testProvider(provider.id).then((test) => test.state === "ok" && nextAfterProvider());
          }}
        />
      )}
      {keyFor && (
        <AiKeyDialog
          session={session}
          provider={keyFor}
          onClose={(stored) => {
            setKeyFor(null);
            if (stored) nextAfterProvider();
          }}
        />
      )}
      {modelFor && <AiModelDialog session={session} state={state} profile={modelFor} onClose={() => setModelFor(null)} />}
    </div>
  );
}
