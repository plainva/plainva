import { useState, useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { useTranslation } from "react-i18next";
import { customEndpointId, normalizeBaseUrl, providerById, type ProviderInfo } from "@plainva/core";
import {
  aiFailureText,
  aiSetupOffer,
  aiSetupStart,
  AreaBoundary,
  Button,
  configuredProviders,
  failureRecipient,
  getPlatformServices,
  GroupCard,
  Row,
  RowList,
  startAiConversation,
  TextInput,
  WizardSteps,
  type AiSetupKind,
} from "@plainva/ui";
import { ChoiceMark } from "./ChoiceMark";
import { SheetGrip } from "./SheetGrip";
import { AiModelSheet } from "./AiModelSheet";
import { useSheetGuard } from "../hooks/useSheetGuard";
import { getMobileAiSession } from "../services/ai/mobileAi";
import { PlatformModel } from "../platform/platformModel";

function platformOs(): "ios" | "android" | null {
  const p = Capacitor.getPlatform();
  return p === "ios" || p === "android" ? p : null;
}

type Step = 1 | 2 | 3;

/**
 * The AI setup on the phone in three steps (plan Oberfläche O7, T9; mockup
 * M7): what the AI computes with — the phone's own model, a provider with a
 * key of one's own, or an own server —, the way in, and a first "Hello"
 * whose answer arrives in the conversation. It replaces the long settings
 * page as the way from "Set up" to the first answer; the page stays where
 * everything can be changed later. Nothing is stored before "Next" of the
 * step that stores it: a key goes into the device's secure store, an
 * address through the system's own confirmation, as on the settings page.
 */
export function AiSetupSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const offer = aiSetupOffer(state, platformOs());
  const [start] = useState(() => aiSetupStart(session.getState()));
  const [step, setStep] = useState<Step>(start.step);
  const [kind, setKind] = useState<AiSetupKind>(() => {
    const first = start.providerId ? providerById(start.providerId, session.getState().settings.custom) : null;
    return first?.kind === "platform-device" ? "device" : first?.custom ? "server" : first ? "cloud" : offer.kinds[0]!;
  });
  const [cloudId, setCloudId] = useState(() => (start.providerId && offer.cloud.some((p) => p.id === start.providerId) ? start.providerId : (offer.cloud[0]?.id ?? "")));
  const [key, setKey] = useState("");
  // A server that is set up but cannot answer is shown with its address, to be corrected (review O7, O2).
  const [address, setAddress] = useState(() => (start.providerId ? (session.getState().settings.custom.find((c) => c.id === start.providerId)?.baseUrl ?? "") : ""));
  const [providerId, setProviderId] = useState<string | null>(start.providerId);
  const [busy, setBusy] = useState(false);
  // Begun at a provider that failed: what went wrong stands there from the start.
  const [problem, setProblem] = useState<string | null>(() => {
    const failed = start.providerId ? session.getState().tests[start.providerId] : undefined;
    const info = start.providerId ? providerById(start.providerId, session.getState().settings.custom) : null;
    return failed?.state === "failed" && failed.failure && info ? aiFailureText(t, failed.failure, failureRecipient(info)) : null;
  });
  const [choosingModel, setChoosingModel] = useState(false);
  const settings = state.settings;
  /** The server this setup works on — the one it began with, or the one it added —, as stored. */
  const server = providerId ? (settings.custom.find((c) => c.id === providerId) ?? null) : null;
  // A key typed, or an address that is not the stored one, is asked about before the sheet goes (review O7, second
  // round): a server's own address shown to be corrected is nothing unsaved.
  const typedAddress = address.trim() ? (normalizeBaseUrl(address)?.baseUrl ?? address.trim()) : "";
  const close = useSheetGuard("ai-setup", Boolean(key.trim() || (typedAddress && typedAddress !== server?.baseUrl)), onClose);

  const provider = providerId ? providerById(providerId, settings.custom) : null;
  const test = providerId ? state.tests[providerId] : undefined;
  const defaultChoice = settings.profiles[settings.defaultProfile];
  const cloud = offer.cloud.find((p) => p.id === cloudId) ?? null;

  /** Tests the provider that step 2 set up; on success the setup goes on to the first Hello. */
  const tested = async (id: string) => {
    setProviderId(id);
    const result = await session.testProvider(id);
    const info = providerById(id, session.getState().settings.custom);
    if (result.state === "ok") {
      setProblem(null);
      setStep(3);
    } else if (result.failure && info) {
      setProblem(aiFailureText(t, result.failure, failureRecipient(info)));
    }
  };

  const next = async () => {
    setProblem(null);
    if (step === 1) {
      setStep(2);
      if (kind === "device" && offer.device) {
        // The system's model needs nothing typed: it is put on the list and asked whether it is there.
        await session.addProvider(offer.device.id);
        void tested(offer.device.id);
      }
      return;
    }
    if (step !== 2) return;
    setBusy(true);
    try {
      if (kind === "device" && offer.device) await tested(offer.device.id);
      else if (kind === "cloud" && cloud) {
        await session.addProvider(cloud.id);
        if (cloud.endpoint.needsKey && key.trim()) await session.setKey(cloud.id, key);
        setKey("");
        await tested(cloud.id);
      } else if (kind === "server") {
        const normalized = normalizeBaseUrl(address);
        if (!normalized) {
          setProblem(t("ai.add.invalidUrl"));
          return;
        }
        // The server this setup works on, at the same address: asked again, not added a second time.
        if (server && server.baseUrl === normalized.baseUrl) {
          await tested(server.id);
          return;
        }
        // A corrected address replaces the server it corrects (review O7, second round): the broken one does not stay
        // in the list beside a second.
        const id = server?.id ?? customEndpointId(settings.custom.map((c) => c.id));
        // The system's own confirmation names the address before anything can go there (as on the settings page).
        const added = await session.addCustom(new URL(normalized.baseUrl).host, normalized.baseUrl, id, normalized.local);
        if (!added) return;
        // The address stays in the field: if the server cannot answer, it is there to be corrected.
        await tested(id);
      }
    } catch (error) {
      // The secure store refused the key: said, never with the key in it.
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  /** The first Hello: a new conversation with one word, whose answer — after the send overview — is the setup's end. */
  const sayHello = () => {
    onClose();
    // An answer still under way says so instead (Befunde 06.11., B6); the hello waits for the person then.
    if (startAiConversation(session, t)) void session.sendGreeting(t("ai.setup.helloMessage"));
  };

  const loadDeviceModel = async (device: ProviderInfo) => {
    setBusy(true);
    try {
      await PlatformModel.download();
    } catch {
      setProblem(t("ai.settings.loadPlatformFailed", { provider: device.label }));
    } finally {
      setBusy(false);
    }
    void tested(device.id);
  };

  const ready2 = kind === "device" ? test?.state === "ok" : kind === "cloud" ? Boolean(cloud && (!cloud.endpoint.needsKey || key.trim() || state.keys[cloud.id])) : Boolean(address.trim());
  const deviceLoadable = kind === "device" && test?.state === "failed" && test.failure?.kind === "platform_unavailable" && test.failure.reason === "downloadable";
  const label = (s: Step) => (s === 1 ? t("ai.setup.stepProvider") : s === 2 ? t("ai.setup.stepAccess") : t("ai.setup.stepHello"));

  return (
    <>
    <div className="m-sheet-backdrop" onClick={close}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-setup-sheet">
              <SheetGrip onClose={close} />
              <WizardSteps
                layout="stacked"
                label={t("ai.setup.stepsLabel")}
                testId="ai-setup-steps"
                steps={([1, 2, 3] as const).map((s) => ({ key: String(s), label: label(s), state: s < step ? "done" : s === step ? "active" : "pending" }))}
              />

              {step === 1 && (
                <>
                  <p className="m-sheet-title">{t("ai.setup.providerQuestion")}</p>
                  <GroupCard>
                    <RowList>
                      {offer.kinds.map((k) => (
                        <Row
                          key={k}
                          wrap
                          title={t(`ai.setup.kind.${k}`)}
                          subtitle={t(`ai.setup.kind.${k}Desc`)}
                          end={<ChoiceMark on={kind === k} />}
                          onClick={() => setKind(k)}
                          data-testid={`ai-setup-kind-${k}`}
                        />
                      ))}
                    </RowList>
                  </GroupCard>
                </>
              )}

              {step === 2 && kind === "cloud" && (
                <>
                  <p className="m-sheet-title">{t("ai.setup.accessCloud")}</p>
                  <GroupCard>
                    <RowList>
                      {offer.cloud.map((p) => (
                        <Row key={p.id} title={p.label} end={<ChoiceMark on={cloudId === p.id} />} onClick={() => setCloudId(p.id)} data-testid="ai-setup-cloud" />
                      ))}
                    </RowList>
                  </GroupCard>
                  {cloud?.endpoint.needsKey && (
                    <>
                      <label className="m-hint" htmlFor="m-ai-setup-key">
                        {state.keys[cloud.id] ? t("ai.setup.keyStored") : t("ai.settings.keyField")}
                      </label>
                      <TextInput id="m-ai-setup-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t("ai.settings.keyField")} purpose="secret" data-testid="ai-setup-key" />
                      <p className="m-hint">{t("ai.settings.keyHint")}</p>
                      {cloud.keyUrl && (
                        <Button variant="ghost" onClick={() => void getPlatformServices().openExternal(cloud.keyUrl!)} data-testid="ai-setup-getkey">
                          {t("ai.settings.getKey", { provider: cloud.label })}
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}

              {step === 2 && kind === "device" && offer.device && (
                <>
                  <p className="m-sheet-title">{t("ai.setup.accessDevice")}</p>
                  <GroupCard>
                    <RowList>
                      <Row
                        wrap
                        title={offer.device.label}
                        subtitle={
                          test?.state === "testing" || !test
                            ? t("ai.settings.testing")
                            : test.state === "ok"
                              ? t("ai.setup.deviceReady")
                              : test.failure
                                ? aiFailureText(t, test.failure, failureRecipient(offer.device))
                                : t("ai.settings.onDevice")
                        }
                        data-testid="ai-setup-device"
                      />
                    </RowList>
                  </GroupCard>
                  {offer.device.hints.map((hint) => (
                    <p key={hint} className="m-hint">
                      {t(hint)}
                    </p>
                  ))}
                  {deviceLoadable && (
                    <Button variant="secondary" disabled={busy} onClick={() => void loadDeviceModel(offer.device!)} data-testid="ai-setup-device-load">
                      {t("ai.settings.loadPlatformModel")}
                    </Button>
                  )}
                </>
              )}

              {step === 2 && kind === "server" && (
                <>
                  <p className="m-sheet-title">{t("ai.setup.accessServer")}</p>
                  <label className="m-hint" htmlFor="m-ai-setup-address">
                    {t("ai.add.custom")}
                  </label>
                  <TextInput id="m-ai-setup-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://…/v1" purpose="address" inputMode="url" data-testid="ai-setup-address" />
                  <p className="m-hint">{t("ai.add.customUrlHint")}</p>
                </>
              )}

              {step === 3 && (
                <>
                  <p className="m-sheet-title">{t("ai.setup.helloQuestion")}</p>
                  <GroupCard>
                    <RowList>
                      <Row
                        wrap
                        title={t(`ai.profile.${settings.defaultProfile}`)}
                        subtitle={defaultChoice ? `${providerById(defaultChoice.providerId, settings.custom)?.label ?? defaultChoice.providerId} · ${defaultChoice.model}` : t("ai.setup.chooseModel")}
                        onClick={() => setChoosingModel(true)}
                        data-testid="ai-setup-model"
                      />
                    </RowList>
                  </GroupCard>
                  <p className="m-hint">{t("ai.setup.helloBody", { word: t("ai.setup.helloMessage") })}</p>
                </>
              )}

              {problem && (
                <p className="m-hint m-ai-setup-problem" role="alert" data-testid="ai-setup-problem">
                  {problem}
                </p>
              )}
              <p className="m-hint">{t("ai.setup.later")}</p>
              <div className="m-ai-setup-foot">
                {/* Every step but the first has its way back (review O7, O2): a provider that failed is changed or replaced there. */}
                {step === 1 ? (
                  <Button variant="ghost" onClick={close} data-testid="ai-setup-cancel">
                    {t("common.cancel")}
                  </Button>
                ) : (
                  <Button variant="ghost" disabled={busy} onClick={() => { setProblem(null); setStep(step === 3 ? 2 : 1); }} data-testid="ai-setup-back">
                    {t("common.back")}
                  </Button>
                )}
                {step === 3 ? (
                  <Button variant="primary" disabled={!defaultChoice} onClick={sayHello} data-testid="ai-setup-hello">
                    {t("ai.setup.helloAction")}
                  </Button>
                ) : (
                  <Button variant="primary" disabled={busy || (step === 2 && !ready2)} onClick={() => void next()} data-testid="ai-setup-next">
                    {t("common.next")}
                  </Button>
                )}
              </div>
      </div>
    </div>
    {choosingModel && provider && (
      <AreaBoundary area="sheet:aiSetupModel" size="dialog" exit={{ label: t("common.close"), onExit: () => setChoosingModel(false) }}>
        {() => <AiModelSheet session={session} state={state} rows={configuredProviders(state)} profile={settings.defaultProfile} onClose={() => setChoosingModel(false)} />}
      </AreaBoundary>
    )}
    </>
  );
}
