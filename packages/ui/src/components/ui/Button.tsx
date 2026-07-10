import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual role — primary (accent CTA), secondary (bordered, default),
   * ghost (borderless), danger (destructive confirm). */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional leading icon (lucide element). */
  icon?: ReactNode;
}

/**
 * Standard button (plan Designsprache P2). Renders the shared .pv-btn classes
 * so every theme (LCARS pills, Phosphor glow) can restyle it — never rebuild
 * this with inline styles. Sizes map to --control-sm/md/lg.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, type, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cx("pv-btn", `pv-btn--${variant}`, size !== "md" && `pv-btn--${size}`, className)}
      {...rest}
    >
      {icon ? <span className="pv-btn-ic">{icon}</span> : null}
      {children}
    </button>
  );
});
