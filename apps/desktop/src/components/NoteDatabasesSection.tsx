import React, { useEffect, useMemo, useState } from "react";

import { useTranslation } from "react-i18next";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Clock, CornerLeftUp, Database, FileText, Link2, ListTree, Sigma } from "lucide-react";
import {
  computedFieldText,
  ICON,
  IconButton,
  listNames,
  PropLine,
  PropRow,
  shownComputedFields,
  type NoteComputedField,
  type NoteDatabaseContext,
  type NoteDatabaseMembership,
} from "@plainva/ui";
import { useBaseCells } from "./base/useBaseCells";

/**
 * "Databases" section of the right sidebar (plan Befunde 2026-10-06, R3 —
 * decision E1, variant A).
 *
 * It answers what only the database knows about this note: which database it
 * is a row of, where it stands in the view, and the values the database
 * COMPUTES when the view is read — rollups, reverse relations, facts about the
 * file. It used to list every column of the view with an editor, and for most
 * notes that was the same three values the properties section showed directly
 * below in another form. A column that is a property of the note is shown and
 * edited once, under Properties; a line here says which ones those are.
 *
 * Everything is drawn in the column's one row grammar (`PropRow`); the section
 * has no grid of its own any more.
 */

function fieldIcon(field: NoteComputedField): React.ReactNode {
  if (field.kind === "rollup" || field.kind === "formula") return <Sigma size={ICON.ui} aria-hidden="true" />;
  if (field.kind === "reverse") return <Link2 size={ICON.ui} aria-hidden="true" />;
  if (field.column === "file.mtime" || field.column === "file.ctime") return <Clock size={ICON.ui} aria-hidden="true" />;
  if (field.column === "file.day") return <Calendar size={ICON.ui} aria-hidden="true" />;
  return <FileText size={ICON.ui} aria-hidden="true" />;
}

const MembershipBlock: React.FC<{
  membership: NoteDatabaseMembership;
  onOpenPath: (path: string, newTab?: boolean) => void;
}> = ({ membership, onOpenPath }) => {
  const { t, i18n } = useTranslation();
  // The cell layer formats a value the way the database's table does (option
  // colours, link chips that open their note). It wants rows it could edit;
  // nothing here is edited, so the one row is handed over as it is.
  const rows = useMemo(() => (membership.row ? [membership.row] : []), [membership.row]);
  const cells = useBaseCells({ dbConfig: membership.config, dbData: rows, setDbData: (() => {}) as never, onOpenNote: (p) => onOpenPath(p) });
  const fields = shownComputedFields(membership.computed);
  const viewLabel = membership.viewName ? t("dbContext.viewLabel", { view: membership.viewName }) : "";
  const listed = listNames(membership.shownAsProperties.map((col) => cells.columnLabel(col)), i18n.language);
  // The note the row stands for: a link in one of its values is read from there.
  const rowFile = membership.row?.["file.path"];
  const rowPath = typeof rowFile === "string" ? rowFile : undefined;

  return (
    <div className="pv-dbinsp-block" data-testid="db-membership">
      <PropLine
        icon={<Database size={ICON.ui} aria-hidden="true" />}
        trailing={
          // Position in the view, with a step to either neighbour. Hidden when
          // the view's filters exclude this note — "0 / 34" would be a riddle.
          membership.index > 0 && (
            <span className="pv-dbinsp-nav">
              <IconButton size="sm" label={t("dbContext.prevEntry")} disabled={!membership.prevPath} onClick={() => membership.prevPath && onOpenPath(membership.prevPath)}>
                <ChevronLeft size={ICON.meta} />
              </IconButton>
              <span className="pv-dbinsp-pos">{membership.index} / {membership.total}</span>
              <IconButton size="sm" label={t("dbContext.nextEntry")} disabled={!membership.nextPath} onClick={() => membership.nextPath && onOpenPath(membership.nextPath)}>
                <ChevronRight size={ICON.meta} />
              </IconButton>
            </span>
          )
        }
      >
        {/* The name shortens with an ellipsis; the tooltip has all of it. */}
        <button
          type="button"
          className="pv-dbinsp-open"
          data-tip={viewLabel ? `${membership.baseLabel} · ${viewLabel}` : membership.baseLabel}
          onClick={() => onOpenPath(membership.basePath)}
        >
          <b>{membership.baseLabel}</b>
          {viewLabel && <small> · {viewLabel}</small>}
        </button>
      </PropLine>

      {fields.map((field) => {
        // Rollups and reverse relations go through the table's own formatter
        // (a percentage says so, a link is a chip that opens its note); the
        // file facts are plain text, written the same on both shells.
        const rich = field.kind === "rollup" || field.kind === "reverse";
        const text = rich ? "" : computedFieldText(field, i18n.language);
        return (
          <PropRow key={field.column} data-testid="db-computed" data-column={field.column} kind={field.kind} icon={fieldIcon(field)} name={cells.columnLabel(field.column)}>
            {rich
              ? cells.formatValueForDisplay(field.value, field.column, rowPath).displayVal
              : <span className="pv-prow-static">{text || "–"}</span>}
          </PropRow>
        );
      })}

      {membership.shownAsProperties.length > 0 && (
        <p className="pv-prow-hint" data-testid="db-under-properties">{t("dbContext.underProperties", { fields: listed })}</p>
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
  // A different note starts with its sub-items in view again.
  useEffect(() => { setChildrenOpen(true); }, [activePath]);

  return (
    <div className="pv-dbinsp">
      {/* One block per database — a note can be a row of several (E6). */}
      {activePath && memberships.map((m) => (
        <MembershipBlock key={m.basePath} membership={m} onOpenPath={onOpenPath} />
      ))}

      {parent && (
        <PropRow icon={<CornerLeftUp size={ICON.ui} aria-hidden="true" />} name={t("dbContext.parent")}>
          <button type="button" className="pv-linkbtn pv-prow-link" onClick={() => onOpenPath(parent.path)}>{parent.title}</button>
          <span className="pv-prow-static">({parent.baseLabel})</span>
        </PropRow>
      )}

      {children.length > 0 && (
        <PropRow
          icon={<ListTree size={ICON.ui} aria-hidden="true" />}
          name={t("dbContext.subItems")}
          // Collapsible: a parent with twenty sub-items must not push the rest
          // of the section out of sight. The toggle stands in the edge, where
          // every row keeps what it can do.
          edge={
            <button type="button" className="pv-prow-toggle" aria-expanded={childrenOpen} aria-label={t("dbContext.subItems")} onClick={() => setChildrenOpen((v) => !v)}>
              <ChevronDown size={ICON.meta} className={childrenOpen ? undefined : "pv-prow-toggle-closed"} />
            </button>
          }
        >
          <span className="pv-badge pv-badge--accent">{children.length}</span>
          {childrenOpen && children.map((c) => (
            <button key={c.path} type="button" className="pv-linkbtn pv-prow-link pv-prow-item" onClick={() => onOpenPath(c.path)}>{c.title}</button>
          ))}
        </PropRow>
      )}

      {linked.map((l, i) => (
        <PropRow key={l.basePath} icon={i === 0 ? <Link2 size={ICON.ui} aria-hidden="true" /> : undefined} name={i === 0 ? t("dbContext.linked") : ""}>
          <button type="button" className="pv-linkbtn pv-prow-link" onClick={() => onOpenPath(l.basePath)}>
            {t("dbContext.linkedEntry", { base: l.baseLabel, n: l.count })}
          </button>
        </PropRow>
      ))}
    </div>
  );
};
