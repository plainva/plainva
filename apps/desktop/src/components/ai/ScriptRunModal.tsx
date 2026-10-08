import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CodeXml, Copy, Play } from "lucide-react";
import {
  Banner,
  Button,
  ICON,
  Modal,
  ScriptCallList,
  scriptCallLines,
  scriptFieldDefaults,
  scriptFieldInput,
  scriptOutcomeText,
  ScriptOutput,
  scriptTypeLabel,
  scriptUsageLine,
  scriptValueText,
  Select,
  Switch,
  TextInput,
  toast,
  useAiSession,
  useAiState,
  useScriptRun,
  workshopTitle,
  type ScriptFieldValues,
} from "@plainva/ui";

/**
 * A script run from the workshop (plan KI-Harness P5.5, mockup chapter 21):
 * the inputs it asks for, then "Run" or "Dry run". While it runs, each tool
 * call appears as it happens, with a way to stop; afterwards its value and
 * what it used of its limits — or, in words, why it was ended. Started here,
 * it reads the vault on this device and nothing of the run goes to a model.
 * The words come from `scriptsWorkshop.ts` and are the phone's as well.
 */
export function ScriptRunModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const entry = state?.skills.entries.find((e) => e.source.id === id) ?? null;
  const script = entry?.source.script ?? null;
  const [values, setValues] = useState<ScriptFieldValues>(() => scriptFieldDefaults(script?.parameters ?? []));
  const running = useScriptRun(session, state, id);
  if (!session || !state || !entry || !script) return null;
  const { input, missing } = scriptFieldInput(script.parameters, values);
  const run = running.run;
  const outcome = run?.outcome ?? null;
  const ended = outcome ? scriptOutcomeText(t, outcome, script.limits, run?.dry === true, i18n.language) : null;
  const value = outcome ? scriptValueText(outcome) : null;
  const canStart = state.scripts.available && entry.status === "active" && missing.length === 0 && !running.busy;
  const set = (name: string, next: string | boolean) => setValues((current) => ({ ...current, [name]: next }));
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(t("ai.mcp.copied")),
      () => undefined,
    );
  };
  return (
    <Modal
      title={workshopTitle(t, entry)}
      icon={<CodeXml size={ICON.ui} />}
      size="lg"
      onClose={onClose}
      testId="ai-script-run"
      footer={
        running.busy ? (
          <Button variant="ghost" onClick={running.stop} data-testid="ai-script-stop">
            {t("ai.stop")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
            <Button variant="secondary" disabled={!canStart} onClick={() => running.start(input, true)} data-testid="ai-script-dry">
              {t("ai.scripts.run.dry")}
            </Button>
            <Button variant="primary" icon={<Play size={ICON.ui} />} disabled={!canStart} onClick={() => running.start(input, false)} data-testid="ai-script-start">
              {t("ai.scripts.run.start")}
            </Button>
          </>
        )
      }
    >
      <div className="pv-script-form">
        <p className="pv-modal-hint">{script.description}</p>
        {!state.scripts.available && (
          <Banner kind="warning" rounded>
            {t("ai.scripts.unavailable")}
          </Banner>
        )}
        {(running.refused || entry.status !== "active") && (
          <Banner kind="error" rounded testId="ai-script-refused">
            {t("ai.scripts.notActive")}
          </Banner>
        )}
        {script.parameters.map((p) => {
          const fieldId = `pv-script-field-${p.name}`;
          const hint = [p.description, p.options ? null : scriptTypeLabel(t, p.type), t(p.required ? "ai.scripts.required" : "ai.scripts.optional")].filter(Boolean).join(" · ");
          return (
            <div key={p.name} className="pv-script-field">
              {p.type === "boolean" || p.options ? (
                <span className="pv-modal-label">{p.name}</span>
              ) : (
                <label className="pv-modal-label" htmlFor={fieldId}>
                  {p.name}
                </label>
              )}
              {p.type === "boolean" ? (
                <div>
                  <Switch checked={values[p.name] === true} label={p.name} disabled={running.busy} onChange={(on) => set(p.name, on)} data-testid={`ai-script-field-${p.name}`} />
                </div>
              ) : p.options ? (
                <Select value={String(values[p.name] ?? "")} options={p.options.map((option) => ({ value: option, label: option }))} ariaLabel={p.name} disabled={running.busy} onChange={(next) => set(p.name, next)} data-testid={`ai-script-field-${p.name}`} />
              ) : (
                <TextInput
                  id={fieldId}
                  value={String(values[p.name] ?? "")}
                  purpose={p.type === "number" ? "number" : "name"}
                  inputMode={p.type === "number" ? "decimal" : undefined}
                  disabled={running.busy}
                  onChange={(event) => set(p.name, event.target.value)}
                  data-testid={`ai-script-field-${p.name}`}
                />
              )}
              <p className="pv-modal-hint">{hint}</p>
            </div>
          );
        })}
        {!run && <p className="pv-modal-hint">{t("ai.scripts.run.hint")}</p>}
        {run && running.busy && (
          <p className="pv-modal-hint" data-testid="ai-script-running">
            {t("ai.scripts.run.running")}
          </p>
        )}
        {ended && (
          <Banner kind={ended.tone} rounded testId="ai-script-outcome">
            {ended.note ? `${ended.text} ${ended.note}` : ended.text}
          </Banner>
        )}
        {run && (
          <dl className="pv-skill-facts">
            <dt>{t("ai.scripts.run.calls")}</dt>
            <dd>{run.calls.length ? <ScriptCallList lines={scriptCallLines(t, run.calls, i18n.language)} /> : <span>{running.busy ? "…" : t("ai.scripts.run.callsNone")}</span>}</dd>
            {value !== null && (
              <>
                <dt>{t("ai.scripts.run.result")}</dt>
                <dd>
                  <ScriptOutput text={value} testId="ai-script-result" />
                  <span className="pv-ai-rowactions">
                    <Button size="sm" variant="ghost" icon={<Copy size={ICON.ui} />} onClick={() => copy(value)}>
                      {t("common.copy")}
                    </Button>
                  </span>
                </dd>
              </>
            )}
            {outcome && outcome.logs.length > 0 && (
              <>
                <dt>{t("ai.scripts.run.log")}</dt>
                <dd>
                  <ScriptOutput text={outcome.logs.map((line) => line.text).join("\n")} testId="ai-script-log" />
                  {outcome.logsCut && <span>{t("ai.scripts.run.logCut")}</span>}
                </dd>
              </>
            )}
          </dl>
        )}
        {outcome && (
          <p className="pv-modal-hint" data-testid="ai-script-usage">
            {scriptUsageLine(t, outcome, script.limits, i18n.language)}
          </p>
        )}
      </div>
    </Modal>
  );
}
