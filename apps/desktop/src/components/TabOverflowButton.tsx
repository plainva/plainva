import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronsRight } from "lucide-react";
import { ICON, IconButton, MenuItem, MenuSurface } from "@plainva/ui";
import { tabLabel } from "./tabStrip";
import { virtualTabMeta } from "./graph/virtualPaths";

/**
 * The tabs that do not fit, one click away (E13).
 *
 * The strips used to scroll sideways, so a tab past the edge was a drag away
 * and a scrollbar sat under the strip — a control nobody looks for there
 * (finding 2026-09-22). This button says how many are out of sight and lists
 * them; choosing one brings it into the window, because the window always
 * holds the active tab.
 */
export function TabOverflowButton({ hidden, tabs, onSelect }: {
  /** Indices of the tabs outside the window, in document order. */
  hidden: readonly number[];
  tabs: readonly string[];
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  if (hidden.length === 0) return null;
  const label = t("titlebar.moreTabs", { count: hidden.length });
  return (
    <>
      <IconButton
        className="tabstrip-more"
        label={label}
        data-testid="tabstrip-more"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          setAt({ x: box.left, y: box.bottom });
        }}
      >
        <ChevronsRight size={ICON.ui} />
        <span className="tabstrip-more-count">{hidden.length}</span>
      </IconButton>
      {at && (
        <MenuSurface open onClose={() => setAt(null)} at={at} minWidth={200} ariaLabel={label}>
          {hidden.map((i) => {
            const virtual = virtualTabMeta(tabs[i]);
            return (
              <MenuItem
                key={`${tabs[i]}-${i}`}
                data-testid={`tabstrip-more-${i}`}
                onSelect={() => { setAt(null); onSelect(i); }}
              >
                {virtual ? t(virtual.labelKey, { defaultValue: virtual.defaultLabel }) : tabLabel(tabs[i])}
              </MenuItem>
            );
          })}
        </MenuSurface>
      )}
    </>
  );
}
