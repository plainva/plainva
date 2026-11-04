import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { ICON } from "../../lib/iconSizes";

export type BannerKind = "info" | "warning" | "error" | "success";

export interface BannerProps {
  kind: BannerKind;
  children: ReactNode;
  /** Optional trailing actions (small buttons/links). */
  actions?: ReactNode;
  /** Rounded corners for free-standing placement (inline strips stay square). */
  rounded?: boolean;
  className?: string;
  /** Replaces the tone's glyph where a notice names its own subject (the
   * eye of a preview, plan Befunde 2026-09-24 E22); the tone stays. */
  icon?: LucideIcon;
  testId?: string;
}

const ICONS = {
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
  success: CheckCircle2,
} as const;

/**
 * Inline notice banner (design sweep 2026-07-19): the ONE strip for editor
 * conflict/draft/managed-index rows, sync hints and form-level errors —
 * replaces three copy-pasted style objects in Editor.tsx. Status colors come
 * exclusively from the --info/warning/error/success token families.
 */
export function Banner({ kind, children, actions, rounded, className, icon, testId }: BannerProps) {
  const Ic = icon ?? ICONS[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cx("pv-banner", `pv-banner--${kind}`, rounded && "pv-banner--rounded", className)} data-testid={testId}>
      <span className="pv-banner-ic"><Ic size={ICON.ui} /></span>
      <span className="pv-banner-msg">{children}</span>
      {actions ? <span className="pv-banner-actions">{actions}</span> : null}
    </div>
  );
}
