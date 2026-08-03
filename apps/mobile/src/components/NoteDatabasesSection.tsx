import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Database, Link2 } from "lucide-react";
import {
  buildNoteDatabaseContext,
  EMPTY_NOTE_DATABASE_CONTEXT,
  hasNoteDatabaseContext,
  ICON,
  IconButton,
  type NoteDatabaseContext,
} from "@plainva/ui";
import { buildMobilePlanDeps } from "../services/cascadeDelete";
import type { MobileVault } from "../services/vaultService";

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
 */
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

  if (ctx === null) return <p className="m-hint m-hint--inset">{t("common.loading")}</p>;
  if (!hasNoteDatabaseContext(ctx)) return <p className="m-hint m-hint--inset">{t("dbContext.memberOf")} —</p>;

  return (
    <>
      {ctx.memberships.map((m) => (
        <div key={m.basePath}>
          <button className="m-row" onClick={() => onOpenBase(m.basePath)}>
            <Database size={ICON.head} />
            <span>
              {m.viewName
                ? t("dbContext.openBaseView", { base: m.baseLabel, view: m.viewName })
                : m.baseLabel}
            </span>
          </button>
          {m.total > 0 && (
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
