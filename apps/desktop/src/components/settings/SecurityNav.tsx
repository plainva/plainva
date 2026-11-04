import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { ICON, SECURITY_AREA_GROUPS, securityAreas, type SecurityAreaId, type SettingsSearchHit, type SettingsWorld } from "@plainva/ui";
import { SettingsRail } from "./SettingsRail";

/**
 * Second-level security navigation (Security & Sharing IA v2, P1).
 *
 * On the second level of "Security & Sharing" this REPLACES the settings left
 * column (`SettingsNav`): a "‹ Overview" back affordance returns to the first
 * level, below it the management areas grouped into "Your access" / "Sharing".
 * Reuses the themed `.pv-navlink` — no new surface, so no extra theme override.
 * The search over all settings stays on top (`SettingsRail`, Sammelplan
 * § 3.169 Nr. 2): it used to belong to `SettingsNav` and left with it.
 */
export interface SecurityNavProps {
  /** The active area. */
  area: SecurityAreaId;
  onSelect: (area: SecurityAreaId) => void;
  /** Back to the overview (first level → normal SettingsNav returns). */
  onBack: () => void;
  /** The window's search (see `SettingsNav`). */
  searchQuery: string;
  onSearchQuery: (query: string) => void;
  /** Vault areas hidden for the shown vault. */
  hiddenAreaIds?: string[];
  onOpenHit: (hit: SettingsSearchHit) => void;
}

/** The second level is a vault page: the search covers both worlds. */
const SEARCH_WORLDS: SettingsWorld[] = ["app", "vault"];

export const SecurityNav: React.FC<SecurityNavProps> = ({ area, onSelect, onBack, searchQuery, onSearchQuery, hiddenAreaIds, onOpenHit }) => {
  const { t } = useTranslation();

  const groupLabel: React.CSSProperties = {
    padding: "0 0.4rem 0.25rem",
    marginTop: "0.75rem",
    fontSize: "var(--text-sm)",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  };

  return (
    <SettingsRail
      query={searchQuery}
      onQuery={onSearchQuery}
      worlds={SEARCH_WORLDS}
      hiddenAreaIds={hiddenAreaIds}
      onOpenHit={onOpenHit}
      testId="settings-security-nav"
    >
      <button type="button" className="pv-navlink pv-security-back" onClick={onBack}>
        <ChevronLeft size={ICON.ui} aria-hidden />
        <span>{t("workspaceSecurity.overview", { defaultValue: "Overview" })}</span>
      </button>

      {SECURITY_AREA_GROUPS.map(({ group, labelKey }) => (
        <React.Fragment key={group}>
          <div style={groupLabel}>{t(labelKey)}</div>
          {securityAreas(group).map((a) => {
            const Icon = a.icon;
            const active = area === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelect(a.id)}
                className={active ? "pv-navlink is-active" : "pv-navlink"}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={ICON.ui} aria-hidden />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
                  {t(a.labelKey)}
                </span>
              </button>
            );
          })}
        </React.Fragment>
      ))}
    </SettingsRail>
  );
};
