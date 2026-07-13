import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  FolderClosed,
  FolderPlus,
  Settings as SettingsIcon,
} from "lucide-react";
import { listVaults, type VaultEntry } from "../services/vaultRegistry";
import { switchVault } from "../services/vaultService";
import { TAB_POOL, type TabScreenId } from "../navigation";

/**
 * More menu (R2.1/R2.5): now a pushed screen behind the top-bar action.
 * EVERY pool screen is listed here regardless of the tab-bar selection —
 * nothing becomes unreachable when the user customizes the bar — plus the
 * vault list and settings.
 */
export function MoreScreen({
  activeVaultId,
  onBack,
  onOpenScreen,
  onAddVault,
  onCreateVault,
  onOpenVault,
  onOpenSettings,
}: {
  activeVaultId: string;
  onBack: () => void;
  onOpenScreen: (id: TabScreenId) => void;
  onAddVault: () => void;
  onCreateVault: () => void;
  onOpenVault: (id: string) => void;
  onOpenSettings: () => void;
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
        <h1>{t("mobile.tabMore")}</h1>
      </header>

      {TAB_POOL.map((tab) => {
        const Icon = tab.icon;
        return (
          <button className="m-row" key={tab.id} onClick={() => onOpenScreen(tab.id)}>
            <Icon className="m-accent" size={18} />
            <span>{t(tab.labelKey)}</span>
            <ChevronRight className="m-chevron" size={18} />
          </button>
        );
      })}

      <p className="m-sectionlabel">{t("mobile.vaults")}</p>
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

      <p className="m-sectionlabel">{t("mobile.sectionSettings")}</p>
      <button className="m-row" onClick={onOpenSettings}>
        <SettingsIcon className="m-accent" size={18} />
        <span>{t("mobile.sectionSettings")}</span>
        <ChevronRight className="m-chevron" size={18} />
      </button>
    </div>
  );
}
