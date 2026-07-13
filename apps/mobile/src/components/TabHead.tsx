import { MoreVertical } from "lucide-react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SyncIndicator } from "./SyncIndicator";

/**
 * Shared large app bar for EVERY tab root (maintainer feedback: title, search
 * and the ⋮ menu must sit in the same spot on all main screens — nothing may
 * jump when switching tabs). Row 1: eyebrow slot + sync + ⋮; row 2: the big
 * title; row 3: the search pill. Home passes the vault eyebrow/name, every
 * other tab passes its localized name.
 */
export function TabHead({
  title,
  eyebrow,
  onSearch,
  onMore,
}: {
  title: string;
  eyebrow?: string;
  onSearch: () => void;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="m-appbar">
      <div className="m-appbar-row">
        <span className="m-appbar-eyebrow">{eyebrow ?? " "}</span>
        <span className="m-headactions">
          <SyncIndicator />
          <button aria-label={t("mobile.tabMore")} className="m-iconbtn" onClick={onMore}>
            <MoreVertical size={20} />
          </button>
        </span>
      </div>
      <h1 className="m-appbar-title">{title}</h1>
      <button className="m-searchpill" onClick={onSearch}>
        <Search size={17} />
        <span>{t("mobile.searchHint")}</span>
      </button>
    </div>
  );
}
