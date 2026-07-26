import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { ICON, type NoteDatabaseContext } from "@plainva/ui";

/**
 * "Databases" section of the right sidebar (plan P4, mockup variant B): the
 * detail view next to the context line in the document head. The line carries
 * orientation and the jump; this carries parent, sub-items and linked
 * databases.
 *
 * Read-only, like the line: everything is derived from `.base` sources and the
 * link index.
 */
export const NoteDatabasesSection: React.FC<{
  context: NoteDatabaseContext;
  onOpenPath: (path: string, newTab?: boolean) => void;
}> = ({ context, onOpenPath }) => {
  const { t } = useTranslation();
  const { memberships, parent, children, linked } = context;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}>
      {memberships.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="pv-kv-key">{t("dbContext.memberOf", { defaultValue: "Gehört zu" })}</span>
          {memberships.map((m) => (
            <button key={m.basePath} type="button" className="pv-dbbar-crumb" style={{ textAlign: "left", color: "var(--text-main)" }} onClick={() => onOpenPath(m.basePath)}>
              {m.viewName
                ? t("dbContext.openBaseView", { defaultValue: "{{base}} · Ansicht „{{view}}“", base: m.baseLabel, view: m.viewName })
                : m.baseLabel}
            </button>
          ))}
        </div>
      )}

      {parent && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="pv-kv-key">{t("dbContext.parent", { defaultValue: "Übergeordnet" })}</span>
          <button type="button" className="pv-dbbar-crumb" style={{ textAlign: "left", color: "var(--text-main)" }} onClick={() => onOpenPath(parent.path)}>
            {parent.title} <span style={{ color: "var(--text-faint)" }}>({parent.baseLabel})</span>
          </button>
        </div>
      )}

      {children.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="pv-kv-key">{t("dbContext.subItems", { defaultValue: "Unterelemente" })}</span>
          {children.map((c) => (
            <button
              key={c.path}
              type="button"
              className="pv-dbbar-crumb"
              style={{ display: "flex", alignItems: "center", gap: 4, textAlign: "left" }}
              onClick={() => onOpenPath(c.path)}
            >
              <ChevronRight size={ICON.meta} aria-hidden />
              {c.title}
            </button>
          ))}
        </div>
      )}

      {linked.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="pv-kv-key">{t("dbContext.linked", { defaultValue: "Verknüpft" })}</span>
          {linked.map((l) => (
            <button key={l.basePath} type="button" className="pv-dbbar-crumb" style={{ textAlign: "left", color: "var(--text-main)" }} onClick={() => onOpenPath(l.basePath)}>
              {t("dbContext.linkedEntry", { defaultValue: "{{base}} · {{n}} Einträge", base: l.baseLabel, n: l.count })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
