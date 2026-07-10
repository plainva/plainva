import { X, Info, CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast, useToasts, type ToastKind } from "../../services/toastStore";

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

/**
 * Renders the toast stack (plan Designsprache P3) bottom-right above the
 * status bar. aria-live so screen readers announce notices; hover pauses the
 * auto-dismiss. Mounted once in main.tsx.
 */
export function ToastHost() {
  const items = useToasts();
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <div className="pv-toasts" aria-live="polite" aria-relevant="additions">
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <div
            key={item.id}
            className={`pv-toast pv-toast--${item.kind}`}
            role={item.kind === "error" ? "alert" : "status"}
            onMouseEnter={() => toast.pause(item.id)}
            onMouseLeave={() => toast.resume(item.id)}
          >
            <Icon size={16} className="pv-toast-ic" aria-hidden />
            <div className="pv-toast-msg">{item.message}</div>
            <button
              type="button"
              className="pv-toast-x"
              aria-label={t("common.close", { defaultValue: "Schließen" })}
              onClick={() => toast.dismiss(item.id)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
