import { useCallback, useEffect, useRef, useState } from "react";
import { askBeforeLeaving } from "../services/leaveQuestion";
import { BACK_HISTORY_EVENT } from "../services/backHistory";
import { useEdgeSwipeBack } from "../lib/useEdgeSwipeBack";
import { backStep, backStops, type BackStop, type NavState } from "../navigation";
import type { RouteContext } from "../routes";
import { BackHistorySheet } from "./BackHistorySheet";

/**
 * The two ways back the app bar's arrow does not cover (wishes 2026-10-25,
 * W5 and F6): the swipe from the left edge on iOS, and holding the arrow for
 * the places behind the screen. The swipe takes the arrow's own step
 * (`ctx.pop`, which asks about unsaved input first); a jump asks the same
 * question and then drops everything above the chosen place. One way back,
 * three triggers.
 */
export function BackNavigation({ nav, ctx }: { nav: NavState; ctx: RouteContext }) {
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  }, [nav]);

  const { pop, setNav } = ctx;
  const workColumn = useCallback(() => document.querySelector<HTMLElement>(".m-screen > .m-col:last-child"), []);
  useEdgeSwipeBack({ enabled: !backStep(nav).minimize, target: workColumn, onBack: pop });

  const [stops, setStops] = useState<BackStop[] | null>(null);
  useEffect(() => {
    const open = () => {
      const found = backStops(navRef.current);
      if (found.length > 0) setStops(found);
    };
    window.addEventListener(BACK_HISTORY_EVENT, open);
    return () => window.removeEventListener(BACK_HISTORY_EVENT, open);
  }, []);

  if (!stops) return null;
  return (
    <BackHistorySheet
      activeTab={nav.activeTab}
      stops={stops}
      onClose={() => setStops(null)}
      onPick={(stop) => {
        setStops(null);
        void askBeforeLeaving().then((ok) => {
          if (ok) setNav(() => stop.next);
        });
      }}
    />
  );
}
