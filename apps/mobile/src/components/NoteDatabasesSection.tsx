import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Database, FileText, Link2 } from "lucide-react";
import {
  baseColumnLabel,
  buildNoteDatabaseContext,
  computedFieldText,
  EMPTY_NOTE_DATABASE_CONTEXT,
  hasNoteDatabaseContext,
  ICON,
  IconButton,
  listNames,
  parseWikiLinkValue,
  shownComputedFields,
  type NoteComputedField,
  type NoteDatabaseContext,
  type NoteDatabaseMembership,
} from "@plainva/ui";
import { buildMobilePlanDeps } from "../services/cascadeDelete";
import { vaultOps, type MobileVault } from "../services/vaultService";

/**
 * "Which database does this note belong to?" on the phone (S23).
 *
 * Sitting inside a note that is a row of a database, nothing said so — no
 * database, no parent, no sub-items. The desktop answers it in the right
 * sidebar; the phone's context sheet IS that sidebar, so this is a segment
 * rather than a new surface.
 *
 * The model is the shared one, over the same deps the cascade deletion already
 * builds: both features have to agree on what "belongs to" means, or a note
 * could be a member for one and not for the other.
 *
 * Since 2026-10-06 it also shows what the database COMPUTES for this note —
 * rollups, reverse relations, facts about the file — the same fields as the
 * desktop's section (plan Befunde 2026-10-06, R3). Until then the phone showed
 * membership and paging only, which was a difference nobody had decided. Which
 * columns count as computed is the shared `computedFieldKind`; a column that
 * is a property of the note stands under Properties, here as there.
 */

/** The notes a reverse relation lists, as their wiki targets and display names. */
function reverseLinks(field: NoteComputedField): Array<{ target: string; display: string }> {
  const raw = Array.isArray(field.value) ? field.value : field.value == null || field.value === "" ? [] : [field.value];
  return raw.map((entry) => {
    const text = String(entry);
    const wiki = parseWikiLinkValue(text);
    return { target: wiki?.target ?? text, display: wiki?.display ?? text };
  });
}

function ComputedFields({
  vault,
  path,
  membership,
  onOpenNote,
}: {
  vault: MobileVault;
  path: string;
  membership: NoteDatabaseMembership;
  onOpenNote: (p: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const fields = shownComputedFields(membership.computed);
  const label = (column: string) => baseColumnLabel(column, (key) => t(key), membership.config);
  return (
    <>
      {fields.map((field) => {
        // A reverse relation is a list of notes: each is a row that opens its
        // note, under the column's name — the shape sub-items have below.
        if (field.kind === "reverse") {
          const links = reverseLinks(field);
          return (
            <div key={field.column} data-testid="db-computed" data-column={field.column}>
              <p className="m-sectionlabel m-sectionlabel--inset">{label(field.column)}</p>
              {links.length === 0 ? (
                <div className="m-row m-row--static">
                  <span className="m-prop-val">–</span>
                </div>
              ) : (
                links.map((link, i) => (
                  <button
                    className="m-row"
                    key={`${link.target}-${i}`}
                    onClick={() => {
                      void vaultOps.resolveWikiTarget(vault, link.target, path).then((p) => {
                        if (p) onOpenNote(p);
                      }).catch(() => {});
                    }}
                  >
                    <FileText size={ICON.head} />
                    <span>{link.display}</span>
                  </button>
                ))
              )}
            </div>
          );
        }
        return (
          <div className="m-row m-row--static" key={field.column} data-testid="db-computed" data-column={field.column}>
            <span className="m-prop-key">{label(field.column)}</span>
            <span className="m-prop-val">{computedFieldText(field, i18n.language) || "–"}</span>
          </div>
        );
      })}
      {membership.shownAsProperties.length > 0 && (
        <p className="m-hint" data-testid="db-under-properties">
          {t("dbContext.underProperties", { fields: listNames(membership.shownAsProperties.map(label), i18n.language) })}
        </p>
      )}
    </>
  );
}

export function NoteDatabasesSection({
  vault,
  path,
  onOpenNote,
  onOpenBase,
}: {
  vault: MobileVault;
  path: string;
  onOpenNote: (p: string) => void;
  onOpenBase: (p: string) => void;
}) {
  const { t } = useTranslation();
  const [ctx, setCtx] = useState<NoteDatabaseContext | null>(null);

  useEffect(() => {
    let alive = true;
    setCtx(null);
    const deps = buildMobilePlanDeps(vault);
    if (!deps) {
      setCtx(EMPTY_NOTE_DATABASE_CONTEXT);
      return;
    }
    void buildNoteDatabaseContext(deps, path)
      .then((c) => {
        if (alive) setCtx(c);
      })
      .catch(() => {
        // A broken `.base` must not take the sheet down with it.
        if (alive) setCtx(EMPTY_NOTE_DATABASE_CONTEXT);
      });
    return () => {
      alive = false;
    };
  }, [vault, path]);

  if (ctx === null) return <p className="m-hint">{t("common.loading")}</p>;
  if (!hasNoteDatabaseContext(ctx)) return <p className="m-hint">{t("dbContext.memberOf")} —</p>;

  return (
    <>
      {ctx.memberships.map((m) => (
        <div key={m.basePath} data-testid="db-membership">
          <button className="m-row" onClick={() => onOpenBase(m.basePath)}>
            <Database size={ICON.head} />
            <span>
              {m.viewName
                ? t("dbContext.openBaseView", { base: m.baseLabel, view: m.viewName })
                : m.baseLabel}
            </span>
          </button>
          {/* Hidden when the view's filters exclude this note — "0 / 34" would
              be a riddle (the desktop's rule, which the phone did not have). */}
          {m.index > 0 && (
            <div className="m-peeknav">
              <IconButton
                label={t("dbContext.prevEntry")}
                disabled={!m.prevPath}
                onClick={() => m.prevPath && onOpenNote(m.prevPath)}
              >
                <ChevronLeft size={ICON.touch} />
              </IconButton>
              <span className="m-peekpos">{`${m.index} / ${m.total}`}</span>
              <IconButton
                label={t("dbContext.nextEntry")}
                disabled={!m.nextPath}
                onClick={() => m.nextPath && onOpenNote(m.nextPath)}
              >
                <ChevronRight size={ICON.touch} />
              </IconButton>
            </div>
          )}
          <ComputedFields membership={m} onOpenNote={onOpenNote} path={path} vault={vault} />
        </div>
      ))}

      {ctx.parent && (
        <>
          <p className="m-sectionlabel m-sectionlabel--inset">{t("dbContext.parent")}</p>
          <button className="m-row" onClick={() => onOpenNote(ctx.parent!.path)}>
            <span>{ctx.parent.title}</span>
          </button>
        </>
      )}

      {ctx.children.length > 0 && (
        <>
          <p className="m-sectionlabel m-sectionlabel--inset">
            {t("dbContext.subItemCount", { n: ctx.children.length })}
          </p>
          {ctx.children.map((c) => (
            <button className="m-row" key={c.path} onClick={() => onOpenNote(c.path)}>
              <span>{c.title}</span>
            </button>
          ))}
        </>
      )}

      {ctx.linked.length > 0 && (
        <>
          <p className="m-sectionlabel m-sectionlabel--inset">{t("dbContext.linked")}</p>
          {ctx.linked.map((l) => (
            <button className="m-row" key={l.basePath} onClick={() => onOpenBase(l.basePath)}>
              <Link2 size={ICON.head} />
              <span>{t("dbContext.linkedEntry", { base: l.baseLabel, n: l.count })}</span>
            </button>
          ))}
        </>
      )}
    </>
  );
}
