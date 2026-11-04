import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { ICON } from "../../lib/iconSizes";
import { cx } from "./cx";
import { DeviceOnlyBadge } from "./DeviceOnlyBadge";
import { InfoLabel, InfoTip, type InfoContent } from "./InfoTip";

/** The name an info button takes from a label that may be markup. */
function nameOf(label: ReactNode, infoLabel: string | undefined): string {
  return infoLabel ?? (typeof label === "string" || typeof label === "number" ? String(label) : "");
}

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
  onOpen,
  openTestId,
  info,
  infoLabel,
  deviceOnly,
}: {
  children: ReactNode;
  /** A count, or exactly one action. Never a second heading. */
  end?: ReactNode;
  className?: string;
  /**
   * The heading LEADS to the whole list it heads (plan Rückmeldungen
   * 2026-10-24, E8): the heading text becomes a button with a chevron. For a
   * section that shows a few entries of a longer list — the home screen's
   * Recent and Bookmarks bands — where the way to the rest is the heading
   * itself, not a second control beside it.
   */
  onOpen?: () => void;
  openTestId?: string;
  /**
   * What stands behind the info button at the end of the heading (settings
   * plan 2026-10-29, § 3) — a group's introduction.
   */
  info?: InfoContent;
  /** The button's name when the heading is markup rather than text. */
  infoLabel?: string;
  /** The whole group stays on this device (E3). */
  deviceOnly?: boolean;
}) {
  return (
    <p className={cx("pv-grouplabel", className)}>
      {onOpen ? (
        <button className="pv-grouplabel-link" data-testid={openTestId} onClick={onOpen} type="button">
          {children}
          <ChevronRight aria-hidden="true" size={ICON.meta} />
        </button>
      ) : (
        <InfoLabel name={nameOf(children, infoLabel)} info={info} testId="grouplabel-info">{children}</InfoLabel>
      )}
      {/* A heading that leads somewhere is a button; the info button stands beside it, never inside. */}
      {onOpen && info !== undefined && <InfoTip label={nameOf(children, infoLabel)} info={info} testId="grouplabel-info" />}
      {deviceOnly && <DeviceOnlyBadge />}
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

/**
 * A setting the user TYPES, rendered as a row of the same card (settings page
 * grammar, 2026-08-15).
 *
 * `Row`'s trailing slot is built to be CUT — it is the value beside a label,
 * and a value that does not fit is the part that gives way. A vault path is the
 * opposite: it is longer than its label and must stay readable and editable. So
 * the label keeps line one and the control gets line two at full width, with an
 * optional action beside it.
 *
 * This exists so that a settings field stops being a free-standing block on the
 * page: that block sat on its own left edge, which is how one surface came to
 * have three of them.
 */
export function SettingField({
  label,
  hint,
  action,
  children,
  isStatic,
  className,
  info,
  infoLabel,
  deviceOnly,
}: {
  label: ReactNode;
  /**
   * What the field means, on the ROW edge because it sits inside the card.
   *
   * Between label and control, which is where the desktop has always put it
   * (`SettingRow`'s `desc` on a wide row): you read what the field is for
   * before you type into it. A hint that describes the whole CARD stays a
   * `.m-hint` below the card, on the page edge.
   */
  hint?: ReactNode;
  /** One trailing action beside the control — the folder browser, typically. */
  action?: ReactNode;
  /** The control itself (an input, a Select). */
  children: ReactNode;
  /**
   * The row stacks two ACTIONS instead of labelling one control (a rule's
   * folder above its template). A `<label>` with no form control in it labels
   * nothing, so that case renders a plain container.
   */
  isStatic?: boolean;
  className?: string;
  /** What stands behind the info button at the end of the label (settings plan 2026-10-29, § 3). */
  info?: InfoContent;
  /** The button's name when the label is markup rather than text. */
  infoLabel?: string;
  /** The setting stays on this device: the badge on the line under the label (E3). */
  deviceOnly?: boolean;
}) {
  const controlId = useId();
  const badge = deviceOnly && <span className="pv-rowfield-hint"><DeviceOnlyBadge /></span>;
  const hintLine = hint !== undefined && hint !== null && hint !== "" && <span className="pv-rowfield-hint">{hint}</span>;
  if (info === undefined) {
    const Tag = isStatic ? "div" : "label";
    return (
      <Tag className={cx("pv-rowfield", className)}>
        <span className="pv-rowfield-label">{label}</span>
        {badge}
        {hintLine}
        <span className="pv-rowfield-control">
          {children}
          {action}
        </span>
      </Tag>
    );
  }
  // With an info button the field cannot be one <label>: a button inside it
  // would join the control's name ("Folder More about Folder"), and before the
  // control it would even become the label's control. So the label names its
  // control by id and the button stands beside it.
  const own = isValidElement<{ id?: string }>(children) ? children.props.id : undefined;
  const control = !isStatic && isValidElement<{ id?: string }>(children) && own === undefined
    ? cloneElement(children as ReactElement<{ id?: string }>, { id: controlId })
    : children;
  const target = isStatic || !isValidElement(children) ? undefined : own ?? controlId;
  return (
    <div className={cx("pv-rowfield", className)}>
      <span className="pv-rowfield-head">
        {/* The <label> names its control, so the button cannot join its last
            word (InfoLabel); the line is a flex row instead, where the button
            stands beside the label's box and never on a line of its own. */}
        {target ? <label className="pv-rowfield-label" htmlFor={target}>{label}</label> : <span className="pv-rowfield-label">{label}</span>}
        <InfoTip label={nameOf(label, infoLabel)} info={info} testId="rowfield-info" />
      </span>
      {badge}
      {hintLine}
      <span className="pv-rowfield-control">
        {control}
        {action}
      </span>
    </div>
  );
}

export function Row({
  icon,
  title,
  subtitle,
  end,
  indent,
  wrap,
  controls,
  current,
  onClick,
  disabled,
  className,
  info,
  infoLabel,
  deviceOnly,
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
  /**
   * The title is CONTENT, not a label (N9.4).
   *
   * A settings row is one height because its title is a name — cutting
   * "Default calen…" loses nothing, the value beside it carries the meaning.
   * A task, a search hit, a mail subject is the opposite: the title IS the
   * information, and the ellipsis cuts it. So the title runs to two lines and
   * the subtitle becomes a wrapping meta line for chips. Everything else stays
   * the row it was.
   */
  wrap?: boolean;
  /**
   * The row carries its OWN controls — a checkbox, chips that act, a trailing
   * button — and still leads somewhere when you tap beside them (N9.4).
   *
   * It cannot be a native `<button>` then: nested buttons are invalid HTML and
   * the inner ones simply stop working. That is not theory — it is exactly how
   * the month grid's day cell came to have nothing clickable inside it
   * (issue #34). So such a row is a container with `role="button"`; a click
   * that started on a control of its own is left alone, and the keyboard only
   * answers events on the container itself.
   */
  controls?: boolean;
  /**
   * The row is WHERE THE USER IS in a list of targets (finding 2026-09-24,
   * E20): the area on screen, the database view shown, the active vault.
   *
   * A target is not a value one sets, so it wears no ring and no slot — those
   * belong to a choice. The current row is tinted with the accent-container
   * pair, set in weight 600, carries a check on its trailing edge and
   * `aria-current`; every other row of the list carries nothing. It was a ring
   * list before, which read as a setting with four empty answers.
   */
  current?: boolean;
  onClick?: () => void;
  /** Only meaningful on a row that acts: a row that merely shows something
   * cannot be unavailable. Ignored on the static variant rather than faked
   * with `aria-disabled`, which would announce a control that is not one. */
  disabled?: boolean;
  className?: string;
  /**
   * What stands behind the info button at the end of the title (settings plan
   * 2026-10-29, § 3). A row that leads somewhere then cannot be one native
   * button — a button may not hold another — and becomes the container form
   * of `controls`, named by its title alone.
   */
  info?: InfoContent;
  /** The button's name when the title is markup rather than text. */
  infoLabel?: string;
  /** The setting stays on this device: the badge on the second line (E3). */
  deviceOnly?: boolean;
} & Omit<React.HTMLAttributes<HTMLElement>, "onClick" | "title" | "className">) {
  const titleId = useId();
  const hasInfo = info !== undefined;
  const titleSpan = <span className="pv-grouprow-title" id={hasInfo ? titleId : undefined}><bdi>{title}</bdi></span>;
  const hasSub = subtitle !== undefined && subtitle !== null && subtitle !== "";
  const body = (
    <>
      {icon !== undefined && icon !== null && <span className="pv-grouprow-icon">{icon}</span>}
      <span className="pv-grouprow-text">
        {/* A name may be written right to left (issue 111). The interface is
            not mirrored, so the name keeps its place in the row; <bdi> only
            puts its own characters in the right order. */}
        {hasInfo ? (
          <span className="pv-grouprow-titleline">
            {titleSpan}
            <InfoTip label={nameOf(title, infoLabel)} info={info} testId="grouprow-info" />
          </span>
        ) : titleSpan}
        {(hasSub || deviceOnly) && (
          <span className="pv-grouprow-sub">
            {deviceOnly && <DeviceOnlyBadge />}
            {deviceOnly && hasSub && " "}
            {hasSub && subtitle}
          </span>
        )}
      </span>
      {current && (
        <span className="pv-grouprow-check">
          <Check size={ICON.ui} />
        </span>
      )}
      {end !== undefined && end !== null && end !== "" && <span className="pv-grouprow-end">{end}</span>}
    </>
  );
  const cls = cx(
    "pv-grouprow",
    indent === 1 && "pv-grouprow--indent",
    indent === 2 && "pv-grouprow--indent2",
    wrap && "pv-grouprow--wrap",
    current && "pv-grouprow--current",
    onClick && "pv-rowhover",
    className,
  );
  // "page" is the target list's meaning — the place shown now. A caller with a
  // narrower one (a step, a date) passes its own `aria-current` through `rest`.
  const withCurrent = current && rest["aria-current"] === undefined ? { ...rest, "aria-current": "page" as const } : rest;
  // A row with an info button is named by its title, not by its title and the button's name.
  const attrs = hasInfo && onClick && withCurrent["aria-labelledby"] === undefined && withCurrent["aria-label"] === undefined
    ? { ...withCurrent, "aria-labelledby": titleId }
    : withCurrent;
  // A row that does something is a button; one that only shows something is
  // not. Handing every row a button element would put a control in the
  // accessibility tree for text that cannot be acted on.
  if (onClick && (controls || hasInfo)) {
    return (
      <div
        className={cls}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={(e) => {
          // A tap that started on one of the row's own controls belongs to it.
          if ((e.target as HTMLElement).closest("button,a,input,select,textarea,label")) return;
          if (!disabled) onClick();
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          if (!disabled) onClick();
        }}
        {...attrs}
      >
        {body}
      </div>
    );
  }
  return onClick ? (
    <button className={cls} disabled={disabled} onClick={onClick} type="button" {...attrs}>
      {body}
    </button>
  ) : (
    <div className={cls} {...attrs}>
      {body}
    </div>
  );
}
