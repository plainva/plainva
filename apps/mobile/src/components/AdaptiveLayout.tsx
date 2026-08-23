import type { ReactNode } from "react";
import { renderRoute, TAB_ROUTES, type RouteContext } from "../routes";
import { SplitPlaceholder } from "./SplitPlaceholder";
import type { NavEntry, TabScreenId } from "../navigation";

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
}: {
  activeTab: TabScreenId;
  ctx: RouteContext;
  top: NavEntry | undefined;
  twoColumn: boolean;
}): ReactNode {
  return (
    <div className={`m-screen${twoColumn ? " m-screen--split" : ""}`}>
      {twoColumn && <div className="m-col m-col--nav">{TAB_ROUTES.notes(ctx)}</div>}
      <div className={twoColumn ? "m-col m-col--work" : "m-col"}>
        {twoColumn && !top && activeTab === "notes" ? (
          <SplitPlaceholder onCreateNote={ctx.captureNote} />
        ) : (
          renderRoute(top, activeTab, ctx)
        )}
      </div>
    </div>
  );
}
