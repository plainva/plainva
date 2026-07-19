import { useTranslation } from "react-i18next";
import { Modal } from "@plainva/ui";
import { Button } from "@plainva/ui";

/**
 * "Was ist OKF?" explainer (plan UI-UX P12): shown once per vault after
 * opening/creating it, from the settings' OKF section, and as the richer
 * replacement of the old native conversion prompt. With violations it carries
 * the "start conversion" CTA; the wizard itself stays a separate modal.
 */
export function OkfInfoModal({ violations = 0, onStartConversion, onClose }: {
  violations?: number;
  onStartConversion?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const section = (title: string, body: string) => (
    <div className="pv-modal-section">
      <div className="pv-modal-label">{title}</div>
      <div style={{ fontSize: "var(--text-ui)", lineHeight: 1.55, color: "var(--text-main)" }}>{body}</div>
    </div>
  );

  return (
    <Modal
      onClose={onClose}
      title={t("okfInfo.title")}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{t("common.close", { defaultValue: "Schließen" })}</Button>
          {violations > 0 && onStartConversion && (
            <Button variant="primary" onClick={onStartConversion}>{t("settings.okfConversionButton")}</Button>
          )}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        <div style={{ fontSize: "var(--text-ui)", lineHeight: 1.55, color: "var(--text-main)" }}>{t("okfInfo.intro")}</div>
        {section(t("okfInfo.whatTitle"), t("okfInfo.whatBody"))}
        {section(t("okfInfo.whyTitle"), t("okfInfo.whyBody"))}
        {section(t("okfInfo.indexTitle"), t("okfInfo.indexBody"))}
        {section(t("okfInfo.obsidianTitle"), t("okfInfo.obsidianBody"))}
        {violations > 0 && (
          <div className="pv-modal-hint" style={{ color: "var(--text-main)" }}>
            {t("okf.openPromptMsg", { count: violations })}
          </div>
        )}
      </div>
    </Modal>
  );
}
