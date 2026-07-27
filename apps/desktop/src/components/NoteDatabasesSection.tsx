import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { ICON, type NoteDatabaseContext, type NoteDatabaseMembership } from "@plainva/ui";
import { useBaseCells } from "./base/useBaseCells";

/**
 * "Databases" section of the right sidebar — the entry inspector (plan P2).
 *
 * The context line above the note answers "where am I"; this answers "what is
 * this entry". It shows the note's values for the columns of its database, in
 * the database's own order and with its types, options and colors — and lets
 * them be edited through the same cell editor the table uses, so a status can
 * be changed without opening the database first.
 *
 * The properties panel does not replace this: it lists raw frontmatter with no
 * order, no types and no knowledge of the database.
 */

const MembershipBlock: React.FC<{
  membership: NoteDatabaseMembership;
  notePath: string;
  onOpenPath: (path: string, newTab?: boolean) => void;
}> = ({ membership, notePath, onOpenPath }) => {
  const { t } = useTranslation();
  // The cell layer edits rows in place, so it owns a copy of this one row.
  const [rows, setRows] = useState<Record<string, unknown>[]>(() => (membership.row ? [membership.row] : []));
  useEffect(() => { setRows(membership.row ? [membership.row] : []); }, [membership.row]);

  const cells = useBaseCells({ dbConfig: membership.config, dbData: rows, setDbData: setRows as never, onOpenNote: (p) => onOpenPath(p) });
  const row = rows[0];

  return (
    <div className="pv-dbinsp-block" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          className="pv-dbbar-crumb"
          style={{ flex: 1, textAlign: "left", color: "var(--text-main)" }}
          onClick={() => onOpenPath(membership.basePath)}
        >
          {membership.viewName
            ? t("dbContext.openBaseView", { defaultValue: "{{base}} · Ansicht „{{view}}“", base: membership.baseLabel, view: membership.viewName })
            : membership.baseLabel}
        </button>
        {/* Position in the view, with a step to either neighbour. Hidden when
            the view's filters exclude this note — "0 / 34" would be a riddle. */}
        {membership.index > 0 && (
          <span className="pv-dbinsp-nav">
            <button
              type="button"
              className="pv-iconbtn"
              disabled={!membership.prevPath}
              aria-label={t("dbContext.prevEntry", { defaultValue: "Voriger Eintrag" })}
              data-tip={t("dbContext.prevEntry", { defaultValue: "Voriger Eintrag" })}
              onClick={() => membership.prevPath && onOpenPath(membership.prevPath)}
            >
              <ChevronLeft size={ICON.meta} />
            </button>
            <span className="pv-dbinsp-pos">{membership.index} / {membership.total}</span>
            <button
              type="button"
              className="pv-iconbtn"
              disabled={!membership.nextPath}
              aria-label={t("dbContext.nextEntry", { defaultValue: "Nächster Eintrag" })}
              data-tip={t("dbContext.nextEntry", { defaultValue: "Nächster Eintrag" })}
              onClick={() => membership.nextPath && onOpenPath(membership.nextPath)}
            >
              <ChevronRight size={ICON.meta} />
            </button>
          </span>
        )}
      </div>

      {row && membership.columns.length > 0 && (
        <div className="pv-dbinsp-grid">
          {membership.columns.map((col) => {
            const val = row[col] ?? row[`note.${col}`];
            const { displayVal } = cells.formatValueForDisplay(val, col);
            return (
              <React.Fragment key={col}>
                <span className="pv-kv-key">{cells.columnLabel(col)}</span>
                <span className="pv-dbinsp-val">{cells.renderEditableCell({ ...row, "file.path": notePath }, col, val, displayVal)}</span>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const NoteDatabasesSection: React.FC<{
  context: NoteDatabaseContext;
  activePath: string | null;
  onOpenPath: (path: string, newTab?: boolean) => void;
}> = ({ context, activePath, onOpenPath }) => {
  const { t } = useTranslation();
  const { memberships, parent, children, linked } = context;
  const [childrenOpen, setChildrenOpen] = useState(true);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", fontSize: "var(--text-sm)" }}>
      {/* One block per database — a note can be a row of several (E6). */}
      {activePath && memberships.map((m) => (
        <MembershipBlock key={m.basePath} membership={m} notePath={activePath} onOpenPath={onOpenPath} />
      ))}

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
          {/* Collapsible: a parent with twenty sub-items must not push the rest
              of the section out of sight. */}
          <button
            type="button"
            className="pv-dbinsp-disclose"
            aria-expanded={childrenOpen}
            onClick={() => setChildrenOpen((v) => !v)}
          >
            <ChevronDown size={ICON.meta} style={{ transition: "transform var(--dur-2) var(--ease-1)", transform: childrenOpen ? "none" : "rotate(-90deg)", flexShrink: 0 }} />
            <span className="pv-kv-key">{t("dbContext.subItems", { defaultValue: "Unterelemente" })}</span>
            <span className="pv-badge pv-badge--accent">{children.length}</span>
          </button>
          {childrenOpen && children.map((c) => (
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
