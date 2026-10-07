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
  /** The event is handed on for a chip that anchors a popover (a task's due date). */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
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
   * `proposed` is a value somebody proposes and nobody accepted yet (a cell
   * of a database, plan KI-Harness P5-4): tinted like an insertion, on the
   * `--success-*` tokens, because accepting it inserts it. `removal` is its
   * counterpart — the value a proposal would take away, struck through on the
   * `--error-*` tokens like a deletion.
   */
  tone?: "default" | "muted" | "warning" | "proposed" | "removal";
  /**
   * What the chip is, where its text alone does not say it: the tooltip and
   * the accessible name ("Suggested value for stage: sent").
   */
  tip?: string;
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
  disabled = false,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  onRemove,
  removeLabel,
  size = "md",
  tone = "default",
  tip,
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
    tone === "proposed" && "pv-chip--proposed",
    tone === "removal" && "pv-chip--removal",
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

  if (onClick && onRemove) return (
    <span className={cls} style={style} title={title} data-testid={testId}>
      <button type="button" className="pv-chip-open" aria-disabled={disabled} aria-pressed={selected}
        onClick={(e) => { if (!disabled) onClick(e); }} onPointerDown={onPointerDown} onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave} onPointerCancel={onPointerCancel}>{glyph}{label}</button>
      {remove}
    </span>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        style={style}
        aria-pressed={selected}
        aria-label={tip}
        data-tip={tip}
        title={title}
        data-testid={testId}
        aria-disabled={disabled}
        onClick={(e) => { if (!disabled) onClick(e); }}
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
    // A chip that only displays is no control, so it takes no accessible name of its own: `tip` is its tooltip.
    <span className={cls} style={style} data-tip={tip} title={title} data-testid={testId}>
      {glyph}
      {label}
      {remove}
    </span>
  );
}
