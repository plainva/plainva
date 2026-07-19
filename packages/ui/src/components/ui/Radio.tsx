import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Visible label text (the row is the click target). */
  label: ReactNode;
}

/**
 * Radio row (design sweep 2026-07-19): the native input styled via
 * accent-color inside the shared check-row — replaces the previously bare
 * <input type="radio"> uses (OKF conversion, missing-requirement dialog).
 * Group radios via the native `name` attribute.
 */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, className, ...rest },
  ref
) {
  return (
    <label className={cx("pv-checkrow", className)}>
      <input ref={ref} type="radio" className="pv-check" {...rest} />
      <span>{label}</span>
    </label>
  );
});
