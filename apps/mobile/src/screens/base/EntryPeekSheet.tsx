import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Button, ICON, IconButton } from "@plainva/ui";
import { SheetGrip } from "../../components/SheetGrip";
import type { EntryPeek } from "./entryPeek";

/**
 * The entry inspector as a bottom sheet (S20).
 *
 * The desktop peeks in a floating window; a phone has no room beside the table,
 * so the sheet is the peek. It shows exactly what the view shows — its columns,
 * this row's values — and lets both be edited, because the fastest fix for a
 * wrong field is the one you make where you noticed it.
 *
 * Position and neighbours are the point: stepping to the next entry without
 * closing anything is what makes going through a database on a phone bearable.
 */
export function EntryPeekSheet({
  peek,
  columnLabel,
  displayCell,
  isEditable,
  onEdit,
  onStep,
  onOpen,
  onClose,
}: {
  peek: EntryPeek;
  columnLabel: (col: string) => string;
  displayCell: (col: string, v: unknown) => string;
  /** Computed reverse columns are not editable — they live in the other note. */
  isEditable: (col: string) => boolean;
  onEdit: (col: string) => void;
  onStep: (path: string) => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{peek.title}</p>
        <div className="m-peeknav">
          <IconButton
            label={t("dbContext.prevEntry")}
            disabled={!peek.prevPath}
            onClick={() => peek.prevPath && onStep(peek.prevPath)}
          >
            <ChevronLeft size={ICON.touch} />
          </IconButton>
          <span className="m-peekpos">{`${peek.index} / ${peek.total}`}</span>
          <IconButton
            label={t("dbContext.nextEntry")}
            disabled={!peek.nextPath}
            onClick={() => peek.nextPath && onStep(peek.nextPath)}
          >
            <ChevronRight size={ICON.touch} />
          </IconButton>
        </div>
        {peek.columns.length === 0 ? (
          <p className="m-hint">{t("database.noColumns")}</p>
        ) : (
          peek.columns.map((col) => {
            const value = displayCell(col, peek.row[col]) || "—";
            const label = columnLabel(col);
            if (!isEditable(col)) {
              return (
                <div className="m-row m-row--split" key={col}>
                  <span className="m-peeklabel">{label}</span>
                  <span className="m-peekvalue">{value}</span>
                </div>
              );
            }
            return (
              <button className="m-row m-row--split" key={col} onClick={() => onEdit(col)}>
                <span className="m-peeklabel">{label}</span>
                <span className="m-peekvalue">{value}</span>
              </button>
            );
          })
        )}
        <Button variant="primary" onClick={onOpen}>
          <ExternalLink size={ICON.ui} />
          {t("database.entryOpen")}
        </Button>
      </div>
    </div>
  );
}
