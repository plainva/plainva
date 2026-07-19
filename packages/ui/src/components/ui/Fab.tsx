import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export interface FabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Leading icon (lucide element). */
  icon: ReactNode;
  /** Optional label — renders the extended pill FAB instead of a round one. */
  label?: ReactNode;
}

/**
 * Floating action button (Plainva UI 2.0 / M3 Expressive): the primary create
 * affordance. Round by default (--radius-lg rounded square); pass `label` for
 * the extended pill form. Renders the shared .pv-fab classes so themes restyle
 * it (LCARS pill, Win95 bevel) — never rebuild with inline styles.
 */
export const Fab = forwardRef<HTMLButtonElement, FabProps>(function Fab(
  { icon, label, className, type, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cx("pv-fab", label != null && "pv-fab--extended", className)}
      {...rest}
    >
      <span className="pv-fab-ic">{icon}</span>
      {label != null ? <span className="pv-fab-label">{label}</span> : null}
    </button>
  );
});
