import { cx } from "./cx";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name (the visible label usually sits next to the switch). */
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Toggle switch (plan Designsprache P2) — componentizes the existing
 * .pv-switch classes (App.css) with proper switch semantics.
 */
export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx("pv-switch", checked && "pv-switch-on", className)}
      onClick={() => onChange(!checked)}
    >
      <span className="pv-switch-knob" />
    </button>
  );
}
