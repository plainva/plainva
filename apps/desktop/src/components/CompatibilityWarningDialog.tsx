import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { getSettingsStore } from "../services/settingsStore";
import { SHOW_COMPATIBILITY_WARNING_KEY } from "../contexts/VaultContext";
import { ICON, Modal } from "@plainva/ui";
import { Button } from "@plainva/ui";
import { Checkbox } from "@plainva/ui";

interface Props {
  onConfirm: () => void;
  onCancel: () => void;
  featureName: string;
}

export function CompatibilityWarningDialog({ onConfirm, onCancel, featureName }: Props) {
  const { t } = useTranslation();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleConfirm = async () => {
    if (dontShowAgain) {
      try {
        const store = await getSettingsStore();
        await store.set(SHOW_COMPATIBILITY_WARNING_KEY, false);
        await store.save();
      } catch (e) {
        console.error("Failed to save compatibility warning setting", e);
      }
    }
    onConfirm();
  };

  return (
    <Modal
      onClose={onCancel}
      title={t("compat.title")}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={handleConfirm}>{t("compat.useAnyway")}</Button>
        </>
      }
    >
      <div className="pv-dialog-body">
        <AlertTriangle size={ICON.head} className="pv-dialog-ic pv-dialog-ic--warning" aria-hidden />
        <div className="pv-dialog-text">
          <p className="pv-dialog-msg">
            {t("compat.bodyPrefix")} <strong>"{featureName}"</strong> {t("compat.bodySuffix")}
          </p>
          <Checkbox checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)}>
            {t("compat.dontShowAgain")}
          </Checkbox>
        </div>
      </div>
    </Modal>
  );
}
