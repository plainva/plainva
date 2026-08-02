import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronLeft, ChevronRight, Cloud, FolderClosed, FolderPlus } from "lucide-react";
import { listVaults, type VaultEntry } from "../services/vaultRegistry";
import { switchVault } from "../services/vaultService";
import { ICON, IconButton } from "@plainva/ui";

/**
 * Vault management inside the settings (redesign 2026-07-18, P4): the list of
 * known vaults — the ACTIVE one carries a check mark, tapping another one
 * switches (the established switchVault flow), the chevron opens the vault's
 * detail screen.
 *
 * Creating a vault lives here; SIGNING IN does not (H3). Cloud accounts is the
 * one place for connections — files, calendar and mail together — so this
 * screen points there instead of offering a second, files-only door into the
 * same flow.
 */
export function VaultsScreen({
  activeVaultId,
  onBack,
  onOpenVault,
  onCreateVault,
  onOpenCloudAccounts,
}: {
  activeVaultId: string;
  onBack: () => void;
  onOpenVault: (id: string) => void;
  onCreateVault: () => void;
  onOpenCloudAccounts: () => void;
}) {
  const { t } = useTranslation();
  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  useEffect(() => {
    const reload = () => void listVaults().then(setVaults);
    reload();
    window.addEventListener("m-vaults-changed", reload);
    return () => window.removeEventListener("m-vaults-changed", reload);
  }, [activeVaultId]);

  return (
    <div className="m-page">
      <header className="m-header">
        <IconButton label="Back" onClick={onBack}>
          <ChevronLeft size={ICON.touch} />
        </IconButton>
        <h1>{t("mobile.vaults")}</h1>
      </header>

      <p className="m-sectionlabel">{t("settings.vaultSelect", { defaultValue: "Vault wählen" })}</p>
      {vaults.map((v) => {
        const active = v.id === activeVaultId;
        return (
          <div className="m-row m-row--split" key={v.id}>
            <button
              className="m-row-main"
              disabled={active}
              onClick={() => void switchVault(v.id)}
            >
              <FolderClosed className={active ? "m-accent" : "m-chevron"} size={ICON.head} />
              <span>{v.name || t("mobile.vaultLocal")}</span>
              {active && <Check className="m-accent" size={ICON.head} />}
            </button>
            <IconButton label={t("mobile.vaultDetails")} onClick={() => onOpenVault(v.id)}>
              <ChevronRight className="m-chevron" size={ICON.head} />
            </IconButton>
          </div>
        );
      })}

      <p className="m-sectionlabel">{t("mobile.vaultAddSection")}</p>
      <button className="m-row" onClick={onCreateVault}>
        <FolderPlus className="m-accent" size={ICON.head} />
        <span>{t("mobile.vaultCreate")}</span>
        <ChevronRight className="m-chevron" size={ICON.head} />
      </button>
      <button className="m-row" data-testid="vaults-to-cloud-accounts" onClick={onOpenCloudAccounts}>
        <Cloud className="m-accent" size={ICON.head} />
        <span>{t("mobile.vaultAdd")}</span>
        <ChevronRight className="m-chevron" size={ICON.head} />
      </button>
      <p className="m-hint">{t("mobile.vaultAddViaCloudAccounts")}</p>
    </div>
  );
}
