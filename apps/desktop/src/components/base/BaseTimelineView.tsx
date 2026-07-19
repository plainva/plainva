import { EmptyState, ICON } from "@plainva/ui";
import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCardPointerDrag } from "./useCardPointerDrag";
import { DragGhost, OPEN_SPLIT_TARGET, SplitDropZone } from "./baseViewerShared";
import type { BaseCells } from "./useBaseCells";

// Timeline view of the BaseViewer (structural split, plan C3). The visible
// window start lives in the BaseViewer so switching views does not reset it;
// items spanning start→end render a full card on the start day and a compact
// continuation chip on the following days.
export function BaseTimelineView({
  dbData,
  dateProp,
  endProp,
  timelineStart,
  setTimelineStart,
  visibleColumns,
  cells,
  onOpenNote,
  onDropToSplit,
}: {
  dbData: any[];
  dateProp: string | null;
  endProp: string | null;
  timelineStart: Date;
  setTimelineStart: React.Dispatch<React.SetStateAction<Date>>;
  /** Properties enabled in the config panel — shown on each start card (P4-Nachtrag). */
  visibleColumns: string[];
  cells: BaseCells;
  onOpenNote?: (path: string, ev?: React.MouseEvent) => void;
  /** Dropping a card on the split zone opens it in the neighboring pane (P5). */
  onDropToSplit?: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { handleCellSave, formatValueForDisplay } = cells;

  // Name, start day (column position) and end date are already visible — the
  // extra lines show the remaining enabled properties, skipping empty values.
  const entryColumns = visibleColumns.filter((c) => c !== "file.name" && c !== dateProp && c !== endProp);

  // Pointer-driven day drop (plan W6 — HTML5 DnD is swallowed by Tauri).
  const { cardHandlers, registerTarget, draggingPath, overTarget, ghostProps } = useCardPointerDrag<string>({
    onDrop: (path, dateStr) => {
      if (dateStr === OPEN_SPLIT_TARGET) { onDropToSplit?.(path); return; }
      if (dateProp) void handleCellSave(path, dateProp, dateStr);
    },
  });
  const draggedRow = draggingPath ? dbData.find((r) => r["file.path"] === draggingPath) : null;

  const dpart = (v: any) => (v === undefined || v === null || v === "" ? null : String(v).slice(0, 10));
  const today = new Date();
  const locale = i18n.language || "de";
  const DAYS = 21;
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = Array.from({ length: DAYS }, (_, i) => { const d = new Date(timelineStart); d.setDate(timelineStart.getDate() + i); return d; });
  const shift = (n: number) => setTimelineStart((prev) => { const d = new Date(prev); d.setDate(prev.getDate() + n); return d; });
  const goToday = () => { const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); setTimelineStart(d); };
  const rangeLabel = days[0].toLocaleDateString(locale, { day: "numeric", month: "short" }) + " – " + days[DAYS - 1].toLocaleDateString(locale, { day: "numeric", month: "short" });

  // Empty view (plan Designsprache P7/C7): a filtered-out view used to render
  // a bare canvas — now the shared EmptyState says so.
  if (dbData.length === 0) {
    return <EmptyState>{t("database.emptyView", { defaultValue: "Keine Einträge in dieser Ansicht." })}</EmptyState>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {!dateProp ? (
        <div style={{ padding: "1rem", color: "var(--text-muted)" }}>{t("database.noDateField", "Kein Datumsfeld konfiguriert. Bitte oben ein Feld wählen.")}</div>
      ) : (
        <>
          <div className="base-period-toolbar">
            <button onClick={() => shift(-7)} className="base-nav-btn" aria-label={t("database.prevPeriod", "Zurück")} data-tip={t("database.prevPeriod", "Zurück")}><ChevronLeft size={ICON.ui} /></button>
            <span style={{ fontWeight: 600, minWidth: 150, textAlign: "center" }}>{rangeLabel}</span>
            <button onClick={() => shift(7)} className="base-nav-btn" aria-label={t("database.nextPeriod", "Weiter")} data-tip={t("database.nextPeriod", "Weiter")}><ChevronRight size={ICON.ui} /></button>
            <button onClick={goToday} className="base-today-btn">{t("database.today", "Heute")}</button>
          </div>
          <div className="custom-scrollbar" style={{ display: "flex", overflowX: "auto", flex: 1, background: "var(--border-color)", gap: "1px" }}>
            {days.map((d, i) => {
              const dateStr = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
              const isToday = d.toDateString() === today.toDateString();
              const weekend = d.getDay() === 0 || d.getDay() === 6;
              const dayItems = dbData.map((row) => {
                const start = dpart(row[dateProp]);
                if (!start) return null;
                const end = endProp ? dpart(row[endProp]) || start : start;
                if (dateStr < start || dateStr > end) return null;
                return { row, isStart: dateStr === start, isSpan: !!endProp && !!end && end > start };
              }).filter(Boolean) as { row: any; isStart: boolean; isSpan: boolean }[];
              return (
                <div key={i} ref={registerTarget(dateStr)}
                  style={{ width: 150, flexShrink: 0, background: weekend ? "var(--bg-secondary)" : "var(--bg-primary)", display: "flex", flexDirection: "column", outline: overTarget === dateStr && draggingPath ? "2px solid var(--accent-color)" : "none", outlineOffset: -2 }}>
                  <div style={{ padding: "0.4rem", borderBottom: "1px solid var(--border-color)", textAlign: "center", fontSize: "var(--text-sm)", color: isToday ? "var(--accent-color)" : "var(--text-main)", fontWeight: isToday ? 700 : 500 }}>
                    <div style={{ textTransform: "uppercase", opacity: 0.7, fontSize: "var(--text-xs)" }}>{d.toLocaleDateString(locale, { weekday: "short" })}</div>
                    <div>{d.toLocaleDateString(locale, { day: "numeric", month: "short" })}</div>
                  </div>
                  <div className="custom-scrollbar" style={{ padding: "0.4rem", display: "flex", flexDirection: "column", gap: "0.4rem", flex: 1, overflowY: "auto", minHeight: 120 }}>
                    {dayItems.map(({ row, isStart, isSpan }, idx) => (
                      isStart ? (
                        <div key={(row["file.path"] || idx) + "-s"} {...cardHandlers(row["file.path"])}
                          onClick={(e) => onOpenNote?.(row["file.path"], e)} data-tip={row["file.name"]}
                          style={{ background: "var(--bg-secondary)", color: "var(--text-main)", padding: "0.4rem 0.5rem", borderRadius: "var(--radius-sm)", borderLeft: "3px solid var(--accent-color)", fontSize: "var(--text-sm)", cursor: "pointer", touchAction: "none", opacity: draggingPath === row["file.path"] ? 0.45 : 1 }}>
                          <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row["file.name"]}</div>
                          {isSpan && endProp && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: "0.15rem" }}>→ {dpart(row[endProp])}</div>}
                          {entryColumns.map((col) => {
                            let v = row[col];
                            if (v === undefined && col.startsWith("note.")) v = row[col.substring(5)];
                            const { displayVal, isMissing } = formatValueForDisplay(v, col);
                            if (isMissing) return null;
                            return (
                              <div key={col} style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                                {displayVal}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div key={(row["file.path"] || idx) + "-c"} data-tip={row["file.name"]}
                          style={{ background: "var(--bg-secondary)", color: "var(--text-muted)", padding: "0.25rem 0.5rem", borderRadius: "var(--radius-xs)", borderLeft: "3px solid var(--accent-color)", fontSize: "var(--text-xs)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.6 }}>
                          {row["file.name"]}
                        </div>
                      )
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {draggedRow && (
        <DragGhost
          setEl={ghostProps.setEl}
          baseStyle={ghostProps.style}
          style={{ maxWidth: 200, background: "var(--bg-secondary)", color: "var(--text-main)", padding: "0.4rem 0.5rem", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)", fontWeight: 500, borderLeft: "3px solid var(--accent-color)", boxShadow: "var(--shadow-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {draggedRow["file.name"]}
        </DragGhost>
      )}
      {/* Registered AFTER the group targets: columns win the drop where the zone overlaps them (P12). */}
      <SplitDropZone
        active={!!draggingPath && !!onDropToSplit}
        over={overTarget === OPEN_SPLIT_TARGET}
        registerTarget={registerTarget(OPEN_SPLIT_TARGET)}
        label={t("database.dropOpenInSplit", "Hier ablegen: im Split öffnen")}
      />
    </div>
  );
}
