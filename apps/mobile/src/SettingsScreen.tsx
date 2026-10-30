import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, FolderClosed } from "lucide-react";
import { GroupCard, ICON, Row, RowList, SectionLabel, type SettingsAreaDef, settingsAreas } from "@plainva/ui";
import { getActiveVaultEntry, type VaultEntry } from "./services/vaultRegistry";
import { getSyncStatus, subscribeSyncStatus } from "./services/syncService";
import { syncStateLabel } from "./components/syncSubtitle";
import { backupState } from "./services/vaultBackup";
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
  const [vaultEntry, setVaultEntry] = useState<VaultEntry | null>(null);
  const syncStatus = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  useEffect(() => {
    const reload = () => void getActiveVaultEntry().then((e) => { setVaultEntry(e); setVaultName(e.name || t("mobile.vaultLocal")); });
    reload();
    window.addEventListener("m-vaults-changed", reload);
    window.addEventListener("m-vault-switched", reload);
    return () => {
      window.removeEventListener("m-vaults-changed", reload);
      window.removeEventListener("m-vault-switched", reload);
    };
  }, [t]);

  const areaState = (id: string): string => {
    if (id === "bars") return t("mobile.navBarSummary", { n: barCount });
    if (id === "sync") return vaultEntry?.provider ? syncStateLabel(syncStatus, t) : t("common.off");
    if (id === "backup" && vaultEntry) {
      const zip = backupState(vaultEntry.id);
      return !zip.enabled ? t("common.off") : zip.lastRun ? new Date(zip.lastRun).toLocaleDateString() : t("mobile.backupZipNever");
    }
    return "";
  };

  const renderArea = (area: SettingsAreaDef) => {
    const Icon = area.icon;
    // A state instead of a description where a state word exists (settings
    // plan 2026-10-29, E15): the Android overview shows the current value.
    const summary = areaState(area.id);
    return (
      <Row
        data-testid={`settings-area-${area.id}`}
        end={<>{summary && <span className="m-row-note">{summary}</span>}<ChevronRight className="m-chevron" size={ICON.ui} /></>}
        icon={<Icon className="m-accent" size={ICON.ui} />}
        key={area.id}
        onClick={() => onOpenArea(area.id)}
        title={t(area.mobileLabelKey ?? area.labelKey)}
      />
    );
  };

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("mobile.sectionSettings")} />
      <div className="m-settings">

        {/* Active vault block: tap = vault management (switch / new / connect). */}
        <SectionLabel>{t("mobile.activeVault")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row
              data-testid="settings-vault-block"
              end={<><span className="m-vaultblock-dot" aria-hidden /><ChevronRight className="m-chevron" size={ICON.ui} /></>}
              icon={<FolderClosed className="m-accent" size={ICON.ui} />}
              onClick={onOpenVaults}
              subtitle={t("mobile.vaultBlockHint")}
              title={vaultName}
            />
          </RowList>
        </GroupCard>

        <SectionLabel info={t("settings.sectionAppInfo")}>{t("settings.sectionApp")}</SectionLabel>
        <GroupCard><RowList>{settingsAreas("app", { mobile: true }).map(renderArea)}</RowList></GroupCard>

        <SectionLabel>{t("settings.sectionVault")}</SectionLabel>
        <GroupCard><RowList>{settingsAreas("vault", { mobile: true }).map(renderArea)}</RowList></GroupCard>
      </div>
    </div>
  );
}
