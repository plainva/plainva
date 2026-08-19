import type { ReactNode } from "react";
import { Button } from "./Button";

export interface SelectionBarProps {
  /** How many rows are selected. Rendered by the caller's `label` function. */
  count: number;
  /** "3 selected" — the caller owns the wording because it owns the language. */
  label: string;
  /** Buttons the selection enables. */
  children?: ReactNode;
  /** Label for the clear action (ghost, far right). */
  clearLabel: string;
  onClear: () => void;
  testId?: string;
  /** The clear button carries its own id: tests reach for the action, not the strip. */
  clearTestId?: string;
}

/**
 * The strip a multi-selection puts IN PLACE OF the surface's toolbar.
 *
 * Replacing rather than stacking is the point: while a selection exists, that
 * is what the surface is about, and a second row would push the very rows a
 * person is reading down by its own height.
 *
 * Shared so that the mail list, the database views and whatever comes next say
 * "3 selected" in one voice — before this there were three hand-built versions
 * (file tree, mail, mobile), one of them an inline style.
 */
export function SelectionBar({ count, label, children, clearLabel, onClear, testId, clearTestId }: SelectionBarProps) {
  if (count === 0) return null;
  return (
    <div className="pv-selbar" role="toolbar" aria-label={label} data-testid={testId}>
      <span className="pv-selbar-count">{label}</span>
      {children}
      <span className="pv-selbar-spacer" />
      <Button variant="ghost" onClick={onClear} data-testid={clearTestId}>{clearLabel}</Button>
    </div>
  );
}
