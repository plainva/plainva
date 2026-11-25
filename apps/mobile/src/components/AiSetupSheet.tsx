import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useTranslation } from "react-i18next";
import { providerById, type ProviderInfo } from "@plainva/core/ai";
import {
  AreaBoundary,
  Button,
  getPlatformServices,
  GroupCard,
  Row,
  RowList,
  TextInput,
  WizardSteps,
} from "@plainva/ui";
import { aiFailureText, configuredProviders, failureRecipient, useAiSetupFlow } from "@plainva/ui/ai";
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
 * everything can be changed later. The steps are the shared `useAiSetupFlow`
 * (plan Umsetzung 0.9.x, B7), which the desktop draws as a dialog.
 */
export function AiSetupSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  const flow = useAiSetupFlow(session, t, platformOs());
  const { state, offer, step, kind, cloud, provider, test, busy, problem } = flow;
  const [choosingModel, setChoosingModel] = useState(false);
  const settings = state.settings;
  const close = useSheetGuard("ai-setup", flow.dirty, onClose);
  const defaultChoice = settings.profiles[settings.defaultProfile];
  const key = flow.key;
  const address = flow.address;
  const cloudId = flow.cloudId;
  const setKind = flow.setKind;
  const setCloudId = flow.setCloudId;
  const setKey = flow.setKey;
  const setAddress = flow.setAddress;
  const next = flow.next;
  const sayHello = () => flow.sayHello(onClose);
  const loadDeviceModel = (_device: ProviderInfo) => flow.loadDeviceModel(() => PlatformModel.download());
  const ready2 = flow.ready;
  const deviceLoadable = flow.deviceLoadable;
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
                  <Button variant="ghost" disabled={busy} onClick={flow.back} data-testid="ai-setup-back">
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
