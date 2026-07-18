import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, FolderClosed } from "lucide-react";
import { settingsAreas, type SettingsAreaDef } from "@plainva/ui";
import { getActiveVaultEntry } from "./services/vaultRegistry";

/**
 * Mobile settings MASTER list (redesign 2026-07-18, P4): opened directly from
 * the ⋮ in the tab head. It mirrors the desktop rail — the App and Vault
 * areas from the SHARED catalog as tappable rows (icon + chevron); a tap
 * pushes the area's detail screen. The active vault sits on top as a block
 * that leads into the vault management (switch / new / connect). Only areas
 * that carry mobile settings are listed (no updates/startup on mobile).
 */

/** The catalog areas that have a mobile detail screen today. */
const MOBILE_AREAS: Record<"app" | "vault", string[]> = {
  app: ["appearance", "editor", "about"],
  vault: ["sync", "content", "backup"],
};

export function SettingsScreen({
  onBack,
  onOpenArea,
  onOpenVaults,
}: {
  onBack: () => void;
  /** Pushes the detail screen of a catalog area (id from the shared catalog). */
  onOpenArea: (id: string) => void;
  onOpenVaults: () => void;
}) {
  const { t } = useTranslation();
  const [vaultName, setVaultName] = useState("");
  useEffect(() => {
    const reload = () => void getActiveVaultEntry().then((e) => setVaultName(e.name || t("mobile.vaultLocal")));
    reload();
    window.addEventListener("m-vaults-changed", reload);
    window.addEventListener("m-vault-switched", reload);
    return () => {
      window.removeEventListener("m-vaults-changed", reload);
      window.removeEventListener("m-vault-switched", reload);
    };
  }, [t]);

  const renderArea = (area: SettingsAreaDef) => {
    const Icon = area.icon;
    return (
      <button className="m-row" key={area.id} onClick={() => onOpenArea(area.id)}>
        <Icon className="m-accent" size={18} />
        <span>{t(area.labelKey)}</span>
        <ChevronRight className="m-chevron" size={18} />
      </button>
    );
  };

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{t("mobile.sectionSettings")}</h1>
      </header>

      {/* Active vault block: tap = vault management (switch / new / connect). */}
      <p className="m-sectionlabel">{t("mobile.activeVault")}</p>
      <button className="m-row m-vaultblock" data-testid="settings-vault-block" onClick={onOpenVaults}>
        <FolderClosed className="m-accent" size={18} />
        <span className="m-vaultblock-main">
          <span className="m-vaultblock-name">{vaultName}</span>
          <span className="m-vaultblock-hint">{t("mobile.vaultBlockHint")}</span>
        </span>
        <span className="m-vaultblock-dot" aria-hidden />
        <ChevronRight className="m-chevron" size={18} />
      </button>

      <p className="m-sectionlabel">{t("settings.sectionApp")}</p>
      {settingsAreas("app")
        .filter((a) => MOBILE_AREAS.app.includes(a.id))
        .map(renderArea)}

      <p className="m-sectionlabel">{t("settings.sectionVault")}</p>
      {settingsAreas("vault")
        .filter((a) => MOBILE_AREAS.vault.includes(a.id))
        .map(renderArea)}
    </div>
  );
}
