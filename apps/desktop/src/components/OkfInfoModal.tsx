import { useTranslation } from "react-i18next";
import { Modal, Button } from "@plainva/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { userGuideUrl } from "../services/docsLinks";

/**
 * "What is OKF?" — short, and only when asked for (E2).
 *
 * This used to open by itself once per vault and explain the format in four
 * sections before anyone had written a line. Now it opens from the settings
 * button, says the three things that matter in a sentence each, and sends
 * anyone who wants the rest to the handbook. Explaining at length is the
 * documentation's job; a dialog's job is to be brief enough to be read.
 *
 * With violations it still carries the conversion CTA — that part is an offer,
 * not an explanation.
 */
export function OkfInfoModal({ violations = 0, onStartConversion, onClose }: {
  violations?: number;
  onStartConversion?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal
      onClose={onClose}
      title={t("okfInfo.title")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => void openUrl(userGuideUrl("OKF.md"))}>
            {t("okfInfo.readMore")}
          </Button>
          <Button onClick={onClose}>{t("common.close", { defaultValue: "Schließen" })}</Button>
          {violations > 0 && onStartConversion && (
            <Button variant="primary" onClick={onStartConversion}>{t("settings.okfConversionButton")}</Button>
          )}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-2) 0" }}>
        <p style={{ margin: 0, fontSize: "var(--text-ui)", lineHeight: 1.55, color: "var(--text-main)" }}>
          {t("okfInfo.short1")}
        </p>
        <p style={{ margin: 0, fontSize: "var(--text-ui)", lineHeight: 1.55, color: "var(--text-main)" }}>
          {t("okfInfo.short2")}
        </p>
        <p style={{ margin: 0, fontSize: "var(--text-ui)", lineHeight: 1.55, color: "var(--text-main)" }}>
          {t("okfInfo.short3")}
        </p>
        {violations > 0 && (
          <div className="pv-modal-hint" style={{ color: "var(--text-main)" }}>
            {t("okf.openPromptMsg", { count: violations })}
          </div>
        )}
      </div>
    </Modal>
  );
}
