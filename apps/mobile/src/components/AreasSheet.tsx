import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { SheetGrip } from "./SheetGrip";
import { TAB_POOL, type TabScreenId } from "../navigation";

/**
 * Areas sheet (plan P5 / E10). With the fixed "More" tab gone, the bar carries
 * only the 3–5 areas the user picked; everything else lives here.
 *
 * ONE destination, two ways in: the ▾ next to the app-bar title (reachable from
 * every tab, including when Home is not in the bar at all) and a long press on
 * the navigation bar. The bottom row jumps straight to the setting that
 * arranges the bar, so "I want this in the bar" is one tap away from noticing it.
 */
export function AreasSheet({
  active,
  onPick,
  onArrange,
  onClose,
}: {
  active: TabScreenId;
  onPick: (id: TabScreenId) => void;
  onArrange: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="m-sheet" data-testid="areas-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sectionlabel">{t("mobile.areas", { defaultValue: "Bereiche" })}</p>
        <div>
          {TAB_POOL.map((def) => {
            const Icon = def.icon;
            const isActive = def.id === active;
            return (
              <button
                className={`m-row${isActive ? " m-row--current" : ""}`}
                data-testid={`areas-${def.id}`}
                key={def.id}
                onClick={() => onPick(def.id)}
              >
                <Icon className="m-accent" size={18} />
                <span className="m-areas-grow">{t(def.labelKey)}</span>
                {isActive && <Check size={18} />}
              </button>
            );
          })}
          <button className="m-row" onClick={onArrange}>
            <span className="m-areas-grow m-areas-arrange">{t("mobile.navBarArrange", { defaultValue: "Navigationsleiste anpassen…" })}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
