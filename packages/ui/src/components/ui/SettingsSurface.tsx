import type { ReactNode } from "react";
import { cx } from "./cx";
import { DeviceOnlyBadge } from "./DeviceOnlyBadge";
import { InfoTip, type InfoContent } from "./InfoTip";

/**
 * Settings surface primitives (settings redesign 2026-07-18, P1 — variant
 * "quiet cards"). Settings live in named group CARDS (tinted surface, hairline
 * border, radius) instead of loose rows on the page background; rows inside a
 * card are separated by hairlines. Styling comes from the shared .pv-set*
 * classes in styles/ui.css, so every theme restyles the surface via tokens.
 *
 * Head, card and row take an `info` (settings plan 2026-10-29, § 3): the
 * explanation behind an info button at the END of the title, label or heading.
 * Visible stays only what someone needs to decide — a step, a warning, a state.
 * Card and row take `deviceOnly` for the "On this device only" badge (E3).
 */

export interface SettingsPageHeadProps {
  /** Area title — the page's h3 (the E2E contract addresses it by role). */
  title: string;
  /** One-line description of the area. */
  desc?: string;
  /** What stands behind the info button after the title. */
  info?: InfoContent;
  /** Optional trailing content (e.g. the active-vault badge). */
  children?: ReactNode;
}

/** Page header: title + one-line description, shown once per settings page. */
export function SettingsPageHead({ title, desc, info, children }: SettingsPageHeadProps) {
  return (
    <div className="pv-setpage-head">
      <div className="pv-setpage-headrow">
        {/* The button stands beside the heading, not in it: the heading's name stays the title. */}
        <div className="pv-setpage-titleline">
          <h3 className="pv-setpage-title">{title}</h3>
          {info !== undefined && <InfoTip label={title} info={info} testId="setpage-info" />}
        </div>
        {children}
      </div>
      {desc && <p className="pv-setpage-desc">{desc}</p>}
    </div>
  );
}

export interface SettingCardProps {
  /** Group label rendered ABOVE the card (uppercase mini label). */
  label?: string;
  /** What stands behind the info button after the label — a card's introduction. */
  info?: InfoContent;
  /** The whole card stays on this device (E3). */
  deviceOnly?: boolean;
  className?: string;
  /** Test id on the card's section. */
  testId?: string;
  children: ReactNode;
}

/** Named group card — the framed container settings rows live in. */
export function SettingCard({ label, info, deviceOnly, className, testId, children }: SettingCardProps) {
  return (
    <section className={cx("pv-setgroup", className)} data-testid={testId}>
      {label && (
        <div className="pv-setgroup-label">
          {label}
          {info !== undefined && <InfoTip label={label} info={info} testId={testId ? `${testId}-info` : "setgroup-info"} />}
          {deviceOnly && <> <DeviceOnlyBadge /></>}
        </div>
      )}
      <div className="pv-setcard" role="group" aria-label={label}>
        {children}
      </div>
    </section>
  );
}

export interface SettingRowProps {
  label: string;
  desc?: string;
  /** What stands behind the info button at the end of the label. */
  info?: InfoContent;
  /** The setting stays on this device: the badge on the line under the label (E3). */
  deviceOnly?: boolean;
  /**
   * Wide rows stack the control on its own full-width line under the label —
   * for broad controls (theme preview cards, provider forms, path pickers).
   */
  wide?: boolean;
  children?: ReactNode;
}

/** One setting: label (+ optional description) left, control right. */
export function SettingRow({ label, desc, info, deviceOnly, wide, children }: SettingRowProps) {
  return (
    <div className={cx("pv-setrow", wide && "pv-setrow--wide")}>
      <div className="pv-setrow-main">
        <div className="pv-setrow-label">
          {label}
          {info !== undefined && <InfoTip label={label} info={info} testId="setrow-info" />}
        </div>
        {deviceOnly && <div className="pv-setrow-desc"><DeviceOnlyBadge /></div>}
        {desc && <div className="pv-setrow-desc">{desc}</div>}
      </div>
      {children != null && <div className="pv-setrow-ctrl">{children}</div>}
    </div>
  );
}

export interface SettingCardNoteProps {
  className?: string;
  children: ReactNode;
}

/**
 * Free-form block inside a card (hint texts, result tables, status lines).
 * Carries the row padding + hairline contract without the label/control split.
 */
export function SettingCardNote({ className, children }: SettingCardNoteProps) {
  return <div className={cx("pv-setrow", "pv-setrow--note", className)}>{children}</div>;
}

/**
 * A free block inside a card in body text (a radio group, a list, a few
 * measured lines). `.pv-setcard` has no padding of its own, so anything placed
 * in a card bare sits on its edge — this brings the row inset and hairline.
 */
export function SettingCardBlock({ className, children }: SettingCardNoteProps) {
  return <div className={cx("pv-setrow", "pv-setrow--block", className)}>{children}</div>;
}

/** The button row of a card (Cancel, Save): right-aligned, with the row inset. */
export function SettingCardActions({ className, children }: SettingCardNoteProps) {
  return <div className={cx("pv-setrow", "pv-setrow--actions", className)}>{children}</div>;
}
