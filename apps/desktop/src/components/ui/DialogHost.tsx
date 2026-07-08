import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { settleDialog, useActiveDialog, type DialogRequest } from "../../services/appDialogs";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { TextInput } from "./Field";

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
  const primaryRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cancel = () => settleDialog(req.id, req.type === "prompt" ? null : false);
  const confirm = () => settleDialog(req.id, req.type === "prompt" ? value : true);

  // Safe defaults: destructive dialogs start on Cancel, prompts in the input,
  // everything else on the primary action.
  useEffect(() => {
    if (req.type === "prompt") inputRef.current?.focus();
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
        </div>
      </div>
    </Modal>
  );
}
