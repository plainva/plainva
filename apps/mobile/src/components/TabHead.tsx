import { ChevronDown, MoreVertical } from "lucide-react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SyncIndicator } from "./SyncIndicator";

/**
 * Shared large app bar for EVERY tab root (maintainer feedback: title, search
 * and the menu must sit in the same spot on all main screens — nothing may
 * jump when switching tabs). The big title shares the top row with sync + the
 * three-dot button (no separate eyebrow line — that wasted vertical space);
 * the search pill sits below. Every tab passes its localized name; Home the
 * vault. The ⋮ opens the SETTINGS directly (redesign P3).
 *
 * Since 2026-07-25 (plan P5/E10) the title itself is the AREA SWITCHER: with
 * the fixed "More" tab gone, the ▾ next to the title is how the areas outside
 * the bar are reached — and it works from every tab, including when Home is
 * not in the bar at all.
 */
export function TabHead({
  title,
  onSearch,
  onSettings,
  onAreas,
}: {
  title: string;
  /** Omitted on screens with their own search (e.g. the graph tab, package E). */
  onSearch?: () => void;
  onSettings: () => void;
  /** Opens the areas sheet; absent leaves the title a plain heading. */
  onAreas?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="m-appbar">
      <div className="m-appbar-row">
        {onAreas ? (
          <button className="m-appbar-title m-appbar-title--switch" data-testid="areas-switch" onClick={onAreas}>
            {title}
            <ChevronDown className="m-accent" size={15} />
          </button>
        ) : (
          <h1 className="m-appbar-title">{title}</h1>
        )}
        <span className="m-headactions">
          <SyncIndicator />
          <button aria-label={t("mobile.sectionSettings")} className="m-iconbtn" onClick={onSettings}>
            <MoreVertical size={20} />
          </button>
        </span>
      </div>
      {onSearch && (
        <button className="m-searchpill" onClick={onSearch}>
          <Search size={17} />
          <span>{t("mobile.searchHint")}</span>
        </button>
      )}
    </div>
  );
}
