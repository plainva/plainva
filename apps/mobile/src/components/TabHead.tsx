import { MoreVertical } from "lucide-react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SyncIndicator } from "./SyncIndicator";

/**
 * Shared large app bar for EVERY tab root (maintainer feedback: title, search
 * and the menu must sit in the same spot on all main screens — nothing may
 * jump when switching tabs). The big title shares the top row with sync + the
 * three-dot menu (no separate eyebrow line — that wasted vertical space); the
 * search pill sits below. Every tab passes its localized name; Home the vault.
 */
export function TabHead({
  title,
  onSearch,
  onMore,
}: {
  title: string;
  onSearch: () => void;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="m-appbar">
      <div className="m-appbar-row">
        <h1 className="m-appbar-title">{title}</h1>
        <span className="m-headactions">
          <SyncIndicator />
          <button aria-label={t("mobile.tabMore")} className="m-iconbtn" onClick={onMore}>
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
