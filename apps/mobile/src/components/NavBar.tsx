import { useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid } from "lucide-react";
import { ICON } from "@plainva/ui";
import { haptics } from "../services/haptics";
import { LONG_PRESS_MS } from "../lib/useLongPress";
import { getChromeScroll, subscribeChromeScroll } from "../services/chromeScroll";
import { TAB_POOL, type TabScreenId } from "../navigation";

/**
 * The phone's navigation bar.
 *
 * It carries the areas the bar model says are visible (S10) plus ONE fixed
 * entry, "Areas", which opens the sheet that reaches everything else. That
 * entry sits deliberately outside the arrangeable model, like the desktop
 * rail's Help and Settings: a way back that a user can hide is not a way back.
 *
 * A LONG PRESS anywhere on the bar opens the same sheet — the shortcut for
 * frequent users; the visible entry and the app-bar title (▾) are the
 * discoverable ways in. A short tap stays a tab switch.
 */
export function NavBar({
  tabs,
  activeTab,
  areasOpen,
  onPick,
  onOpenAreas,
}: {
  tabs: TabScreenId[];
  /** The lit tab, or null while an overlay covers the tabs. */
  activeTab: TabScreenId | null;
  areasOpen: boolean;
  onPick: (id: TabScreenId) => void;
  onOpenAreas: () => void;
}) {
  const { t } = useTranslation();
  const pressTimer = useRef<number | null>(null);
  // Reading downwards, the bar draws itself in to labels-off (S11 / the
  // mockup's retreating bar); it opens again on the way back up. Its
  // destinations stay tappable throughout — this hides words, never targets.
  const { away } = useSyncExternalStore(subscribeChromeScroll, getChromeScroll);

  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  const beginPress = () => {
    cancelPress();
    // The same hold as everywhere else (S12) — it was 450 ms here, which made
    // the bar answer sooner than the rows above it for the same movement.
    pressTimer.current = window.setTimeout(() => {
      haptics.medium();
      onOpenAreas();
    }, LONG_PRESS_MS);
  };

  return (
    <nav
      aria-label="Tabs"
      className={`m-tabbar${away ? " is-away" : ""}`}
      onContextMenu={(e) => { e.preventDefault(); haptics.medium(); onOpenAreas(); }}
      onPointerDown={beginPress}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
    >
      {tabs.map((id) => {
        const def = TAB_POOL.find((p) => p.id === id);
        if (!def) return null;
        const Icon = def.icon;
        return (
          <button
            className={`m-tab${activeTab === id ? " is-active" : ""}`}
            key={id}
            onClick={() => onPick(id)}
            type="button"
          >
            <span className="m-tab-pill">
              <Icon size={ICON.head} />
            </span>
            {/* Bar-specific short name where one exists (E7) — an ellipsis
                ("Datenbanke…") is not a shortened label, it is a broken one. */}
            <span className="m-tab-label">{t(def.barLabelKey ?? def.labelKey)}</span>
          </button>
        );
      })}
      <button
        className={`m-tab${areasOpen ? " is-active" : ""}`}
        data-testid="tab-areas"
        onClick={() => { haptics.light(); onOpenAreas(); }}
        type="button"
      >
        <span className="m-tab-pill">
          <LayoutGrid size={ICON.head} />
        </span>
        <span className="m-tab-label">{t("mobile.areas")}</span>
      </button>
    </nav>
  );
}
