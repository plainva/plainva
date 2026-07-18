import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Cloud, Folder, Keyboard, Settings2 } from "lucide-react";
import { settingsAreas, type SettingsWorld } from "@plainva/ui";

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
}) => {
  const { t } = useTranslation();

  const groupLabel: React.CSSProperties = {
    padding: "0 0.4rem 0.25rem",
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  };

  const renderArea = (areaWorld: SettingsWorld) =>
    settingsAreas(areaWorld).map((a) => {
      const Icon = a.icon;
      const active = world === areaWorld && page === a.id;
      return (
        <button
          key={a.id}
          onClick={() => onOpenArea(areaWorld, a.id)}
          className={active ? "pv-navlink is-active" : "pv-navlink"}
        >
          <Icon size={15} aria-hidden />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t(a.labelKey)}
          </span>
        </button>
      );
    });

  return (
    <div
      className="custom-scrollbar"
      style={{
        width: "220px",
        flexShrink: 0,
        borderRight: "1px solid var(--border-color)",
        background: "var(--bg-secondary)",
        padding: "0.75rem",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
      }}
    >
      <div style={groupLabel}>
        <Settings2 size={13} color="var(--accent-color)" style={{ flexShrink: 0 }} />
        {t("settings.sectionApp", { defaultValue: "App" })}
      </div>
      {renderArea("app")}

      {vaultName && (
        <>
          <div style={{ ...groupLabel, marginTop: "1rem" }}>
            <Folder size={13} color="var(--accent-color)" style={{ flexShrink: 0 }} />
            {t("settings.sectionVault", { defaultValue: "Vault" })}
          </div>
          <div className="pv-vaultcard" title={vaultPath ?? undefined}>
            <div className="pv-vaultcard-top">
              <Folder size={15} className="pv-vaultcard-icon" aria-hidden />
              <span className="pv-vaultcard-name" data-testid="settings-vault-name">{vaultName}</span>
              {vaultHasSync && <Cloud size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} aria-hidden />}
              {vaultIsActive && <span className="pv-vaultcard-dot" title={t("settings.activeVault")} />}
            </div>
            {canSwitchVault && (
              <button type="button" className="pv-vaultcard-switch" onClick={onSwitchVault}>
                <ArrowLeftRight size={13} aria-hidden />
                {t("settings.switchVault", { defaultValue: "Wechseln" })}
              </button>
            )}
          </div>
          {renderArea("vault")}
        </>
      )}

      <div style={{ marginTop: "auto", paddingTop: "1rem" }}>
        <button
          onClick={onShowShortcuts}
          className="pv-navlink"
          style={{ color: "var(--text-muted)", fontSize: "0.8rem", padding: "0.4rem" }}
        >
          <Keyboard size={15} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, textAlign: "left" }}>{t("settings.showShortcuts")}</span>
          <kbd style={{ fontSize: "0.7rem", fontFamily: "monospace", border: "1px solid var(--border-color)", borderRadius: "var(--radius-xs)", padding: "0 4px", color: "var(--text-faint)", flexShrink: 0 }}>F1</kbd>
        </button>
      </div>
    </div>
  );
};
