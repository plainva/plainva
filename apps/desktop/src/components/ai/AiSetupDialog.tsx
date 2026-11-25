import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, getPlatformServices, Modal, Radio, TextInput, useDiscardGuard, WizardSteps } from "@plainva/ui";
import { configuredProviders, useAiSetupFlow, type AiSession } from "@plainva/ui/ai";
import { AiModelDialog } from "../settings/AiDialogs";

/**
 * The AI setup on the desktop in three steps (plan Oberfläche O7, T9; plan Umsetzung 0.9.x, B7): the dialog over
 * the same steps the phone's sheet draws (`useAiSetupFlow`) — what the AI computes with (a provider with a key of
 * one's own, or an own server such as Ollama or LM Studio; a computer brings no system model), the way in, and a
 * first "Hello" whose answer arrives in the conversation. "Set up" in a conversation opens it while a step is
 * missing; the settings page stays where everything can be changed later.
 */
export function AiSetupDialog({ session, onClose }: { session: AiSession; onClose: () => void }) {
  const { t } = useTranslation();
  const flow = useAiSetupFlow(session, t, null);
  const [choosingModel, setChoosingModel] = useState(false);
  const close = useDiscardGuard(flow.dirty, onClose);
  const { state, offer, step, kind, cloud } = flow;
  const settings = state.settings;
  const defaultChoice = settings.profiles[settings.defaultProfile];
  const label = (s: 1 | 2 | 3) => (s === 1 ? t("ai.setup.stepProvider") : s === 2 ? t("ai.setup.stepAccess") : t("ai.setup.stepHello"));

  const footer = (
    <>
      {/* Every step but the first has its way back (review O7, O2): a provider that failed is changed or replaced there. */}
      {step === 1 ? (
        <Button variant="ghost" onClick={close} data-testid="ai-setup-cancel">
          {t("common.cancel")}
        </Button>
      ) : (
        <Button variant="ghost" disabled={flow.busy} onClick={flow.back} data-testid="ai-setup-back">
          {t("common.back")}
        </Button>
      )}
      {step === 3 ? (
        <Button variant="primary" disabled={!defaultChoice} onClick={() => flow.sayHello(onClose)} data-testid="ai-setup-hello">
          {t("ai.setup.helloAction")}
        </Button>
      ) : (
        <Button variant="primary" disabled={flow.busy || (step === 2 && !flow.ready)} onClick={() => void flow.next()} data-testid="ai-setup-next">
          {t("common.next")}
        </Button>
      )}
    </>
  );

  return (
    <>
      <Modal title={t("ai.empty.setupAction")} onClose={close} size="md" footer={footer} testId="ai-setup-dialog">
        <WizardSteps
          label={t("ai.setup.stepsLabel")}
          testId="ai-setup-steps"
          steps={([1, 2, 3] as const).map((s) => ({ key: String(s), label: label(s), state: s < step ? "done" : s === step ? "active" : "pending" }))}
        />

        {step === 1 && (
          <div className="pv-ai-form" role="radiogroup" aria-label={t("ai.setup.providerQuestion")}>
            <p className="pv-ai-grouphead">{t("ai.setup.providerQuestion")}</p>
            {offer.kinds.map((k) => (
              <Radio
                key={k}
                name="ai-setup-kind"
                checked={kind === k}
                onChange={() => flow.setKind(k)}
                label={
                  <span>
                    {t(`ai.setup.kind.${k}`)}
                    <span className="pv-ai-tilehint"> — {t(`ai.setup.kind.${k}Desc`)}</span>
                  </span>
                }
                data-testid={`ai-setup-kind-${k}`}
              />
            ))}
          </div>
        )}

        {step === 2 && kind === "cloud" && (
          <>
            <div className="pv-ai-form" role="radiogroup" aria-label={t("ai.setup.accessCloud")}>
              <p className="pv-ai-grouphead">{t("ai.setup.accessCloud")}</p>
              {offer.cloud.map((p) => (
                <Radio key={p.id} name="ai-setup-cloud" checked={flow.cloudId === p.id} onChange={() => flow.setCloudId(p.id)} label={p.label} data-testid="ai-setup-cloud" />
              ))}
            </div>
            {cloud?.endpoint.needsKey && (
              <>
                <label className="pv-ai-tilehint" htmlFor="pv-ai-setup-key">
                  {state.keys[cloud.id] ? t("ai.setup.keyStored") : t("ai.settings.keyField")}
                </label>
                <TextInput id="pv-ai-setup-key" type="password" value={flow.key} onChange={(e) => flow.setKey(e.target.value)} placeholder={t("ai.settings.keyField")} data-testid="ai-setup-key" />
                <p className="pv-ai-tilehint">{t("ai.settings.keyHint")}</p>
                {cloud.keyUrl && (
                  <Button variant="ghost" onClick={() => void getPlatformServices().openExternal(cloud.keyUrl!)} data-testid="ai-setup-getkey">
                    {t("ai.settings.getKey", { provider: cloud.label })}
                  </Button>
                )}
              </>
            )}
          </>
        )}

        {step === 2 && kind === "server" && (
          <>
            <p className="pv-ai-grouphead">{t("ai.setup.accessServer")}</p>
            <label className="pv-ai-tilehint" htmlFor="pv-ai-setup-address">
              {t("ai.add.custom")}
            </label>
            <TextInput id="pv-ai-setup-address" value={flow.address} onChange={(e) => flow.setAddress(e.target.value)} placeholder="https://…/v1" inputMode="url" data-testid="ai-setup-address" />
            <p className="pv-ai-tilehint">{t("ai.add.customUrlHint")}</p>
          </>
        )}

        {step === 3 && (
          <>
            <p className="pv-ai-grouphead">{t("ai.setup.helloQuestion")}</p>
            <div className="pv-ai-notewithaction">
              <span>
                {t(`ai.profile.${settings.defaultProfile}`)}
                {" · "}
                {defaultChoice ? `${session.providers().find((p) => p.id === defaultChoice.providerId)?.label ?? defaultChoice.providerId} · ${defaultChoice.model}` : t("ai.setup.chooseModel")}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setChoosingModel(true)} data-testid="ai-setup-model">
                {defaultChoice ? t("ai.settings.change") : t("ai.setup.chooseModel")}
              </Button>
            </div>
            <p className="pv-ai-tilehint">{t("ai.setup.helloBody", { word: t("ai.setup.helloMessage") })}</p>
          </>
        )}

        {flow.problem && (
          <p className="pv-ai-tilehint is-note" role="alert" data-testid="ai-setup-problem">
            {flow.problem}
          </p>
        )}
        <p className="pv-ai-tilehint">{t("ai.setup.later")}</p>
      </Modal>
      {choosingModel && configuredProviders(state).length > 0 && (
        <AiModelDialog session={session} state={state} profile={settings.defaultProfile} onClose={() => setChoosingModel(false)} />
      )}
    </>
  );
}
