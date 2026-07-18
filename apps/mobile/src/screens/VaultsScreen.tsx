import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronLeft, ChevronRight, Cloud, FolderClosed, FolderPlus } from "lucide-react";
import { listVaults, type VaultEntry } from "../services/vaultRegistry";
import { switchVault } from "../services/vaultService";

/**
 * Vault management inside the settings (redesign 2026-07-18, P4): the list of
 * known vaults — the ACTIVE one carries a check mark, tapping another one
 * switches (the established switchVault flow), the chevron opens the vault's
 * detail screen. "New vault" and "Connect cloud" live HERE, below the list,
 * so the whole vault workflow sits in one place (the splash may offer both
 * additionally, but this is their home).
 */
export function VaultsScreen({
  activeVaultId,
  onBack,
  onOpenVault,
  onCreateVault,
  onAddVault,
}: {
  activeVaultId: string;
  onBack: () => void;
  onOpenVault: (id: string) => void;
  onCreateVault: () => void;
  onAddVault: () => void;
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
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={22} />
        </button>
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
              <FolderClosed className={active ? "m-accent" : "m-chevron"} size={18} />
              <span>{v.name || t("mobile.vaultLocal")}</span>
              {active && <Check className="m-accent" size={18} />}
            </button>
            <button
              aria-label={t("mobile.vaultDetails")}
              className="m-iconbtn"
              onClick={() => onOpenVault(v.id)}
            >
              <ChevronRight className="m-chevron" size={18} />
            </button>
          </div>
        );
      })}

      <p className="m-sectionlabel">{t("mobile.vaultAddSection")}</p>
      <button className="m-row" onClick={onCreateVault}>
        <FolderPlus className="m-accent" size={18} />
        <span>{t("mobile.vaultCreate")}</span>
        <ChevronRight className="m-chevron" size={18} />
      </button>
      <button className="m-row" onClick={onAddVault}>
        <Cloud className="m-accent" size={18} />
        <span>{t("mobile.vaultAdd")}</span>
        <ChevronRight className="m-chevron" size={18} />
      </button>
    </div>
  );
}
