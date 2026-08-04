import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, FolderClosed } from "lucide-react";
import { ICON, type SettingsAreaDef, settingsAreas } from "@plainva/ui";
import { getActiveVaultEntry } from "./services/vaultRegistry";
import { AppBar } from "./components/AppBar";

/**
 * Mobile settings MASTER list (redesign 2026-07-18, P4): opened directly from
 * the ⋮ in the tab head. It mirrors the desktop rail — the App and Vault
 * areas from the SHARED catalog as tappable rows (icon + chevron); a tap
 * pushes the area's detail screen. The active vault sits on top as a block
 * that leads into the vault management (switch / new / connect). Only areas
 * that carry mobile settings are listed (no updates/startup on mobile).
 */

/**
 * S39: the list is DERIVED from the shared catalog (`{ mobile: true }` drops
 * the areas that carry a written reason not to exist here). Before that it was
 * a hand-kept whitelist beside the catalog — and it had quietly fallen four
 * areas behind. A new settings area now shows up on the phone by default.
 */

export function SettingsScreen({
  onBack,
  onOpenArea,
  onOpenVaults,
  barCount,
}: {
  onBack: () => void;
  /** Pushes the detail screen of a catalog area (id from the shared catalog). */
  onOpenArea: (id: string) => void;
  onOpenVaults: () => void;
  /** Areas currently in the bar — shown as the summary of the bars row. */
  barCount: number;
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
    // The bar area is the one whose current state fits in a word, and it is the
    // one people come back to — so it carries its count on the row.
    const summary = area.id === "bars" ? t("mobile.navBarSummary", { n: barCount }) : "";
    return (
      <button className="m-row" data-testid={`settings-area-${area.id}`} key={area.id} onClick={() => onOpenArea(area.id)}>
        <Icon className="m-accent" size={ICON.head} />
        <span>{t(area.labelKey)}</span>
        {summary && <span className="m-row-note">{summary}</span>}
        <ChevronRight className="m-chevron" size={ICON.head} />
      </button>
    );
  };

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("mobile.sectionSettings")} />

      {/* Active vault block: tap = vault management (switch / new / connect). */}
      <p className="m-sectionlabel">{t("mobile.activeVault")}</p>
      <button className="m-row m-vaultblock" data-testid="settings-vault-block" onClick={onOpenVaults}>
        <FolderClosed className="m-accent" size={ICON.head} />
        <span className="m-vaultblock-main">
          <span className="m-vaultblock-name">{vaultName}</span>
          <span className="m-vaultblock-hint">{t("mobile.vaultBlockHint")}</span>
        </span>
        <span className="m-vaultblock-dot" aria-hidden />
        <ChevronRight className="m-chevron" size={ICON.head} />
      </button>

      <p className="m-sectionlabel">{t("settings.sectionApp")}</p>
      {settingsAreas("app", { mobile: true }).map(renderArea)}

      <p className="m-sectionlabel">{t("settings.sectionVault")}</p>
      {settingsAreas("vault", { mobile: true }).map(renderArea)}
    </div>
  );
}
