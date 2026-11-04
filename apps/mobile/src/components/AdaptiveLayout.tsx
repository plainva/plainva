import { useState, type ReactNode } from "react";
import { renderRoute, TAB_ROUTES, type RouteContext } from "../routes";
import { SplitPlaceholder } from "./SplitPlaceholder";
import { besideContext } from "../services/besideNav";
import type { NavEntry, NavState, TabScreenId } from "../navigation";
import { BackNavigation } from "./BackNavigation";
import { navMotion, type NavMotion } from "../lib/navMotion";

/**
 * How the shell arranges its surfaces for the window it is in (S13).
 *
 * No header here since S11: every surface carries its own app bar, so a
 * navigation step no longer swaps one header family for another.
 *
 * From the expanded window class the navigator stands beside the working
 * surface (M3 list-detail). It is the same component the notes tab renders — a
 * wide window does not get a second navigator, it gets the one it already had,
 * next to instead of in front of the work. Since 2026-08-23 it can also be
 * folded away, and then this renders exactly what a medium window renders:
 * one surface, using the whole width.
 */
export function AdaptiveLayout({
  activeTab,
  ctx,
  top,
  twoColumn,
  nav,
}: {
  activeTab: TabScreenId;
  ctx: RouteContext;
  top: NavEntry | undefined;
  twoColumn: boolean;
  /** The whole navigation: how deep it stands gives a step its direction, and the ways back read it. */
  nav: NavState;
}): ReactNode {
  const depth = nav.overlay.length + nav.stacks[nav.activeTab].length;
  // Opening and going back slide the working column (F5, S6): in from the
  // right on a push, from the left on a pop. Two copies of each keyframe so a
  // second step in the same direction restarts the animation. Durations come
  // from the motion tokens, so "Animations off" and the system's reduced
  // motion turn it off.
  const key = top ? `${top.kind}:${top.path}` : `root:${activeTab}`;
  const [step, setStep] = useState({ key, depth, motion: "none" as NavMotion, seq: 0 });
  if (step.key !== key) setStep({ key, depth, motion: navMotion(step.depth, depth), seq: step.seq + 1 });
  const motionClass = step.motion === "none" ? "" : ` is-nav-${step.motion}-${step.seq % 2}`;
  return (
    <div className={`m-screen${twoColumn ? " m-screen--split" : ""}`}>
      {/* Beside the work, not on top of it: what the navigator opens takes the
          surface in the work column off the screen, so it asks first. */}
      {twoColumn && <div className="m-col m-col--nav">{TAB_ROUTES.notes(besideContext(ctx))}</div>}
      <div className={`${twoColumn ? "m-col m-col--work" : "m-col"}${motionClass}`}>
        {twoColumn && !top && activeTab === "notes" ? (
          <SplitPlaceholder onCreateNote={ctx.captureNote} />
        ) : (
          renderRoute(top, activeTab, ctx)
        )}
      </div>
      <BackNavigation ctx={ctx} nav={nav} />
    </div>
  );
}
