import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { customEndpointId, normalizeBaseUrl, providerById, type ProviderInfo, AI_AUDIO_PROFILE, AI_EMBEDDING_PROFILE, type AiProfileSlot } from "@plainva/core";
import {
  addableProviders,
  Banner,
  Button,
  describesItself,
  getPlatformServices,
  Modal,
  readStatedWindow,
  Select,
  statedChoice,
  STATED_WINDOW_BOUNDS,
  Switch,
  TextInput,
  toast,
  type AiSession,
  type AiState,
} from "@plainva/ui";

/**
 * The three dialogs of "AI & automation" on the desktop (plan KI-Harness
 * §19.1): add a provider, store a key, choose a profile's model. Every
 * provider is offered with its hint; nothing is hidden or disabled.
 */

function openUrl(url: string) {
  void getPlatformServices().openExternal(url);
}

/** Add a provider: every one is selectable, each with its terms as a hint. */
export function AiAddProviderDialog({ session, state, onClose, onAdded }: { session: AiSession; state: AiState; onClose: () => void; onAdded: (provider: ProviderInfo) => void }) {
  const { t } = useTranslation();
  const groups = addableProviders(state, { localServers: true });
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [declined, setDeclined] = useState(false);
  const normalized = url.trim() ? normalizeBaseUrl(url) : null;

  const pick = (provider: ProviderInfo) => {
    void session.addProvider(provider.id).then(() => onAdded(provider));
  };
  const addCustom = () => {
    if (!normalized) return;
    const id = customEndpointId(state.settings.custom.map((c) => c.id));
    void session.addCustom(name.trim() || new URL(normalized.baseUrl).host, normalized.baseUrl, id, normalized.local).then((added) => {
      if (!added) {
        setDeclined(true);
        return;
      }
      const provider = providerById(id, session.getState().settings.custom);
      if (provider) onAdded(provider);
    });
  };

  const tile = (provider: ProviderInfo) => (
    <div key={provider.id} className="pv-ai-tile">
      <div className="pv-ai-tilehead">
        <span className="pv-ai-tilename">{provider.label}</span>
        <Button size="sm" variant="tonal" onClick={() => pick(provider)} data-testid={`ai-add-${provider.id}`}>
          {t("ai.add.choose")}
        </Button>
      </div>
      {provider.hints.map((hint) => (
        <p key={hint} className={provider.id === "gemini" ? "pv-ai-tilehint is-note" : "pv-ai-tilehint"}>
          {t(hint)}
        </p>
      ))}
      {provider.keyUrl && (
        <Button size="sm" variant="ghost" onClick={() => openUrl(provider.keyUrl!)}>
          {provider.kind === "local" ? t("ai.add.download", { provider: provider.label }) : t("ai.settings.getKey", { provider: provider.label })}
        </Button>
      )}
    </div>
  );

  return (
    <Modal title={t("ai.add.title")} onClose={onClose} size="lg" testId="ai-add-provider">
      <div className="pv-ai-add">
        <p className="pv-ai-lead">{t("ai.add.lead")}</p>
        {groups.cloud.length > 0 && <h4 className="pv-ai-grouphead">{t("ai.add.cloud")}</h4>}
        {groups.cloud.map(tile)}
        <h4 className="pv-ai-grouphead">{t("ai.add.gateways")}</h4>
        {groups.gateways.map(tile)}
        <div className="pv-ai-tile">
          <div className="pv-ai-tilehead">
            <span className="pv-ai-tilename">{t("ai.add.custom")}</span>
            {!custom && (
              <Button size="sm" variant="tonal" onClick={() => setCustom(true)} data-testid="ai-add-custom">
                {t("ai.add.choose")}
              </Button>
            )}
          </div>
          <p className="pv-ai-tilehint">{t("ai.add.customDesc")}</p>
          {custom && (
            <div className="pv-ai-form">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ai.add.customName")} aria-label={t("ai.add.customName")} />
              <TextInput value={url} onChange={(e) => { setUrl(e.target.value); setDeclined(false); }} placeholder="https://…/v1" aria-label={t("ai.add.customUrl")} data-testid="ai-add-url" />
              <p className="pv-ai-tilehint">{url.trim() && !normalized ? t("ai.add.invalidUrl") : t("ai.add.customUrlHint")}</p>
              {declined && <Banner kind="info" rounded>{t("ai.add.declined")}</Banner>}
              <Button size="sm" variant="primary" disabled={!normalized} onClick={addCustom} data-testid="ai-add-custom-save">
                {t("ai.add.confirmAction")}
              </Button>
            </div>
          )}
        </div>
        {groups.local.length > 0 && <h4 className="pv-ai-grouphead">{t("ai.add.local")}</h4>}
        {groups.local.map(tile)}
        <div className="pv-ai-nokey">
          <h4 className="pv-ai-grouphead">{t("ai.add.noKeyTitle")}</h4>
          <p className="pv-ai-tilehint">{t("ai.add.noKeyBody")}</p>
        </div>
      </div>
    </Modal>
  );
}

/** Store a key: it goes into the keychain through the native egress and never comes back. */
export function AiKeyDialog({ session, provider, onClose }: { session: AiSession; provider: ProviderInfo; onClose: () => void }) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const save = () => {
    if (!key.trim()) return;
    setBusy(true);
    void session
      .setKey(provider.id, key)
      .then(() => session.testProvider(provider.id))
      // The secure store refused (locked keychain, no space): say so rather
      // than close as if the key were stored. The message never holds the key.
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        setKey("");
        setBusy(false);
        onClose();
      });
  };
  return (
    <Modal
      title={t("ai.settings.keyTitle", { provider: provider.label })}
      onClose={onClose}
      testId="ai-key-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!key.trim() || busy} onClick={save} data-testid="ai-key-save">{t("ai.settings.keySave")}</Button>
        </>
      }
    >
      <div className="pv-ai-form">
        <TextInput
          type="password"
          autoComplete="off"
          purpose="secret"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder={t("ai.settings.keyField")}
          aria-label={t("ai.settings.keyField")}
          data-testid="ai-key-input"
        />
        <p className="pv-ai-tilehint">{t("ai.settings.keyHint")}</p>
        {provider.keyUrl && (
          <Button size="sm" variant="ghost" onClick={() => openUrl(provider.keyUrl!)}>
            {t("ai.settings.getKey", { provider: provider.label })}
          </Button>
        )}
      </div>
    </Modal>
  );
}

/** Choose a profile's model: from the provider's own list, or any id typed in. */
export function AiModelDialog({ session, state, profile, onClose }: { session: AiSession; state: AiState; profile: AiProfileSlot; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const current = state.settings.profiles[profile];
  const providers = useMemo(() => session.providers().filter((p) => state.settings.providers.includes(p.id) || p.custom || state.keys[p.id] || p.id === current?.providerId), [session, state, current]);
  const [providerId, setProviderId] = useState(current?.providerId ?? providers[0]?.id ?? "");
  const [model, setModel] = useState(current?.model ?? "");
  // What the user says about a model on a server of this device (plan KI-Harness P7): its window, and whether it
  // takes tools. Such a server names its models and nothing about them; a provider's list and the system's own
  // model say both themselves, and neither is asked of a model that transcribes or embeds.
  const [windowText, setWindowText] = useState(current?.contextTokens ? String(current.contextTokens) : "");
  const [tools, setTools] = useState(current?.tools !== false);
  const provider = providers.find((p) => p.id === providerId);
  const stating = !describesItself(provider) && profile !== AI_AUDIO_PROFILE && profile !== AI_EMBEDDING_PROFILE;
  const stated = readStatedWindow(windowText);
  const number = new Intl.NumberFormat(i18n.language);
  const test = state.tests[providerId];
  // "Audio" lists what can transcribe, "Embeddings" what embeds, every other profile what can chat. Any id can still be typed.
  const fits = (m: { chat: boolean; transcribe?: boolean; embed?: boolean }) =>
    profile === AI_AUDIO_PROFILE ? Boolean(m.transcribe) : profile === AI_EMBEDDING_PROFILE ? Boolean(m.embed) : m.chat;
  const models = (test?.models ?? []).filter((m) => fits(m) && (!model.trim() || m.id.toLowerCase().includes(model.trim().toLowerCase()) || (m.label ?? "").toLowerCase().includes(model.trim().toLowerCase())));
  const save = () => {
    if (!providerId || !model.trim() || (stating && !stated.ok)) return;
    const named = { providerId, model: model.trim() };
    const choice = stating && stated.ok ? statedChoice(provider, named, { window: stated.value, tools }) : named;
    void session.updateSettings((s) => ({ ...s, profiles: { ...s.profiles, [profile]: choice } })).then(onClose);
  };
  const clear = () => {
    void session
      .updateSettings((s) => ({ ...s, profiles: Object.fromEntries(Object.entries(s.profiles).filter(([id]) => id !== profile)) }))
      .then(onClose);
  };
  return (
    <Modal
      title={t("ai.settings.modelTitle", { profile: t(`ai.profile.${profile}`) })}
      onClose={onClose}
      testId="ai-model-dialog"
      footer={
        <>
          {current && <Button variant="ghost" onClick={clear}>{t("ai.settings.clearProfile")}</Button>}
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!providerId || !model.trim() || (stating && !stated.ok)} onClick={save} data-testid="ai-model-save">{t("common.save")}</Button>
        </>
      }
    >
      <div className="pv-ai-form">
        <Select
          ariaLabel={t("ai.settings.provider")}
          value={providerId}
          minWidth="100%"
          options={providers.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(id) => setProviderId(id)}
        />
        <TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder={t("ai.settings.modelPlaceholder")} aria-label={t("ai.settings.model")} purpose="code" data-testid="ai-model-input" />
        <div className="pv-ai-modelhead">
          <span className="pv-ai-tilehint">{t("ai.settings.modelFromList")}</span>
          <Button size="sm" variant="ghost" disabled={!providerId || test?.state === "testing"} onClick={() => void session.testProvider(providerId)}>
            {test?.state === "testing" ? t("ai.settings.testing") : t("ai.settings.loadModels")}
          </Button>
        </div>
        {models.length > 0 && (
          <div className="pv-ai-models" role="listbox" aria-label={t("ai.settings.modelFromList")}>
            {models.slice(0, 60).map((m) => (
              <Button key={m.id} size="sm" variant={m.id === model ? "tonal" : "ghost"} role="option" aria-selected={m.id === model} onClick={() => setModel(m.id)}>
                {m.label && m.label !== m.id ? `${m.label} · ${m.id}` : m.id}
              </Button>
            ))}
          </div>
        )}
        {stating && (
          <>
            <label className="pv-modal-label" htmlFor="pv-ai-model-window">
              {t("ai.settings.modelWindow")}
            </label>
            <TextInput
              id="pv-ai-model-window"
              value={windowText}
              onChange={(e) => setWindowText(e.target.value)}
              placeholder={t("ai.settings.modelWindowPlaceholder")}
              purpose="number"
              inputMode="numeric"
              data-testid="ai-model-window"
            />
            <p className="pv-ai-tilehint" data-testid="ai-model-window-hint">
              {stated.ok ? t("ai.settings.modelWindowDesc") : t("ai.settings.modelWindowInvalid", { min: number.format(STATED_WINDOW_BOUNDS.min), max: number.format(STATED_WINDOW_BOUNDS.max) })}
            </p>
            <span className="pv-ai-notewithaction">
              <span className="pv-modal-label">{t("ai.settings.modelTools")}</span>
              <Switch checked={tools} label={t("ai.settings.modelTools")} onChange={setTools} data-testid="ai-model-tools" />
            </span>
            <p className="pv-ai-tilehint">{t("ai.settings.modelToolsDesc")}</p>
            <p className="pv-ai-tilehint">{t("ai.settings.modelFactsHint")}</p>
          </>
        )}
        <p className="pv-ai-tilehint">{t("ai.settings.profilesHint")}</p>
      </div>
    </Modal>
  );
}
