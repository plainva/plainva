import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — also shown as tooltip (data-tip) unless tip=false. */
  label: string;
  size?: "sm" | "md";
  /** Set false to suppress the hover tooltip (label stays as aria-label). */
  tip?: boolean;
  children: ReactNode;
}

/**
 * Square icon-only button (plan Designsprache P2). The label prop is
 * mandatory: it is the accessible name AND (via data-tip) the themed tooltip
 * rendered by TooltipHost — never use a bare title= attribute.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", tip = true, className, children, type, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      data-tip={tip ? label : undefined}
      className={cx("pv-iconbtn", size === "sm" && "pv-iconbtn--sm", className)}
      {...rest}
    >
      {children}
    </button>
  );
});
