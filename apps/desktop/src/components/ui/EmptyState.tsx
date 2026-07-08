import type { ReactNode } from "react";
import { cx } from "./cx";

export interface EmptyStateProps {
  /** Optional lucide icon element. */
  icon?: ReactNode;
  children: ReactNode;
  /** Optional action (usually a <Button>). */
  action?: ReactNode;
  className?: string;
}

/**
 * Shared "nothing to show" pattern (plan Designsprache P2): one color token,
 * one padding, optional icon + action. Used by tree/search/backlinks and all
 * .base views (which previously had none).
 */
export function EmptyState({ icon, children, action, className }: EmptyStateProps) {
  return (
    <div role="status" className={cx("pv-empty", className)}>
      {icon}
      <div className="pv-empty-msg">{children}</div>
      {action}
    </div>
  );
}
