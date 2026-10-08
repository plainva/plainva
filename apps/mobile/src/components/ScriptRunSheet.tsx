import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Play } from "lucide-react";
import {
  Banner,
  Button,
  GroupCard,
  ICON,
  Row,
  RowList,
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
  useScriptRun,
  workshopTitle,
  type ScriptFieldValues,
} from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

/**
 * A script run from the workshop on the phone (plan KI-Harness P5.5, mockup
 * chapter 21): the desktop's dialog in the grammar of a sheet — the inputs it
 * asks for, "Run" or "Dry run", each tool call as it happens with a way to
 * stop, then its value and what it used of its limits, or why it was ended.
 * The words and the run itself are shared (`scriptsWorkshop.ts`,
 * `useScriptRun`); nothing here decides on its own.
 */
export function ScriptRunSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const entry = state.skills.entries.find((e) => e.source.id === id) ?? null;
  const script = entry?.source.script ?? null;
  const [values, setValues] = useState<ScriptFieldValues>(() => scriptFieldDefaults(script?.parameters ?? []));
  const running = useScriptRun(session, state, id);
  if (!entry || !script) return null;
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
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-script-run">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{workshopTitle(t, entry)}</p>
        <p className="m-hint">{script.description}</p>
        {!state.scripts.available && <Banner kind="warning">{t("ai.scripts.unavailable")}</Banner>}
        {(running.refused || entry.status !== "active") && (
          <Banner kind="error" testId="ai-script-refused">
            {t("ai.scripts.notActive")}
          </Banner>
        )}
        {script.parameters.map((p) => {
          const hint = [p.description, p.options ? null : scriptTypeLabel(t, p.type), t(p.required ? "ai.scripts.required" : "ai.scripts.optional")].filter(Boolean).join(" · ");
          if (p.type === "boolean") {
            return (
              <GroupCard key={p.name}>
                <RowList>
                  <Row controls title={p.name} subtitle={hint} wrap end={<Switch checked={values[p.name] === true} label={p.name} disabled={running.busy} onChange={(on) => set(p.name, on)} data-testid={`ai-script-field-${p.name}`} />} />
                </RowList>
              </GroupCard>
            );
          }
          return (
            <label key={p.name} className="m-field">
              <span>{`${p.name} — ${hint}`}</span>
              {p.options ? (
                <Select value={String(values[p.name] ?? "")} options={p.options.map((option) => ({ value: option, label: option }))} ariaLabel={p.name} disabled={running.busy} minWidth="100%" onChange={(next) => set(p.name, next)} data-testid={`ai-script-field-${p.name}`} />
              ) : (
                <TextInput
                  value={String(values[p.name] ?? "")}
                  purpose={p.type === "number" ? "number" : "name"}
                  inputMode={p.type === "number" ? "decimal" : undefined}
                  autoCapitalize="none"
                  disabled={running.busy}
                  aria-label={p.name}
                  onChange={(event) => set(p.name, event.target.value)}
                  data-testid={`ai-script-field-${p.name}`}
                />
              )}
            </label>
          );
        })}
        {!run && <p className="m-hint">{t("ai.scripts.run.hint")}</p>}
        {run && running.busy && (
          <p className="m-hint" data-testid="ai-script-running">
            {t("ai.scripts.run.running")}
          </p>
        )}
        {ended && (
          <Banner kind={ended.tone} testId="ai-script-outcome">
            {ended.note ? `${ended.text} ${ended.note}` : ended.text}
          </Banner>
        )}
        {run && (
          <>
            <p className="m-hint">{t("ai.scripts.run.calls")}</p>
            <div className="m-skill-test-lines">{run.calls.length ? <ScriptCallList lines={scriptCallLines(t, run.calls, i18n.language)} /> : <span>{running.busy ? "…" : t("ai.scripts.run.callsNone")}</span>}</div>
          </>
        )}
        {value !== null && (
          <>
            <p className="m-hint">{t("ai.scripts.run.result")}</p>
            <ScriptOutput text={value} testId="ai-script-result" />
            <Button variant="ghost" icon={<Copy size={ICON.ui} />} onClick={() => copy(value)}>
              {t("common.copy")}
            </Button>
          </>
        )}
        {outcome && outcome.logs.length > 0 && (
          <>
            <p className="m-hint">{t("ai.scripts.run.log")}</p>
            <ScriptOutput text={outcome.logs.map((line) => line.text).join("\n")} testId="ai-script-log" />
            {outcome.logsCut && <p className="m-hint">{t("ai.scripts.run.logCut")}</p>}
          </>
        )}
        {outcome && (
          <p className="m-hint" data-testid="ai-script-usage">
            {scriptUsageLine(t, outcome, script.limits, i18n.language)}
          </p>
        )}
        {running.busy ? (
          <Button variant="ghost" onClick={running.stop} data-testid="ai-script-stop">
            {t("ai.stop")}
          </Button>
        ) : (
          <>
            <Button variant="primary" icon={<Play size={ICON.ui} />} disabled={!canStart} onClick={() => running.start(input, false)} data-testid="ai-script-start">
              {t("ai.scripts.run.start")}
            </Button>
            <Button variant="secondary" disabled={!canStart} onClick={() => running.start(input, true)} data-testid="ai-script-dry">
              {t("ai.scripts.run.dry")}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
