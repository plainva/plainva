import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, CodeXml, Plus, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  addScriptParameter,
  Banner,
  Button,
  changeScriptParameter,
  Checkbox,
  ICON,
  IconButton,
  Modal,
  newScriptForm,
  removeScriptParameter,
  SCRIPT_PARAMETER_TYPES,
  scriptDraftOf,
  scriptFormOf,
  scriptFormReady,
  scriptLimitRange,
  scriptToolChoices,
  ScriptToolPicker,
  scriptTypeLabel,
  SCRIPTS_GUIDE,
  scriptWriteError,
  Select,
  TextArea,
  TextInput,
  toast,
  toggleScriptTool,
  useAiSession,
  useAiState,
  userGuideUrl,
  type ScriptFormState,
} from "@plainva/ui";

const LIMIT_FIELDS = [
  { key: "seconds", label: "ai.scripts.form.seconds" },
  { key: "calls", label: "ai.scripts.form.calls" },
  { key: "memoryMb", label: "ai.scripts.form.memory" },
] as const;

/**
 * A script written in the app (plan KI-Harness P5.5, mockup chapter 21): its
 * name, what it is for, the tools it may call, the inputs it asks for, its
 * limits and its code. Written as `.agent/scripts/<name>/manifest.json` and
 * `main.js`, and approved on this device with exactly what was written — the
 * user wrote it here. With `id`, an existing script is changed the same way:
 * its name stays, since the name is its folder. What is wrong with a script
 * is the manifest's to say; the form only hands it in (`scriptsWorkshop.ts`,
 * the phone's as well).
 */
export function ScriptFormModal({ id, onClose }: { id?: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const entry = id ? (state?.skills.entries.find((e) => e.source.id === id) ?? null) : null;
  const [form, setForm] = useState<ScriptFormState | null>(() => (id ? (entry ? scriptFormOf(entry) : null) : newScriptForm()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!session || !form) return null;
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
    <Modal
      title={t(editing ? "ai.scripts.form.titleEdit" : "ai.scripts.form.titleNew")}
      icon={<CodeXml size={ICON.ui} />}
      size="lg"
      onClose={onClose}
      testId="ai-script-form"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={busy || !scriptFormReady(form)} onClick={() => void save()} data-testid="ai-script-save">
            {t(editing ? "ai.scripts.form.save" : "ai.scripts.form.create")}
          </Button>
        </>
      }
    >
      <div className="pv-script-form">
        <div className="pv-script-field">
          <label className="pv-modal-label" htmlFor="pv-script-name">
            {t("ai.scripts.form.name")}
          </label>
          <TextInput id="pv-script-name" value={form.name} disabled={editing} onChange={(event) => change({ ...form, name: event.target.value.toLowerCase() })} data-testid="ai-script-name" />
          <p className="pv-modal-hint">{t("ai.scripts.form.nameHint")}</p>
        </div>
        <div className="pv-script-field">
          <label className="pv-modal-label" htmlFor="pv-script-description">
            {t("ai.scripts.form.description")}
          </label>
          <TextArea id="pv-script-description" rows={2} value={form.description} onChange={(event) => change({ ...form, description: event.target.value })} data-testid="ai-script-description" />
          <p className="pv-modal-hint">{t("ai.scripts.form.descriptionHint")}</p>
        </div>
        <div className="pv-script-field">
          <span className="pv-modal-label">{t("ai.scripts.form.tools")}</span>
          <ScriptToolPicker choices={scriptToolChoices(t)} chosen={form.tools} labels={{ read: t("ai.scripts.form.toolsRead"), write: t("ai.scripts.form.toolsWrite") }} onToggle={(name, on) => change(toggleScriptTool(form, name, on))} />
          <p className="pv-modal-hint">{t("ai.scripts.form.toolsHint")}</p>
        </div>
        <div className="pv-script-field">
          <span className="pv-modal-label">{t("ai.scripts.form.inputs")}</span>
          <div className="pv-script-inputs">
            {form.parameters.map((p) => (
              <div key={p.row} className="pv-script-input" data-testid="ai-script-input">
                <TextInput compact value={p.name} placeholder={t("ai.scripts.form.inputName")} aria-label={t("ai.scripts.form.inputName")} onChange={(event) => change(changeScriptParameter(form, p.row, { name: event.target.value }))} />
                <Select
                  compact
                  value={p.type}
                  options={SCRIPT_PARAMETER_TYPES.map((type) => ({ value: type, label: scriptTypeLabel(t, type) }))}
                  ariaLabel={t("ai.scripts.form.inputType")}
                  onChange={(type) => change(changeScriptParameter(form, p.row, { type }))}
                />
                <Checkbox checked={p.required === true} onChange={(event) => change(changeScriptParameter(form, p.row, { required: event.target.checked }))}>
                  {t("ai.scripts.form.inputRequired")}
                </Checkbox>
                <IconButton label={t("ai.scripts.form.removeInput")} size="sm" onClick={() => change(removeScriptParameter(form, p.row))}>
                  <Trash2 size={ICON.ui} />
                </IconButton>
              </div>
            ))}
          </div>
          <div>
            <Button size="sm" variant="ghost" icon={<Plus size={ICON.ui} />} disabled={addScriptParameter(form) === form} onClick={() => change(addScriptParameter(form))} data-testid="ai-script-add-input">
              {t("ai.scripts.form.addInput")}
            </Button>
          </div>
          <p className="pv-modal-hint">{t("ai.scripts.form.inputsHint")}</p>
        </div>
        <div className="pv-script-field">
          <span className="pv-modal-label">{t("ai.scripts.limits")}</span>
          <div className="pv-script-limits">
            {LIMIT_FIELDS.map((limit) => {
              const [min, max] = scriptLimitRange(limit.key);
              return (
                <label key={limit.key}>
                  {`${t(limit.label)} (${min}–${max})`}
                  <TextInput compact purpose="number" inputMode="numeric" value={form[limit.key]} onChange={(event) => change({ ...form, [limit.key]: event.target.value })} data-testid={`ai-script-limit-${limit.key}`} />
                </label>
              );
            })}
          </div>
        </div>
        <div className="pv-script-field">
          <label className="pv-modal-label" htmlFor="pv-script-code">
            {t("ai.scripts.form.code")}
          </label>
          <TextArea id="pv-script-code" className="pv-script-editor" purpose="code" rows={12} wrap="off" value={form.code} onChange={(event) => change({ ...form, code: event.target.value })} data-testid="ai-script-code-field" />
          <p className="pv-modal-hint">{t("ai.scripts.form.codeHint")}</p>
          <div>
            <Button size="sm" variant="ghost" icon={<BookOpen size={ICON.ui} />} onClick={() => void openUrl(userGuideUrl(SCRIPTS_GUIDE))} data-testid="ai-script-help">
              {t("ai.scripts.form.help")}
            </Button>
          </div>
        </div>
        {error && (
          <Banner kind="error" rounded testId="ai-script-form-error">
            {error}
          </Banner>
        )}
      </div>
    </Modal>
  );
}
