import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * The container grammar (mobile rework N2) — shared, and additive.
 *
 * The pattern the target design uses 42 times: a run of related rows in ONE
 * bordered card, under a section heading, with hairlines between the rows and
 * none after the last. It did not exist. The phone had no divider rules at all
 * and only 4 of 209 rows inside a card, which is why nine full-width buttons
 * stacked on top of each other could pass for a screen.
 *
 * These are deliberately thin: the metric lives in the `--pv-row-*` tokens, so
 * the touch density raises the row height for both shells in one place, and a
 * surface can never quietly grow a rhythm of its own. Nothing here restyles an
 * existing class, so the desktop is unchanged until a surface opts in.
 *
 * The rule that goes with them: an action that LEADS somewhere is a row; a
 * button remains only where something is TRIGGERED.
 */

export function SectionLabel({
  children,
  end,
  className,
}: {
  children: ReactNode;
  /** A count, or exactly one action. Never a second heading. */
  end?: ReactNode;
  className?: string;
}) {
  return (
    <p className={cx("pv-grouplabel", className)}>
      {children}
      {end !== undefined && end !== null && end !== "" && <span className="pv-grouplabel-end">{end}</span>}
    </p>
  );
}

export function GroupCard({
  children,
  tone,
  className,
}: {
  children: ReactNode;
  /**
   * Changes the FILL, never the metric — a warning row is the same row.
   * `danger` is the exception that outlines, because a destructive group is
   * the one place a card argues with the reader instead of informing them.
   */
  tone?: "tint" | "warn" | "danger";
  className?: string;
}) {
  return (
    <div
      className={cx(
        "pv-card pv-card--flush",
        tone === "tint" && "pv-card--tint",
        tone === "warn" && "pv-card--warn",
        tone === "danger" && "pv-card--danger",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The hairline list. Its children are Rows; it decides nothing else. */
export function RowList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("pv-grouprows", className)}>{children}</div>;
}

export function Row({
  icon,
  title,
  subtitle,
  end,
  indent,
  onClick,
  className,
  ...rest
}: {
  icon?: ReactNode;
  title: ReactNode;
  /** The second line. Truncates rather than wrapping — a row is one height. */
  subtitle?: ReactNode;
  /** Chevron, value or switch. */
  end?: ReactNode;
  /** Moves ONLY the left edge, so a hierarchy keeps the rhythm. */
  indent?: 1 | 2;
  onClick?: () => void;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "onClick" | "title" | "className">) {
  const body = (
    <>
      {icon !== undefined && icon !== null && <span className="pv-grouprow-icon">{icon}</span>}
      <span className="pv-grouprow-text">
        <span className="pv-grouprow-title">{title}</span>
        {subtitle !== undefined && subtitle !== null && subtitle !== "" && (
          <span className="pv-grouprow-sub">{subtitle}</span>
        )}
      </span>
      {end !== undefined && end !== null && end !== "" && <span className="pv-grouprow-end">{end}</span>}
    </>
  );
  const cls = cx(
    "pv-grouprow",
    indent === 1 && "pv-grouprow--indent",
    indent === 2 && "pv-grouprow--indent2",
    onClick && "pv-rowhover",
    className,
  );
  // A row that does something is a button; one that only shows something is
  // not. Handing every row a button element would put a control in the
  // accessibility tree for text that cannot be acted on.
  return onClick ? (
    <button className={cls} onClick={onClick} type="button" {...rest}>
      {body}
    </button>
  ) : (
    <div className={cls} {...rest}>
      {body}
    </div>
  );
}
