import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { ICON, SECURITY_AREA_GROUPS, securityAreas, type SecurityAreaId } from "@plainva/ui";

/**
 * Second-level security navigation (Security & Sharing IA v2, P1).
 *
 * On the second level of "Security & Sharing" this REPLACES the settings left
 * column (`SettingsNav`): a "‹ Overview" back affordance returns to the first
 * level, below it the management areas grouped into "Your access" / "Sharing".
 * Reuses the themed `.pv-navlink` — no new surface, so no extra theme override.
 */
export interface SecurityNavProps {
  /** The active area. */
  area: SecurityAreaId;
  onSelect: (area: SecurityAreaId) => void;
  /** Back to the overview (first level → normal SettingsNav returns). */
  onBack: () => void;
}

export const SecurityNav: React.FC<SecurityNavProps> = ({ area, onSelect, onBack }) => {
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
    </div>
  );
};
