import { Select as PvSelect, type SelectOption as PvSelectOption } from "@plainva/ui";
import type { ReactNode } from "react";

/**
 * Thin adapter over the shared Select primitive (design sweep 2026-07-19).
 * The previous bespoke implementation lived here (fixed z-index 4000, its own
 * shadow recipe, card-radius panel); all 13 call sites keep this import path
 * and API while the primitive supplies the canonical look — field-metric
 * trigger, popover-contract panel, accent-container selection, search row at
 * >= 8 options, theme-reachable classes.
 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Optional colour swatch (e.g. theme preview). */
  swatch?: string;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Optional muted hint shown after the label. */
  hint?: string;
  /** Optional group header rendered above the first option of each group. */
  group?: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  minWidth?: number | string;
  /** Horizontal alignment of the popover relative to the trigger. */
  align?: "left" | "right";
  /** Open the list on mount (inline editors that enter edit mode ready to pick). */
  autoOpen?: boolean;
  /** Fired when the list is dismissed WITHOUT a selection (outside click / Escape / scroll). */
  onClose?: () => void;
  /** Compact sizing for inline use (e.g. a `.base` table cell). */
  size?: "sm" | "md";
  "data-testid"?: string;
}

export function Select({ size, ...rest }: SelectProps) {
  return <PvSelect {...rest} options={rest.options as PvSelectOption[]} compact={size === "sm"} />;
}
