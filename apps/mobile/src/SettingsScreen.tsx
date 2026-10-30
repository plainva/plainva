import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, FolderClosed, Search } from "lucide-react";
import { EmptyState, familyLabel, GroupCard, ICON, isServiceOff, Row, RowList, SearchField, searchSettings, SectionLabel, type CloudServiceId, type SettingsAreaDef, type SettingsSearchHit, settingsAreas } from "@plainva/ui";
import { loadAccountCards, type AccountCard } from "./services/cloudAccountCards";
import { getMobileWorkspaceStatus } from "./services/mobileWorkspaceSecurity";
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

/**
 * The query of the settings search outlives the screen: a hit pushes its page,
 * and back returns to the same hits instead of an empty field.
 */
let lastQuery = "";
function rememberQuery(next: string) { lastQuery = next; }

export function SettingsScreen({
  onBack,
  onOpenArea,
  onOpenVaults,
  onOpenHit,
  barCount,
}: {
  onBack: () => void;
  /** Pushes the detail screen of a catalog area (id from the shared catalog). */
  onOpenArea: (id: string) => void;
  onOpenVaults: () => void;
  /** Opens what a search hit names: its page, then the row (settings plan 2026-10-29, § 4.3). */
  onOpenHit: (hit: SettingsSearchHit) => void;
  /** Areas currently in the bar — shown as the summary of the bars row. */
  barCount: number;
}) {
  const { t } = useTranslation();
  const [vaultName, setVaultName] = useState("");
  const [vaultEntry, setVaultEntry] = useState<VaultEntry | null>(null);
  const syncStatus = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const [cards, setCards] = useState<AccountCard[] | null>(null);
  const [query, setQueryState] = useState(lastQuery);
  const setQuery = (next: string) => { rememberQuery(next); setQueryState(next); };
  const hits = useMemo(() => (query.trim() ? searchSettings(query, { shell: "mobile", t }) : []), [query, t]);
  const [securityPhase, setSecurityPhase] = useState<string | null>(null);
  useEffect(() => {
    const reload = () => void getActiveVaultEntry().then((e) => {
      setVaultEntry(e);
      setVaultName(e.name || t("mobile.vaultLocal"));
      // The states of the accounts, calendar, mail and security rows (E15).
      void loadAccountCards().then(({ cards: next }) => setCards(next)).catch(() => setCards([]));
      void getMobileWorkspaceStatus(e.id).then((status) => setSecurityPhase(status?.phase ?? null)).catch(() => setSecurityPhase(null));
    });
    reload();
    window.addEventListener("m-vaults-changed", reload);
    window.addEventListener("m-vault-switched", reload);
    window.addEventListener("m-pim-changed", reload);
    return () => {
      window.removeEventListener("m-vaults-changed", reload);
      window.removeEventListener("m-vault-switched", reload);
      window.removeEventListener("m-pim-changed", reload);
    };
  }, [t]);

  /** The providers carrying a service, by name - "Google · iCloud" - or "Off". */
  const carriers = (service?: CloudServiceId): string => {
    if (!cards) return "";
    const names = [...new Set(cards
      .filter((card) => !service || (card.services.includes(service) && !(card.record && isServiceOff(card.record, service))))
      .map((card) => familyLabel(card.family)))];
    return names.length ? names.join(" · ") : t("common.off");
  };
  const areaState = (id: string): string => {
    if (id === "bars") return t("mobile.navBarSummary", { n: barCount });
    if (id === "cloudAccounts") return carriers();
    if (id === "pim") return carriers("calendar");
    if (id === "mail") return carriers("mail");
    // The phase of an encrypted workspace, in the words of the security page.
    if (id === "security") return securityPhase ? t(`workspaceSecurity.phase.${securityPhase}`) : t("common.off");
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
        {/* The search over all settings (E2), above the area list. While it
            holds a query, the hits stand in place of the list. */}
        <SearchField
          value={query}
          onValueChange={setQuery}
          placeholder={t("settings.searchPlaceholder")}
          aria-label={t("settings.searchPlaceholder")}
          clearLabel={t("sidebar.clearSearch")}
          data-testid="settings-search"
          enterKeyHint="search"
        />
        {query.trim() ? (
          hits.length > 0 ? (
            <GroupCard className="pv-setsearch-hits">
              <RowList>
                {hits.map((hit) => (
                  <Row
                    key={hit.id}
                    data-testid="settings-search-hit"
                    data-kind={hit.kind}
                    title={hit.title}
                    subtitle={[hit.path, hit.hidden ? t("settings.searchNeedsAccount") : ""].filter(Boolean).join(" · ") || undefined}
                    wrap
                    end={<ChevronRight className="m-chevron" size={ICON.ui} />}
                    onClick={() => onOpenHit(hit)}
                  />
                ))}
              </RowList>
            </GroupCard>
          ) : (
            <EmptyState icon={<Search size={ICON.empty} />}>{t("settings.searchNoHits")}</EmptyState>
          )
        ) : (<>

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
        </>)}
      </div>
    </div>
  );
}
