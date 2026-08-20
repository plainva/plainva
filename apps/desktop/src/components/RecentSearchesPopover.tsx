import { useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Clock, X } from "lucide-react";
import {
  clearRecentSearches,
  ICON,
  loadRecentSearches,
  useFixedPopover,
} from "@plainva/ui";

/**
 * The last few searches, offered under the sidebar's search field while it is
 * focused and empty.
 *
 * The phone has had this since S16; the desktop did not, although typing a
 * long query again is no more pleasant with a keyboard (parity gap
 * `recent-searches`). The store is the shared one — same rules, same cap of
 * five, still device-local.
 *
 * A popover rather than a strip above the tree: a strip would push the whole
 * file tree down every time the field takes focus, which is a lot of movement
 * for a convenience.
 */
export function RecentSearchesPopover({
  vaultPath,
  anchorRef,
  open,
  reloadKey,
  onPick,
  onClose,
}: {
  vaultPath: string;
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  /** Bumped after a search is remembered so the list reopens up to date. */
  reloadKey: number;
  onPick: (query: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<string[]>([]);
  const popRef = useFixedPopover(open && items.length > 0, anchorRef);

  useEffect(() => {
    if (!open || !vaultPath) return;
    let alive = true;
    void loadRecentSearches(vaultPath)
      .then((r) => {
        if (alive) setItems(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, vaultPath, reloadKey]);

  if (!open || items.length === 0) return null;

  return (
    <div
      ref={popRef}
      className="pv-popover pv-popover--fixed"
      role="listbox"
      aria-label={t("search.recent")}
      // The field's blur fires before a click lands, so keep the pointer press
      // from stealing focus — otherwise picking an entry closes the popover
      // first and the click never reaches it.
      onMouseDown={(e) => e.preventDefault()}
      data-testid="recent-searches"
    >
      <div className="pv-popover-label">{t("search.recent")}</div>
      {items.map((q) => (
        <button
          key={q}
          type="button"
          role="option"
          aria-selected={false}
          className="pv-popover-row"
          onClick={() => onPick(q)}
        >
          <Clock size={ICON.meta} className="pv-popover-ic" />
          <span>{q}</span>
        </button>
      ))}
      <button
        type="button"
        className="pv-popover-row"
        onClick={() => {
          void clearRecentSearches(vaultPath).catch(() => {});
          setItems([]);
          onClose();
        }}
      >
        <X size={ICON.meta} className="pv-popover-ic" />
        <span>{t("search.clearRecent")}</span>
      </button>
    </div>
  );
}
