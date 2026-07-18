import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Settings surface primitives (settings redesign 2026-07-18, P1 — variant
 * "quiet cards"). Settings live in named group CARDS (tinted surface, hairline
 * border, radius) instead of loose rows on the page background; rows inside a
 * card are separated by hairlines. Styling comes from the shared .pv-set*
 * classes in styles/ui.css, so every theme restyles the surface via tokens.
 */

export interface SettingsPageHeadProps {
  /** Area title — the page's h3 (the E2E contract addresses it by role). */
  title: string;
  /** One-line description of the area. */
  desc?: string;
  /** Optional trailing content (e.g. the active-vault badge). */
  children?: ReactNode;
}

/** Page header: title + one-line description, shown once per settings page. */
export function SettingsPageHead({ title, desc, children }: SettingsPageHeadProps) {
  return (
    <div className="pv-setpage-head">
      <div className="pv-setpage-headrow">
        <h3 className="pv-setpage-title">{title}</h3>
        {children}
      </div>
      {desc && <p className="pv-setpage-desc">{desc}</p>}
    </div>
  );
}

export interface SettingCardProps {
  /** Group label rendered ABOVE the card (uppercase mini label). */
  label?: string;
  className?: string;
  children: ReactNode;
}

/** Named group card — the framed container settings rows live in. */
export function SettingCard({ label, className, children }: SettingCardProps) {
  return (
    <section className={cx("pv-setgroup", className)}>
      {label && <div className="pv-setgroup-label">{label}</div>}
      <div className="pv-setcard" role="group" aria-label={label}>
        {children}
      </div>
    </section>
  );
}

export interface SettingRowProps {
  label: string;
  desc?: string;
  /**
   * Wide rows stack the control on its own full-width line under the label —
   * for broad controls (theme preview cards, provider forms, path pickers).
   */
  wide?: boolean;
  children?: ReactNode;
}

/** One setting: label (+ optional description) left, control right. */
export function SettingRow({ label, desc, wide, children }: SettingRowProps) {
  return (
    <div className={cx("pv-setrow", wide && "pv-setrow--wide")}>
      <div className="pv-setrow-main">
        <div className="pv-setrow-label">{label}</div>
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
