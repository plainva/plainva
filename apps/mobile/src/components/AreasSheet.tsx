import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
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
              className={id === active ? "m-row--current" : undefined}
              data-testid={`areas-${id}`}
              icon={<Icon className="m-accent" size={ICON.head} />}
              title={t(def.labelKey)}
              end={<span className={`m-slotmark${id === active ? " is-on" : ""}`} />}
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
        <SectionLabel>{t("mobile.areas")}</SectionLabel>
        {group(inBar)}
        {outside.length > 0 && (
          <>
            <SectionLabel>{t("mobile.navBarOutside")}</SectionLabel>
            {group(outside)}
          </>
        )}
        <GroupCard>
          <RowList>
            <Row
              title={t("mobile.navBarArrange")}
              end={<ArrowRight size={ICON.head} />}
              onClick={onArrange}
              data-testid="areas-arrange"
            />
          </RowList>
        </GroupCard>
      </div>
    </div>
  );
}
