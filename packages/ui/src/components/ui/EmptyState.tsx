import type { ReactNode } from "react";
import { cx } from "./cx";

export interface EmptyStateProps {
  /** Optional lucide icon element. */
  icon?: ReactNode;
  /** Optional emphasis title (UI 2.0) — rendered above the message in the
   * headline type role. */
  title?: ReactNode;
  children: ReactNode;
  /** Optional action (usually a <Button>). */
  action?: ReactNode;
  className?: string;
}

/**
 * Shared "nothing to show" pattern (plan Designsprache P2): one color token,
 * one padding, optional icon + action. Used by tree/search/backlinks and all
 * .base views (which previously had none). UI 2.0 adds an optional emphasis
 * title in the headline type role.
 */
export function EmptyState({ icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div role="status" className={cx("pv-empty", className)}>
      {icon}
      {title != null ? <div className="pv-empty-title">{title}</div> : null}
      <div className="pv-empty-msg">{children}</div>
      {action}
    </div>
  );
}
