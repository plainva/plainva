import { useState, useSyncExternalStore } from "react";
import { SheetGrip } from "./SheetGrip";
import { useTranslation } from "react-i18next";
import {
  currentMobileDialog,
  dismissMobileDialog,
  subscribeMobileDialogs,
  type MobileDialog,
} from "../services/mobileDialogs";

/**
 * Renders the pending mobileDialogs request as an M3 bottom sheet (R3.3).
 * Mounted once in main.tsx; the sheet sits above every other surface
 * (backdrop --dialog), backdrop taps cancel.
 */
export function MobileDialogHost() {
  const dialog = useSyncExternalStore(subscribeMobileDialogs, currentMobileDialog);
  if (!dialog) return null;
  // Remount per request so input state never leaks between dialogs.
  return <DialogSheet dialog={dialog} key={dialog.id} />;
}

function DialogSheet({ dialog }: { dialog: MobileDialog }) {
  const { t } = useTranslation();
  const [text, setText] = useState(dialog.kind === "prompt" ? (dialog.initial ?? "") : "");

  const cancel = () => {
    if (dialog.kind === "prompt") dialog.resolve({ value: "", cancelled: true });
    else if (dialog.kind === "confirm") dialog.resolve(false);
    else dialog.resolve(null);
    dismissMobileDialog(dialog);
  };

  const submitPrompt = () => {
    if (dialog.kind !== "prompt") return;
    dialog.resolve({ value: text, cancelled: false });
    dismissMobileDialog(dialog);
  };

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={cancel}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={cancel} />
        <p className="m-sheet-title">{dialog.title}</p>
        {dialog.message && <p className="m-hint m-hint--inset">{dialog.message}</p>}

        {dialog.kind === "prompt" && (
          <>
            <div className="m-sheet-inputrow">
              <input
                autoFocus
                className="m-searchfield"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitPrompt();
                }}
                placeholder={dialog.placeholder}
                value={text}
              />
            </div>
            <div className="m-btnrow">
              <button className="m-btn" onClick={cancel}>
                {t("common.cancel")}
              </button>
              <button className="m-btn m-btn--filled" onClick={submitPrompt}>
                {t("common.ok")}
              </button>
            </div>
          </>
        )}

        {dialog.kind === "confirm" && (
          <div className="m-btnrow">
            <button className="m-btn" onClick={cancel}>
              {t("common.cancel")}
            </button>
            <button
              className={`m-btn m-btn--filled${dialog.danger ? " m-btn--danger" : ""}`}
              onClick={() => {
                dialog.resolve(true);
                dismissMobileDialog(dialog);
              }}
            >
              {dialog.confirmLabel ?? t("common.confirm")}
            </button>
          </div>
        )}

        {dialog.kind === "select" &&
          dialog.options.map((opt) => (
            <button
              className="m-row"
              key={opt.value}
              onClick={() => {
                dialog.resolve(opt.value);
                dismissMobileDialog(dialog);
              }}
            >
              <span>
                {opt.label}
                {opt.desc && <span className="m-select-desc">{opt.desc}</span>}
              </span>
              <span className={`m-slotmark${dialog.value === opt.value ? " is-on" : ""}`} />
            </button>
          ))}
      </div>
    </div>
  );
}
