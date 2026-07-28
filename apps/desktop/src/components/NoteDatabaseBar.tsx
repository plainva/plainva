import React from "react";
import { useTranslation } from "react-i18next";
import { Database } from "lucide-react";
import { ICON, type NoteDatabaseContext } from "@plainva/ui";

/**
 * Database context line above the note title (plan P4, variant A of the
 * mockup): `🗄 Aufgaben / Website-Relaunch / **Startseite**` plus a
 * "3 Unterelemente" chip.
 *
 * Appears ONLY when the note really belongs to a database — otherwise the
 * document head stays as slim as it is today. Belonging to several databases
 * shows ALL of them (E6); the row wraps instead of truncating.
 *
 * Purely derived from `.base` sources and the link index — clicking navigates,
 * nothing is ever written into the note.
 */
export const NoteDatabaseBar: React.FC<{
  context: NoteDatabaseContext;
  title: string;
  fullWidth: boolean;
  onOpenPath: (path: string) => void;
}> = ({ context, title, fullWidth, onOpenPath }) => {
  const { t } = useTranslation();
  const { memberships, parent, children } = context;
  if (memberships.length === 0 && !parent && children.length === 0) return null;

  return (
    <div
      className="pv-dbbar"
      data-testid="note-db-bar"
      // `marginInline`, not the `margin` shorthand: the shorthand also wrote
      // the block margins and so silently overrode the vertical spacing the
      // class defines — which is why the row sat on the toolbar's rule.
      style={{ maxWidth: fullWidth ? "none" : "800px", marginInline: "auto", padding: "0 2rem", width: "100%", boxSizing: "border-box" }}
    >
      {memberships.map((m) => (
        <button
          key={m.basePath}
          type="button"
          className="pv-chip pv-dbbar-chip"
          onClick={() => onOpenPath(m.basePath)}
          data-tip={m.viewName ? t("dbContext.openBaseView", { defaultValue: "{{base}} · Ansicht „{{view}}“", base: m.baseLabel, view: m.viewName }) : m.baseLabel}
        >
          <Database size={ICON.meta} aria-hidden />
          <span>{m.baseLabel}</span>
        </button>
      ))}
      {parent && (
        <>
          <span className="pv-dbbar-sep" aria-hidden>/</span>
          <button type="button" className="pv-dbbar-crumb" onClick={() => onOpenPath(parent.path)}>
            {parent.title}
          </button>
        </>
      )}
      <span className="pv-dbbar-sep" aria-hidden>/</span>
      <span className="pv-dbbar-crumb pv-dbbar-crumb--here">{title}</span>
      {children.length > 0 && (
        <span className="pv-chip pv-dbbar-count">
          {t("dbContext.subItemCount", { defaultValue: "{{n}} Unterelemente", n: children.length })}
        </span>
      )}
    </div>
  );
};
