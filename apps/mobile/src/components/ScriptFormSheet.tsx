import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import { Browser } from "@capacitor/browser";
import {
  addScriptParameter,
  Banner,
  Button,
  changeScriptParameter,
  Checkbox,
  ICON,
  IconButton,
  newScriptForm,
  removeScriptParameter,
  SCRIPT_PARAMETER_TYPES,
  scriptDraftOf,
  scriptFormOf,
  scriptFormReady,
  scriptLimitRange,
  scriptToolChoices,
  scriptTypeLabel,
  SCRIPTS_GUIDE,
  scriptWriteError,
  Select,
  TextArea,
  TextInput,
  toast,
  toggleScriptTool,
  userGuideUrl,
  type ScriptFormState,
} from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";

const LIMIT_FIELDS = [
  { key: "seconds", label: "ai.scripts.form.seconds" },
  { key: "calls", label: "ai.scripts.form.calls" },
  { key: "memoryMb", label: "ai.scripts.form.memory" },
] as const;

/**
 * A script written on the phone (plan KI-Harness P5.5, mockup chapter 21) —
 * the desktop's dialog as a sheet: its name, what it is for, the tools it
 * may call, the inputs it asks for, its limits and its code. Saving writes
 * the two files and approves exactly them on this device. With `id`, an
 * existing script is changed the same way; its name stays, since the name is
 * its folder. The form's model is shared (`scriptsWorkshop.ts`).
 */
export function ScriptFormSheet({ id, onClose }: { id?: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const entry = id ? (state.skills.entries.find((e) => e.source.id === id) ?? null) : null;
  const [form, setForm] = useState<ScriptFormState | null>(() => (id ? (entry ? scriptFormOf(entry) : null) : newScriptForm()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!form) return null;
  const editing = Boolean(id);
  // A change takes the last refusal with it: that was about what the form held before.
  const change = (next: ScriptFormState) => {
    setError(null);
    setForm(next);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await session.saveScript(scriptDraftOf(form), { replace: editing });
    setBusy(false);
    if (!result.ok) {
      setError(scriptWriteError(t, result));
      return;
    }
    if (result.approved) toast.success(t("ai.scripts.created", { path: `${result.id}/` }));
    else toast.warning(t("ai.scripts.savedUnapproved"));
    onClose();
  };
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="ai-script-form">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t(editing ? "ai.scripts.form.titleEdit" : "ai.scripts.form.titleNew")}</p>
        <TextInput value={form.name} disabled={editing} autoCapitalize="none" placeholder={t("ai.scripts.form.name")} aria-label={t("ai.scripts.form.name")} onChange={(event) => change({ ...form, name: event.target.value.toLowerCase() })} data-testid="ai-script-name" />
        <p className="m-hint">{t("ai.scripts.form.nameHint")}</p>
        <TextArea rows={2} value={form.description} placeholder={t("ai.scripts.form.description")} aria-label={t("ai.scripts.form.description")} onChange={(event) => change({ ...form, description: event.target.value })} data-testid="ai-script-description" />
        <p className="m-hint">{t("ai.scripts.form.descriptionHint")}</p>
        <div className="m-field">
          <span>{t("ai.scripts.form.tools")}</span>
          <div className="pv-script-tools" role="group" aria-label={t("ai.scripts.form.tools")}>
            {scriptToolChoices(t).map((tool) => (
              <Checkbox key={tool.name} checked={form.tools.includes(tool.name)} onChange={(event) => change(toggleScriptTool(form, tool.name, event.target.checked))} data-testid={`ai-script-tool-${tool.name}`}>
                {tool.label}
              </Checkbox>
            ))}
          </div>
        </div>
        <p className="m-hint">{t("ai.scripts.form.toolsHint")}</p>
        <div className="m-field">
          <span>{t("ai.scripts.form.inputs")}</span>
          <div className="pv-script-inputs">
            {form.parameters.map((p) => (
              <div key={p.row} className="pv-script-input" data-testid="ai-script-input">
                <TextInput value={p.name} autoCapitalize="none" placeholder={t("ai.scripts.form.inputName")} aria-label={t("ai.scripts.form.inputName")} onChange={(event) => change(changeScriptParameter(form, p.row, { name: event.target.value }))} />
                <Select
                  value={p.type}
                  options={SCRIPT_PARAMETER_TYPES.map((type) => ({ value: type, label: scriptTypeLabel(t, type) }))}
                  ariaLabel={t("ai.scripts.form.inputType")}
                  minWidth={120}
                  onChange={(type) => change(changeScriptParameter(form, p.row, { type }))}
                />
                <Checkbox checked={p.required === true} onChange={(event) => change(changeScriptParameter(form, p.row, { required: event.target.checked }))}>
                  {t("ai.scripts.form.inputRequired")}
                </Checkbox>
                <IconButton label={t("ai.scripts.form.removeInput")} onClick={() => change(removeScriptParameter(form, p.row))}>
                  <Trash2 size={ICON.ui} />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
        <Button variant="ghost" icon={<Plus size={ICON.ui} />} disabled={addScriptParameter(form) === form} onClick={() => change(addScriptParameter(form))} data-testid="ai-script-add-input">
          {t("ai.scripts.form.addInput")}
        </Button>
        <p className="m-hint">{t("ai.scripts.form.inputsHint")}</p>
        <div className="m-field">
          <span>{t("ai.scripts.limits")}</span>
          <div className="pv-script-limits">
            {LIMIT_FIELDS.map((limit) => {
              const [min, max] = scriptLimitRange(limit.key);
              return (
                <label key={limit.key}>
                  {`${t(limit.label)} (${min}–${max})`}
                  <TextInput purpose="number" inputMode="numeric" value={form[limit.key]} onChange={(event) => change({ ...form, [limit.key]: event.target.value })} data-testid={`ai-script-limit-${limit.key}`} />
                </label>
              );
            })}
          </div>
        </div>
        <TextArea className="pv-script-editor" purpose="code" rows={10} wrap="off" value={form.code} placeholder={t("ai.scripts.form.code")} aria-label={t("ai.scripts.form.code")} onChange={(event) => change({ ...form, code: event.target.value })} data-testid="ai-script-code-field" />
        <p className="m-hint">{t("ai.scripts.form.codeHint")}</p>
        <Button variant="ghost" icon={<BookOpen size={ICON.ui} />} onClick={() => void Browser.open({ url: userGuideUrl(SCRIPTS_GUIDE) }).catch(() => undefined)} data-testid="ai-script-help">
          {t("ai.scripts.form.help")}
        </Button>
        {error && (
          <Banner kind="error" testId="ai-script-form-error">
            {error}
          </Banner>
        )}
        <Button variant="primary" disabled={busy || !scriptFormReady(form)} onClick={() => void save()} data-testid="ai-script-save">
          {t(editing ? "ai.scripts.form.save" : "ai.scripts.form.create")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
