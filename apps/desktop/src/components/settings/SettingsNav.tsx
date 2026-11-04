import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Cloud, Folder, FolderCog, Keyboard, Settings2 } from "lucide-react";
import { ICON, InfoTip, settingsAreas, type SettingsSearchHit, type SettingsWorld } from "@plainva/ui";
import { SettingsRail } from "./SettingsRail";

/**
 * Left settings rail (redesign 2026-07-18, P2 — variant "quiet cards").
 * Two groups (App / Vault) with an icon per area; the vault is an IDENTITY
 * CARD (name + active dot + a "switch" text link opening the vault picker) —
 * deliberately no dropdown in the rail. With a single known vault the card is
 * display-only (no switch link).
 */
export interface SettingsNavProps {
  /** Which world the content shows — decides which rail entry is active. */
  world: SettingsWorld;
  /** Active area id within that world. */
  page: string;
  onOpenArea: (world: SettingsWorld, areaId: string) => void;
  /** Basename of the vault the VAULT areas show; null = no known vault. */
  vaultName: string | null;
  /** Full path of that vault (tooltip on the card). */
  vaultPath: string | null;
  /** True when the shown vault is the one open in the app (accent dot). */
  vaultIsActive: boolean;
  /** True when the shown vault has a sync provider configured (cloud icon). */
  vaultHasSync: boolean;
  /** More than one known vault → the switch link is offered. */
  canSwitchVault: boolean;
  onSwitchVault: () => void;
  onShowShortcuts: () => void;
  /** Vault areas hidden for the shown vault (service not carried by any
   * cloud account — mockup screen 6; Cloud-Konten itself is never hidden). */
  hiddenAreaIds?: string[];
  /** Opens what a search hit names (settings plan 2026-10-29, § 4.3). */
  onOpenHit: (hit: SettingsSearchHit) => void;
  /** The search over all settings; held by the window so it outlives a swap of the rail (`SettingsRail`). */
  searchQuery: string;
  onSearchQuery: (query: string) => void;
  /** Opens the vault's own page: name, export, deletion (the phone's vault page). */
  onOpenVaultDetails: () => void;
  vaultDetailsActive?: boolean;
}

export const SettingsNav: React.FC<SettingsNavProps> = ({
  world,
  page,
  onOpenArea,
  vaultName,
  vaultPath,
  vaultIsActive,
  vaultHasSync,
  canSwitchVault,
  onSwitchVault,
  onShowShortcuts,
  hiddenAreaIds,
  onOpenHit,
  searchQuery,
  onSearchQuery,
  onOpenVaultDetails,
  vaultDetailsActive,
}) => {
  const { t } = useTranslation();
  const searchWorlds = useMemo<SettingsWorld[]>(() => (vaultName ? ["app", "vault"] : ["app"]), [vaultName]);

  const groupLabel: React.CSSProperties = {
    padding: "0 0.4rem 0.25rem",
    fontSize: "var(--text-sm)",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  };

  const renderArea = (areaWorld: SettingsWorld) =>
    settingsAreas(areaWorld)
      .filter((a) => !(areaWorld === "vault" && hiddenAreaIds?.includes(a.id)))
      .map((a) => {
      const Icon = a.icon;
      const active = world === areaWorld && page === a.id;
      return (
        <button
          key={a.id}
          onClick={() => onOpenArea(areaWorld, a.id)}
          className={active ? "pv-navlink is-active" : "pv-navlink"}
        >
          <Icon size={ICON.ui} aria-hidden />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t(a.labelKey)}
          </span>
        </button>
      );
    });

  return (
    // The search on top of the rail is the window's (`SettingsRail`): the same
    // field stands on the second level of Security & Sharing.
    <SettingsRail
      query={searchQuery}
      onQuery={onSearchQuery}
      worlds={searchWorlds}
      hiddenAreaIds={hiddenAreaIds}
      onOpenHit={onOpenHit}
      testId="settings-nav"
      footer={
        <div style={{ marginTop: "auto", paddingTop: "1rem" }}>
          <button
            onClick={onShowShortcuts}
            className="pv-navlink"
            style={{ color: "var(--text-muted)", fontSize: "var(--text-ui)", padding: "0.4rem" }}
          >
            <Keyboard size={ICON.ui} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: "left" }}>{t("settings.showShortcuts")}</span>
            <kbd style={{ fontSize: "var(--text-xs)", fontFamily: "monospace", border: "1px solid var(--border-color)", borderRadius: "var(--radius-xs)", padding: "0 4px", color: "var(--text-faint)", flexShrink: 0 }}>F1</kbd>
          </button>
        </div>
      }
    >
      <div style={groupLabel}>
        <Settings2 size={ICON.ui} color="var(--accent-color)" style={{ flexShrink: 0 }} />
        {t("settings.sectionApp", { defaultValue: "App" })}
        {/* Said once for the section (settings plan 2026-10-29, Q1): no app page
            repeats "on this device only" on a row of its own. */}
        <InfoTip label={t("settings.sectionApp", { defaultValue: "App" })} info={t("settings.sectionAppInfo")} testId="settings-nav-app-info" />
      </div>
      {renderArea("app")}

      {vaultName && (
        <>
          <div style={{ ...groupLabel, marginTop: "1rem" }}>
            <Folder size={ICON.ui} color="var(--accent-color)" style={{ flexShrink: 0 }} />
            {t("settings.sectionVault", { defaultValue: "Vault" })}
          </div>
          <div className="pv-vaultcard" data-tip={vaultPath ?? undefined}>
            <div className="pv-vaultcard-top">
              <Folder size={ICON.ui} className="pv-vaultcard-icon" aria-hidden />
              <span className="pv-vaultcard-name" data-testid="settings-vault-name">{vaultName}</span>
              {vaultHasSync && <Cloud size={ICON.ui} color="var(--text-muted)" style={{ flexShrink: 0 }} aria-hidden />}
              {vaultIsActive && <span className="pv-vaultcard-dot" data-tip={t("settings.activeVault")} />}
            </div>
            {/* The card's links: switching (with more than one vault) and the
                vault's own page — rename, export, delete, the phone's vault
                page (Sammelplan § 3.169 Nr. 3). */}
            {[
              ...(canSwitchVault
                ? [{ id: "switch", icon: <ArrowLeftRight size={ICON.ui} aria-hidden />, label: t("settings.switchVault", { defaultValue: "Wechseln" }), onClick: onSwitchVault, current: false }]
                : []),
              { id: "details", icon: <FolderCog size={ICON.ui} aria-hidden />, label: t("mobile.vaultDetails"), onClick: onOpenVaultDetails, current: !!vaultDetailsActive },
            ].map((link) => (
              <button
                key={link.id}
                type="button"
                className="pv-vaultcard-switch"
                onClick={link.onClick}
                aria-current={link.current ? "page" : undefined}
                data-testid={`settings-vault-${link.id}-link`}
              >
                {link.icon}
                {link.label}
              </button>
            ))}
          </div>
          {renderArea("vault")}
        </>
      )}
    </SettingsRail>
  );
};
