import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — also shown as tooltip (data-tip) unless tip=false. */
  label: string;
  size?: "sm" | "md";
  /** Set false to suppress the hover tooltip (label stays as aria-label). */
  tip?: boolean;
  /**
   * Toggle state. Renders the shared active look (the accent-container pair)
   * AND announces it via aria-pressed — a coloured icon alone tells a screen
   * reader nothing, which is what every hand-rolled "active" class got wrong.
   * Leave undefined for a plain button: nothing is announced, nothing changes.
   */
  active?: boolean;
  children: ReactNode;
}

/**
 * Square icon-only button (plan Designsprache P2). The label prop is
 * mandatory: it is the accessible name AND (via data-tip) the themed tooltip
 * rendered by TooltipHost — never use a bare title= attribute.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", tip = true, active, className, children, type, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      data-tip={tip ? label : undefined}
      aria-pressed={active}
      className={cx("pv-iconbtn", size === "sm" && "pv-iconbtn--sm", active && "is-active", className)}
      {...rest}
    >
      {children}
    </button>
  );
});
