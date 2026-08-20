import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { settleDialog, useActiveDialog, type DialogRequest } from "../../services/appDialogs";
import { Modal } from "@plainva/ui";
import { Button } from "@plainva/ui";
import { Select } from "@plainva/ui";
import { TextInput } from "@plainva/ui";
import { Checkbox } from "@plainva/ui";

/**
 * Renders the active appDialog request (plan Designsprache P3/§6) as a themed
 * Modal — confirm/message/prompt replace the native Tauri ask/message and
 * window.confirm. Mounted once in main.tsx. Focus defaults: danger confirms
 * focus Cancel (safe default), others focus the primary action, prompts the
 * input. Escape/X/overlay = cancel.
 */
export function DialogHost() {
  const req = useActiveDialog();
  if (!req) return null;
  return <ActiveDialog key={req.id} req={req} />;
}

function ActiveDialog({ req }: { req: DialogRequest }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(req.type === "prompt" ? req.initial ?? "" : "");
  const [checked, setChecked] = useState(req.type === "prompt" ? req.checkbox?.initial ?? false : false);
  // One state bag for the template-answers dialog: every question of a
  // template is asked in this single modal (plan Vorlagen-Engine, P3).
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    req.type === "answers"
      ? Object.fromEntries(req.fields.map((f) => [f.label, f.defaultValue ?? (f.kind === "select" ? f.options?.[0] ?? "" : "")]))
      : {}
  );
  const primaryRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cancel = () => settleDialog(req.id, req.type === "prompt" || req.type === "answers" ? null : false);
  const confirm = () =>
    settleDialog(
      req.id,
      req.type === "prompt"
        ? req.checkbox
          ? { value, checked }
          : value
        : req.type === "answers"
          ? answers
          : true
    );

  // Safe defaults: destructive dialogs start on Cancel, prompts and template
  // questions in the first input, everything else on the primary action.
  useEffect(() => {
    if (req.type === "prompt" || req.type === "answers") inputRef.current?.focus();
    else if (req.type === "confirm" && req.kind === "danger") cancelRef.current?.focus();
    else primaryRef.current?.focus();
  }, [req]);

  const confirmLabel =
    req.confirmLabel ??
    (req.type === "message"
      ? t("common.ok", { defaultValue: "OK" })
      : t("common.confirm", { defaultValue: "Bestätigen" }));
  const cancelLabel = req.cancelLabel ?? t("common.cancel", { defaultValue: "Abbrechen" });

  return (
    <Modal
      onClose={cancel}
      title={req.title}
      size="sm"
      overlayClassName="pv-overlay--dialog"
      ariaLabel={req.title}
      footer={
        <>
          {req.type !== "message" && (
            <Button ref={cancelRef} variant="secondary" onClick={cancel}>
              {cancelLabel}
            </Button>
          )}
          <Button
            ref={primaryRef}
            variant={req.kind === "danger" ? "danger" : "primary"}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="pv-dialog-body">
        {req.kind !== "info" && (
          <AlertTriangle
            size={20}
            className={req.kind === "danger" ? "pv-dialog-ic pv-dialog-ic--danger" : "pv-dialog-ic pv-dialog-ic--warning"}
            aria-hidden
          />
        )}
        {req.kind === "info" && req.type !== "prompt" && (
          <Info size={20} className="pv-dialog-ic" aria-hidden />
        )}
        <div className="pv-dialog-text">
          {req.message ? <p className="pv-dialog-msg">{req.message}</p> : null}
          {req.type === "prompt" && (
            <TextInput
              ref={inputRef}
              value={value}
              placeholder={req.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirm();
                }
              }}
            />
          )}
          {req.type === "prompt" && req.checkbox && (
            <Checkbox
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              data-testid="prompt-checkbox"
            >
              {req.checkbox.label}
            </Checkbox>
          )}
          {req.type === "answers" && (
            <div className="pv-dialog-fields" data-testid="template-answers">
              {req.fields.map((field, i) => (
                <label key={field.label} className="pv-dialog-field">
                  <span className="pv-dialog-fieldlabel">{field.label}</span>
                  {field.kind === "select" ? (
                    <Select
                      ariaLabel={field.label}
                      value={answers[field.label] ?? ""}
                      options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
                      onChange={(next) => setAnswers((prev) => ({ ...prev, [field.label]: next }))}
                    />
                  ) : (
                    <TextInput
                      ref={i === 0 ? inputRef : undefined}
                      type={field.kind === "date" ? "date" : "text"}
                      value={answers[field.label] ?? ""}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [field.label]: e.target.value }))}
                      onKeyDown={(e) => {
                        // Enter finishes the dialog only from the LAST field —
                        // otherwise a multi-question template would submit
                        // while the person is still filling it in.
                        if (e.key === "Enter" && i === req.fields.length - 1) {
                          e.preventDefault();
                          confirm();
                        }
                      }}
                    />
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
