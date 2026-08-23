import { useRef, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { ICON } from "@plainva/ui";
import { haptics } from "../services/haptics";
import { LONG_PRESS_MS } from "../lib/useLongPress";
import { getChromeScroll, subscribeChromeScroll } from "../services/chromeScroll";
import { getWindowClass, subscribeWindowClass, isRailClass } from "../services/windowClass";
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
 *
 * From the medium window class it becomes a navigation RAIL along the left
 * edge (S13, M3 Canonical Layouts): the destinations in the arranged order,
 * standing where a wider window has room and a thumb does not reach. The bar
 * retreat is a phone behaviour and stops there — a rail has no scroll to
 * follow, and nothing gains from it moving.
 *
 * The rail carries EVERY area (plan Mobile-Feedback, P2/E3), so it needs no
 * “Areas” entry and no long press: both exist to reach what the bar had to
 * leave out, and a rail leaves nothing out. In their place, at the foot, sits
 * settings — on a tablet the rail is the standing navigation surface, and the
 * way into settings should not be behind each screen's own ⋮.
 *
 * Beside settings, where the shell offers two columns, sits the switch that
 * folds the navigator away. It is deliberately NOT shaped like the entries
 * above it: those are destinations, this changes the layout, and a tool that
 * looks like a destination invites a tap that goes nowhere. It is also the
 * only place the switch exists — the rail is the one surface standing beside
 * every working surface, so no route can forget to offer it.
 */
export function NavBar({
  tabs,
  activeTab,
  areasOpen,
  navCollapsed,
  onPick,
  onOpenAreas,
  onOpenSettings,
  onToggleNav,
}: {
  /** What this shape shows: the visible slots on a phone, the pool in a rail. */
  tabs: TabScreenId[];
  /** The lit tab, or null while an overlay covers the tabs. */
  activeTab: TabScreenId | null;
  areasOpen: boolean;
  /** True while the navigator column is folded away. Only read in a rail. */
  navCollapsed: boolean;
  onPick: (id: TabScreenId) => void;
  onOpenAreas: () => void;
  onOpenSettings: () => void;
  /**
   * Undefined where there is no second column to fold — the shell decides
   * that, next to where it decides whether to render one. Answering it here
   * too would be a second opinion on the same question, which is how a rail
   * ends up offering a switch for a column that is not there.
   */
  onToggleNav?: () => void;
}) {
  const { t } = useTranslation();
  const pressTimer = useRef<number | null>(null);
  // Reading downwards, the bar draws itself in to labels-off (S11 / the
  // mockup's retreating bar); it opens again on the way back up. Its
  // destinations stay tappable throughout — this hides words, never targets.
  const { away } = useSyncExternalStore(subscribeChromeScroll, getChromeScroll);
  const windowClass = useSyncExternalStore(subscribeWindowClass, getWindowClass);
  const rail = isRailClass(windowClass);

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
      className={`m-tabbar${rail ? " m-tabbar--rail" : ""}${!rail && away ? " is-away" : ""}`}
      {...(rail
        ? {}
        : {
            onContextMenu: (e: ReactMouseEvent) => { e.preventDefault(); haptics.medium(); onOpenAreas(); },
            onPointerDown: beginPress,
            onPointerUp: cancelPress,
            onPointerCancel: cancelPress,
            onPointerLeave: cancelPress,
          })}
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
      {rail ? (
        <>
          <span aria-hidden className="m-tab-spacer" />
          {onToggleNav && (
            <button
              aria-label={t("titlebar.toggleLeftSidebar")}
              aria-pressed={!navCollapsed}
              className="m-railtool"
              data-testid="rail-nav-toggle"
              onClick={() => { haptics.light(); onToggleNav(); }}
              data-tip={t("titlebar.toggleLeftSidebar")}
              type="button"
            >
              {navCollapsed ? <PanelLeftOpen size={ICON.head} /> : <PanelLeftClose size={ICON.head} />}
            </button>
          )}
          <button
            className="m-tab"
            data-testid="rail-settings"
            onClick={() => { haptics.light(); onOpenSettings(); }}
            type="button"
          >
            <span className="m-tab-pill">
              <Settings size={ICON.head} />
            </span>
            <span className="m-tab-label">{t("mobile.sectionSettings")}</span>
          </button>
        </>
      ) : (
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
      )}
    </nav>
  );
}
