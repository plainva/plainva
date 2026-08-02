import { type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";

export interface ChipProps {
  children: ReactNode;
  /**
   * Selectable ("filter") chip. Renders a button and announces the state via
   * aria-pressed. Mobile had two toggle chips whose only signal was colour —
   * a screen reader could not tell a chosen filter from an unchosen one.
   */
  selected?: boolean;
  onClick?: () => void;
  /** Shows the removal cross; the label stays a plain span (see ChipField). */
  onRemove?: () => void;
  removeLabel?: string;
  /** Compact variant for dense rows (card meta, cell values). */
  size?: "sm" | "md";
  /** Draws attention to the chip's own colour rather than the shared surface. */
  tone?: "default" | "muted";
  title?: string;
  testId?: string;
  className?: string;
  /** Only for colour that IS data (a palette entry, an event's own colour). */
  style?: CSSProperties;
}

/**
 * Chip (design sweep 2026-08-02): THE one chip. It covers the three roles the
 * app actually has — a label that only displays, a filter you can switch on,
 * and a value you can remove — instead of the five mobile classes and the
 * hand-written markup inside ChipField.
 *
 * A chip with `onClick` is a button; without it a span. That distinction is
 * not cosmetic: a static label that is focusable is noise for keyboard and
 * screen-reader users, and a filter that is NOT focusable is unreachable.
 */
export function Chip({
  children,
  selected,
  onClick,
  onRemove,
  removeLabel,
  size = "md",
  tone = "default",
  title,
  testId,
  className,
  style,
}: ChipProps) {
  const cls = cx(
    "pv-chip",
    size === "sm" && "pv-chip--sm",
    tone === "muted" && "pv-chip--muted",
    onRemove && "pv-chip--removable",
    selected && "is-on",
    className
  );
  const label = <span className="pv-chip-text">{children}</span>;
  const remove = onRemove ? (
    <button
      type="button"
      className="pv-chip-x"
      aria-label={removeLabel}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      <X size={12} />
    </button>
  ) : null;

  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        style={style}
        aria-pressed={selected}
        title={title}
        data-testid={testId}
        onClick={onClick}
      >
        {label}
        {remove}
      </button>
    );
  }
  return (
    <span className={cls} style={style} title={title} data-testid={testId}>
      {label}
      {remove}
    </span>
  );
}
