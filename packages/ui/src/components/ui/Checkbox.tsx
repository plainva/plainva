import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Optional inline label rendered next to the box. */
  children?: ReactNode;
}

/**
 * Styled native checkbox (plan Designsprache P2): 16px, accent-color from the
 * theme, optional label. Keeps the native element for a11y/forms.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { children, className, ...rest },
  ref
) {
  const box = <input ref={ref} type="checkbox" className="pv-check" {...rest} />;
  if (!children) return box;
  return (
    <label className={cx("pv-checkrow", className)}>
      {box}
      <span>{children}</span>
    </label>
  );
});
