import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AI_AUDIO_PROFILE, AI_EMBEDDING_PROFILE, providerById, sameStoredValue, type AiProfileSlot, type ModelChoice } from "@plainva/core";
import {
  Button,
  describesItself,
  readStatedWindow,
  Row,
  RowList,
  GroupCard,
  SearchField,
  Segmented,
  statedChoice,
  STATED_WINDOW_BOUNDS,
  Switch,
  TextInput,
  type AiSession,
  type AiState,
  type ProviderRowModel,
} from "@plainva/ui";
import { ChoiceMark } from "./ChoiceMark";
import { SheetGrip } from "./SheetGrip";
import { useSheetGuard } from "../hooks/useSheetGuard";

/**
 * A profile's model on the phone (plan KI-Oberflächen K4): one sheet instead
 * of a chain of up to five dialogs — the provider, the provider's list with a
 * search, an id typed in, and for a server in the user's network its window
 * and whether it takes tools — with "Clear profile" as on the desktop's
 * dialog (`AiModelDialog`). Cancelling anywhere keeps what was there.
 */
export function AiModelSheet({ session, state, rows, profile, onClose }: { session: AiSession; state: AiState; rows: readonly ProviderRowModel[]; profile: AiProfileSlot; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const settings = state.settings;
  const current = settings.profiles[profile];
  const [providerId, setProviderId] = useState(current?.providerId ?? rows[0]?.provider.id ?? "");
  const [model, setModel] = useState(current?.model ?? "");
  const [query, setQuery] = useState("");
  const [windowText, setWindowText] = useState(current?.contextTokens ? String(current.contextTokens) : "");
  const [tools, setTools] = useState(current?.tools !== false);
  // Whatever differs from what the sheet opened with is asked about before the sheet closes.
  const [opened] = useState(() => ({ providerId, model, windowText, tools }));
  const close = useSheetGuard("ai-model", !sameStoredValue({ providerId, model, windowText, tools }, opened), onClose);
  const provider = providerById(providerId, settings.custom);
  const stating = !describesItself(provider) && profile !== AI_AUDIO_PROFILE && profile !== AI_EMBEDDING_PROFILE;
  const stated = readStatedWindow(windowText);
  const number = new Intl.NumberFormat(i18n.language);
  const test = state.tests[providerId];
  // "Audio" lists what can transcribe, "Embeddings" what embeds, every other profile what can chat. Any id can still be typed.
  const models = useMemo(() => {
    const fits = (m: { chat: boolean; transcribe?: boolean; embed?: boolean }) => (profile === AI_AUDIO_PROFILE ? Boolean(m.transcribe) : profile === AI_EMBEDDING_PROFILE ? Boolean(m.embed) : m.chat);
    const needle = query.trim().toLowerCase();
    return (test?.models ?? []).filter((m) => fits(m) && (!needle || m.id.toLowerCase().includes(needle) || (m.label ?? "").toLowerCase().includes(needle)));
  }, [test, profile, query]);

  // The provider's list comes with its test: asked when the sheet shows a provider whose list is not there yet
  // (tests start empty with every launch), as the old chain of dialogs did.
  const listed = state.tests[providerId]?.state;
  useEffect(() => {
    if (providerId && listed !== "ok" && listed !== "testing") void session.testProvider(providerId);
    // Asked once per provider shown; a failed test is asked again by the row below, not in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, session]);
  const pickProvider = (id: string) => {
    setProviderId(id);
    setModel("");
  };
  const save = () => {
    if (!providerId || !model.trim() || (stating && !stated.ok)) return;
    const named = { providerId, model: model.trim() };
    const choice: ModelChoice = stating && stated.ok ? statedChoice(provider, named, { window: stated.value, tools }) : named;
    void session.updateSettings((s) => ({ ...s, profiles: { ...s.profiles, [profile]: choice } })).then(onClose);
  };
  const clear = () => {
    void session.updateSettings((s) => ({ ...s, profiles: Object.fromEntries(Object.entries(s.profiles).filter(([id]) => id !== profile)) })).then(onClose);
  };

  return (
    <div className="m-sheet-backdrop" onClick={close}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-model-sheet">
        <SheetGrip onClose={close} />
        <p className="m-sheet-title">{t("ai.settings.modelTitle", { profile: t(`ai.profile.${profile}`) })}</p>
        {rows.length > 1 && (
          <Segmented<string>
            ariaLabel={t("ai.settings.provider")}
            value={providerId}
            onChange={pickProvider}
            options={rows.map((row) => ({ value: row.provider.id, label: row.provider.label }))}
          />
        )}
        <SearchField value={query} onValueChange={setQuery} placeholder={t("ai.settings.modelSearch")} aria-label={t("ai.settings.modelSearch")} clearLabel={t("ai.history.clearSearch")} />
        <GroupCard>
          <RowList>
            {test?.state === "testing" && <Row title={t("ai.settings.testing")} />}
            {models.slice(0, 60).map((m) => (
              <Row
                key={m.id}
                title={m.label ?? m.id}
                subtitle={m.label && m.label !== m.id ? m.id : undefined}
                end={<ChoiceMark on={m.id === model} />}
                onClick={() => setModel(m.id)}
                data-testid="ai-model-option"
              />
            ))}
            {test?.state !== "testing" && models.length === 0 && <Row wrap title={t("ai.settings.modelNoList")} />}
            {test?.state !== "testing" && <Row title={t("ai.settings.loadModels")} onClick={() => void session.testProvider(providerId)} data-testid="ai-model-reload" />}
          </RowList>
        </GroupCard>
        <label className="m-hint" htmlFor="m-ai-model-id">
          {t("ai.settings.modelOwnId")}
        </label>
        <TextInput id="m-ai-model-id" value={model} onChange={(e) => setModel(e.target.value)} placeholder={t("ai.settings.modelPlaceholder")} purpose="code" data-testid="ai-model-input" />
        {/* What the user says about a model on a server of this network (plan KI-Harness P7). */}
        {stating && (
          <>
            <label className="m-hint" htmlFor="m-ai-model-window">
              {t("ai.settings.modelWindow")}
            </label>
            <TextInput
              id="m-ai-model-window"
              value={windowText}
              onChange={(e) => setWindowText(e.target.value)}
              placeholder={t("ai.settings.modelWindowPlaceholder")}
              purpose="number"
              inputMode="numeric"
              data-testid="ai-model-window"
            />
            <p className="m-hint">
              {stated.ok ? t("ai.settings.modelWindowDesc") : t("ai.settings.modelWindowInvalid", { min: number.format(STATED_WINDOW_BOUNDS.min), max: number.format(STATED_WINDOW_BOUNDS.max) })}
            </p>
            <GroupCard>
              <RowList>
                <Row wrap title={t("ai.settings.modelTools")} subtitle={t("ai.settings.modelToolsDesc")} end={<Switch checked={tools} label={t("ai.settings.modelTools")} onChange={setTools} testId="ai-model-tools" />} />
              </RowList>
            </GroupCard>
          </>
        )}
        <Button variant="primary" disabled={!providerId || !model.trim() || (stating && !stated.ok)} onClick={save} data-testid="ai-model-save">
          {t("common.save")}
        </Button>
        {current && (
          <Button variant="ghost" onClick={clear} data-testid="ai-profile-clear">
            {t("ai.settings.clearProfile")}
          </Button>
        )}
      </div>
    </div>
  );
}
