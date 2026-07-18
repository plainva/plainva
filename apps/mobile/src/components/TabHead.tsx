import { MoreVertical } from "lucide-react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SyncIndicator } from "./SyncIndicator";

/**
 * Shared large app bar for EVERY tab root (maintainer feedback: title, search
 * and the menu must sit in the same spot on all main screens — nothing may
 * jump when switching tabs). The big title shares the top row with sync + the
 * three-dot button (no separate eyebrow line — that wasted vertical space);
 * the search pill sits below. Every tab passes its localized name; Home the
 * vault. The ⋮ opens the SETTINGS directly (redesign P3) — the area overview
 * lives behind the bar's fixed More tab.
 */
export function TabHead({
  title,
  onSearch,
  onSettings,
}: {
  title: string;
  onSearch: () => void;
  onSettings: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="m-appbar">
      <div className="m-appbar-row">
        <h1 className="m-appbar-title">{title}</h1>
        <span className="m-headactions">
          <SyncIndicator />
          <button aria-label={t("mobile.sectionSettings")} className="m-iconbtn" onClick={onSettings}>
            <MoreVertical size={20} />
          </button>
        </span>
      </div>
      <button className="m-searchpill" onClick={onSearch}>
        <Search size={17} />
        <span>{t("mobile.searchHint")}</span>
      </button>
    </div>
  );
}
