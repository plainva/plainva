import { useTranslation } from "react-i18next";
import { SlidersHorizontal } from "lucide-react";
import { GroupCard, ICON, Row, RowList, SectionLabel, visibleAreas, type AreaOrder } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { TAB_POOL, type TabScreenId } from "../navigation";

/**
 * Areas sheet (plan P5 / E10). With the fixed "More" tab gone, the bar carries
 * only the 3–5 areas the user picked; everything else lives here.
 *
 * ONE destination, three ways in since S10: the fixed "Areas" entry at the end
 * of the bar, the ▾ next to the app-bar title (reachable from
 * every tab, including when Home is not in the bar at all) and a long press on
 * the navigation bar. The bottom row jumps straight to the setting that
 * arranges the bar, so "I want this in the bar" is one tap away from noticing it.
 *
 * It shows the user's OWN arrangement: the areas of the bar first, then the
 * rest, in the order they were put in. It used to list the factory pool, so
 * the same eight areas had two orders — the one in the bar and the one here
 * (finding 2026-09-22).
 *
 * It is a list of PLACES, not a choice (finding 2026-09-24, E20): tapping a row
 * goes there. So no row wears a ring — the ring list read as a setting with
 * four empty answers under "not in the bar" — and the area on screen is the
 * row's `current` state: tinted, bold, a check, `aria-current`. The 22.09.
 * plan had filed this sheet as a choice card; its mockup had it right.
 */
export function AreasSheet({
  active,
  order,
  onPick,
  onArrange,
  onClose,
}: {
  active: TabScreenId;
  /** The user's arrangement of the bar; without it the factory order is used. */
  order?: AreaOrder;
  onPick: (id: TabScreenId) => void;
  onArrange: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const known = new Set(TAB_POOL.map((d) => d.id));
  const inBar = (order ? (visibleAreas(order) as TabScreenId[]) : TAB_POOL.slice(0, 4).map((d) => d.id)).filter((id) => known.has(id));
  const outside = (order ? (order.order as TabScreenId[]) : TAB_POOL.map((d) => d.id)).filter((id) => known.has(id) && !inBar.includes(id));

  const group = (ids: readonly TabScreenId[]) => (
    <GroupCard>
      <RowList>
        {ids.map((id) => {
          const def = TAB_POOL.find((d) => d.id === id)!;
          const Icon = def.icon;
          return (
            <Row
              key={id}
              current={id === active}
              data-testid={`areas-${id}`}
              icon={<Icon size={ICON.head} />}
              title={t(def.labelKey)}
              onClick={() => onPick(id)}
            />
          );
        })}
      </RowList>
    </GroupCard>
  );

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="pv-sheet m-sheet" data-testid="areas-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        {/* The sheet's own title, then a divider between the bar's areas and
            the rest. The second heading used to say "reachable via Areas"
            INSIDE "Areas". */}
        <p className="m-sheet-title">{t("mobile.areas")}</p>
        {group(inBar)}
        {outside.length > 0 && (
          <>
            <SectionLabel className="m-sheet-divider">{t("mobile.areasOutside")}</SectionLabel>
            {group(outside)}
          </>
        )}
        <RowList>
          <Row
            className="m-areas-arrange"
            icon={<SlidersHorizontal size={ICON.head} />}
            title={t("mobile.navBarArrange")}
            onClick={onArrange}
            data-testid="areas-arrange"
          />
        </RowList>
      </div>
    </div>
  );
}
