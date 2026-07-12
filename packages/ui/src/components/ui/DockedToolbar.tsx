import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export interface DockedToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/**
 * Docked toolbar (Plainva UI 2.0 / M3 Expressive): a bottom-anchored action
 * strip that sits above the keyboard (mobile editor) or docks to an edge
 * (desktop selection tools). Owns the canonical surface/scroll behaviour via
 * the shared .pv-docked-toolbar classes so themes can restyle it; hosts
 * regular buttons/IconButtons as children. Overflowing content scrolls
 * horizontally instead of wrapping — the bar keeps one calm row.
 */
export const DockedToolbar = forwardRef<HTMLDivElement, DockedToolbarProps>(
  function DockedToolbar({ children, className, ...rest }, ref) {
    return (
      <div ref={ref} role="toolbar" className={cx("pv-docked-toolbar", className)} {...rest}>
        {children}
      </div>
    );
  }
);
