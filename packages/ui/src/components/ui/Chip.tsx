import { type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";

export interface ChipProps {
  children: ReactNode;
  /**
   * A leading icon. It gets its OWN slot next to the label, and that is the
   * point: passed as a child it became part of the label span's ellipsis
   * chain, and with no gap on `.pv-chip` it touched the first letter at a
   * measured 0px (mobile rework round 3).
   */
  icon?: ReactNode;
  /**
   * Selectable ("filter") chip. Renders a button and announces the state via
   * aria-pressed. Mobile had two toggle chips whose only signal was colour —
   * a screen reader could not tell a chosen filter from an unchosen one.
   */
  selected?: boolean;
  onClick?: () => void;
  /**
   * A hold gesture on a chip that acts. The app already uses hold to mean
   * "give me the other options" (promote-into-which-database, S31); a chip
   * that carries that action has to be able to carry it too, otherwise the
   * choice would have to be dropped or hidden behind a second control.
   */
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
  onPointerCancel?: () => void;
  /** Shows the removal cross; the label stays a plain span (see ChipField). */
  onRemove?: () => void;
  removeLabel?: string;
  /** Compact variant for dense rows (card meta, cell values). */
  size?: "sm" | "md";
  /**
   * `muted` draws attention to the chip's own colour rather than the shared
   * surface. `warning` is for state that is time-critical — a due date, an
   * expiry — and paints on the shared `--warning-*` tokens, so it is the same
   * amber the desktop's task view has always used and every theme overrides.
   */
  tone?: "default" | "muted" | "warning";
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
  icon,
  selected,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
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
    tone === "warning" && "pv-chip--warning",
    onRemove && "pv-chip--removable",
    selected && "is-on",
    className
  );
  const glyph = icon ? <span className="pv-chip-icon">{icon}</span> : null;
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
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onPointerCancel={onPointerCancel}
      >
        {glyph}
        {label}
        {remove}
      </button>
    );
  }
  return (
    <span className={cls} style={style} title={title} data-testid={testId}>
      {glyph}
      {label}
      {remove}
    </span>
  );
}
