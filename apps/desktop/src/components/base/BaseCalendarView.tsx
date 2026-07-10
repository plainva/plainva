import { EmptyState } from "@plainva/ui";
import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCardPointerDrag } from "./useCardPointerDrag";
import { DragGhost, OPEN_SPLIT_TARGET, SplitDropZone } from "./baseViewerShared";
import type { BaseCells } from "./useBaseCells";

// Calendar view of the BaseViewer (structural split, plan C3). The displayed
// month lives in the BaseViewer so switching views does not reset the browsing
// position; dragging a note onto a day (pointer-driven, plan W6 — HTML5 DnD is
// swallowed by Tauri) writes the date into its frontmatter.
export function BaseCalendarView({
  dbData,
  dateProp,
  calMonth,
  setCalMonth,
  visibleColumns,
  cells,
  onOpenNote,
  onDropToSplit,
}: {
  dbData: any[];
  dateProp: string | null;
  calMonth: { y: number; m: number };
  setCalMonth: React.Dispatch<React.SetStateAction<{ y: number; m: number }>>;
  /** Properties enabled in the config panel — shown on each entry (P4). */
  visibleColumns: string[];
  cells: BaseCells;
  onOpenNote?: (path: string, ev?: React.MouseEvent) => void;
  /** Dropping an entry on the split zone opens it in the neighboring pane (P5). */
  onDropToSplit?: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { handleCellSave, formatValueForDisplay } = cells;

  // The entry title and the day cell already communicate name and date — the
  // extra lines show the remaining enabled properties, skipping empty values
  // to keep the small day cells readable (P4).
  const entryColumns = visibleColumns.filter((c) => c !== "file.name" && c !== dateProp);

  const { cardHandlers, registerTarget, draggingPath, overTarget, ghostProps } = useCardPointerDrag<string>({
    onDrop: (path, dateStr) => {
      if (dateStr === OPEN_SPLIT_TARGET) { onDropToSplit?.(path); return; }
      if (dateProp) void handleCellSave(path, dateProp, dateStr);
    },
  });
  const draggedRow = draggingPath ? dbData.find((r) => r["file.path"] === draggingPath) : null;

  const today = new Date();
  const { y: year, m: month } = calMonth;
  const locale = i18n.language || "de";
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const days = Array.from({ length: 42 }, (_, i) => { const day = i - startOffset + 1; return day > 0 && day <= daysInMonth ? day : null; });
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: "short" }));
  const monthLabel = new Date(year, month, 1).toLocaleDateString(locale, { month: "long", year: "numeric" });
  const isToday = (day: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateOf = (day: number) => year + "-" + pad(month + 1) + "-" + pad(day);
  const prevMonth = () => setCalMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }));
  const nextMonth = () => setCalMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }));

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
            <button onClick={prevMonth} className="base-nav-btn" aria-label={t("database.prevPeriod", "Zurück")} title={t("database.prevPeriod", "Zurück")}><ChevronLeft size={16} /></button>
            <span style={{ fontWeight: 600, minWidth: 150, textAlign: "center" }}>{monthLabel}</span>
            <button onClick={nextMonth} className="base-nav-btn" aria-label={t("database.nextPeriod", "Weiter")} title={t("database.nextPeriod", "Weiter")}><ChevronRight size={16} /></button>
            <button onClick={() => setCalMonth({ y: today.getFullYear(), m: today.getMonth() })} className="base-today-btn">{t("database.today", "Heute")}</button>
          </div>
          <div className="custom-scrollbar" style={{ overflowY: "auto", flex: 1 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", background: "var(--border-color)", gap: "1px" }}>
              {weekdays.map((d, wi) => (
                <div key={wi} style={{ background: "var(--bg-secondary)", padding: "0.5rem", textAlign: "center", fontWeight: 600, fontSize: "0.78rem", color: "var(--text-muted)" }}>{d}</div>
              ))}
              {days.map((day, i) => {
                if (!day) return <div key={i} style={{ background: "var(--bg-primary)", minHeight: 96 }} />;
                const dateStr = dateOf(day);
                const items = dbData.filter((r) => r[dateProp] === dateStr || (r[dateProp] && String(r[dateProp]).startsWith(dateStr)));
                const todayCell = isToday(day);
                return (
                  <div key={i} ref={registerTarget(dateStr)}
                    style={{ background: "var(--bg-primary)", padding: "0.4rem", display: "flex", flexDirection: "column", gap: "0.25rem", minHeight: 96, outline: overTarget === dateStr && draggingPath ? "2px solid var(--accent-color)" : "none", outlineOffset: -2 }}>
                    <div style={{ alignSelf: "flex-end", fontSize: "0.76rem", fontWeight: todayCell ? 700 : 400, color: todayCell ? "var(--accent-on)" : "var(--text-muted)", background: todayCell ? "var(--accent-color)" : "transparent", borderRadius: "var(--radius-pill)", minWidth: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{day}</div>
                    {items.map((row, idx) => (
                      <div key={row["file.path"] || idx} {...cardHandlers(row["file.path"])}
                        onClick={(e) => onOpenNote?.(row["file.path"], e)} title={row["file.name"]}
                        style={{ background: "var(--bg-secondary)", color: "var(--text-main)", padding: "0.3rem 0.45rem", borderRadius: "var(--radius-sm)", fontSize: "0.76rem", cursor: "pointer", borderLeft: "2px solid var(--accent-color)", touchAction: "none", opacity: draggingPath === row["file.path"] ? 0.45 : 1 }}>
                        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 500 }}>{row["file.name"]}</div>
                        {entryColumns.map((col) => {
                          let v = row[col];
                          if (v === undefined && col.startsWith("note.")) v = row[col.substring(5)];
                          const { displayVal, isMissing } = formatValueForDisplay(v, col);
                          if (isMissing) return null;
                          return (
                            <div key={col} style={{ fontSize: "0.68rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                              {displayVal}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      {draggedRow && (
        <DragGhost
          setEl={ghostProps.setEl}
          baseStyle={ghostProps.style}
          style={{ maxWidth: 200, background: "var(--bg-secondary)", color: "var(--text-main)", padding: "0.3rem 0.45rem", borderRadius: "var(--radius-sm)", fontSize: "0.76rem", borderLeft: "2px solid var(--accent-color)", boxShadow: "0 6px 18px rgba(0,0,0,0.28)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
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
