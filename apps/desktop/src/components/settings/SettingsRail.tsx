import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { EmptyState, ICON, Row, RowList, SearchField, searchSettings, type SettingsSearchHit, type SettingsWorld } from "@plainva/ui";

/**
 * The left column of the settings window, whichever navigation it carries —
 * the areas (`SettingsNav`) or the second level of Security & Sharing
 * (`SecurityNav`) — with the search over all settings on top of it.
 *
 * The search used to live inside `SettingsNav`, so it vanished while the
 * second level replaced that column (Sammelplan § 3.169 Nr. 2). One rail, one
 * search: both navigations render through this component, and the query
 * belongs to the settings window, so it survives the swap of the column.
 *
 * While the field holds a query, the rail lists the hits — rows, as
 * page › card › row — in place of its navigation (E2 of the settings plan).
 */
export interface SettingsRailProps {
  query: string;
  onQuery: (query: string) => void;
  /** Which worlds the search covers: the app always, the vault when one is shown. */
  worlds: SettingsWorld[];
  /** Vault areas hidden for the shown vault; their hits say what they need. */
  hiddenAreaIds?: string[];
  /** Opens what a hit names (settings plan 2026-10-29, § 4.3). */
  onOpenHit: (hit: SettingsSearchHit) => void;
  /** The rail's own navigation, shown while no query is typed. */
  children: React.ReactNode;
  /** Stays at the foot of the rail, query or not. */
  footer?: React.ReactNode;
  testId?: string;
}

export const SettingsRail: React.FC<SettingsRailProps> = ({ query, onQuery, worlds, hiddenAreaIds, onOpenHit, children, footer, testId }) => {
  const { t } = useTranslation();
  const hits = useMemo(
    () => (query.trim() ? searchSettings(query, { shell: "desktop", t, worlds, hiddenAreas: hiddenAreaIds }) : []),
    [query, t, worlds, hiddenAreaIds],
  );

  return (
    <div
      className="custom-scrollbar"
      data-testid={testId}
      style={{
        width: "220px",
        flexShrink: 0,
        borderRight: "1px solid var(--border-color)",
        background: "var(--bg-secondary)",
        padding: "var(--space-3)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
      }}
    >
      <SearchField
        className="pv-setsearch"
        value={query}
        onValueChange={onQuery}
        placeholder={t("settings.searchPlaceholder")}
        aria-label={t("settings.searchPlaceholder")}
        clearLabel={t("sidebar.clearSearch")}
        data-testid="settings-search"
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) {
            e.preventDefault();
            onOpenHit(hits[0]);
          }
        }}
      />
      {query.trim() ? (
        hits.length > 0 ? (
          // The same row the phone draws for a hit (one definition per interaction).
          <div className="pv-setsearch-hits" role="group" aria-label={t("settings.searchHits")} data-testid="settings-search-hits">
            <RowList>
              {hits.map((hit) => (
                <Row
                  key={hit.id}
                  data-testid="settings-search-hit"
                  data-kind={hit.kind}
                  title={hit.title}
                  subtitle={[hit.path, hit.hidden ? t("settings.searchNeedsAccount") : ""].filter(Boolean).join(" · ") || undefined}
                  wrap
                  onClick={() => onOpenHit(hit)}
                />
              ))}
            </RowList>
          </div>
        ) : (
          <EmptyState icon={<Search size={ICON.empty} />}>{t("settings.searchNoHits")}</EmptyState>
        )
      ) : (
        children
      )}
      {footer}
    </div>
  );
};
