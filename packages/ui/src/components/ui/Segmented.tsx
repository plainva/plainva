import { type ReactNode } from "react";
import { cx } from "./cx";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional leading icon (lucide element). */
  icon?: ReactNode;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Segmented control (Plainva UI 2.0 / M3 Expressive): a small set of mutually
 * exclusive options in one pill track (e.g. the .base view switch). Single
 * select → radiogroup semantics. The active segment fills with the accent
 * container; token-driven so every theme restyles it (LCARS pill, Win95 bevel).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx("pv-segmented", size === "sm" && "pv-segmented--sm", className)}
    >
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={cx("pv-seg-item", on && "is-active")}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon ? <span className="pv-seg-ic">{opt.icon}</span> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
