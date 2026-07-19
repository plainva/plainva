import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  // Anchor position (viewport coords, e.g. the editor caret).
  x: number;
  y: number;
  onSelect: (rows: number, cols: number) => void;
  onClose: () => void;
}

const MIN = 5; // smallest grid shown
const MAX = 10; // largest selectable size
const CELL = 18;
const GAP = 4;

// Notion/Word-style grid picker: hover to choose rows × columns, click (or
// Enter) to insert. The grid grows toward MAX as the hover approaches its edge.
export const TableSizePicker: React.FC<Props> = ({ x, y, onSelect, onClose }) => {
  const { t } = useTranslation();
  const [hover, setHover] = useState<{ r: number; c: number }>({ r: 1, c: 1 });
  const ref = useRef<HTMLDivElement>(null);

  const gridRows = Math.min(MAX, Math.max(MIN, hover.r + 2));
  const gridCols = Math.min(MAX, Math.max(MIN, hover.c + 2));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "Enter") { e.preventDefault(); onSelect(hover.r + 1, hover.c + 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setHover((h) => ({ ...h, c: Math.min(MAX - 1, h.c + 1) })); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setHover((h) => ({ ...h, c: Math.max(0, h.c - 1) })); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setHover((h) => ({ ...h, r: Math.min(MAX - 1, h.r + 1) })); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHover((h) => ({ ...h, r: Math.max(0, h.r - 1) })); }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [hover, onClose, onSelect]);

  // Keep the popover inside the viewport.
  const width = gridCols * (CELL + GAP) + 20;
  const height = gridRows * (CELL + GAP) + 56;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 12));
  const top = Math.max(8, Math.min(y + 6, window.innerHeight - height - 12));

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("editor.tablePickerTitle", { defaultValue: "Choose table size" })}
      style={{
        position: "fixed",
        left,
        top,
        background: "var(--bg-primary)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-2)",
        padding: "10px",
        zIndex: "var(--z-menu)",
        userSelect: "none",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${gridCols}, ${CELL}px)`, gap: `${GAP}px` }}>
        {Array.from({ length: gridRows }).map((_, r) =>
          Array.from({ length: gridCols }).map((_, c) => {
            const active = r <= hover.r && c <= hover.c;
            return (
              <div
                key={`${r}-${c}`}
                onMouseEnter={() => setHover({ r, c })}
                onMouseDown={(e) => { e.preventDefault(); onSelect(r + 1, c + 1); }}
                style={{
                  width: CELL,
                  height: CELL,
                  borderRadius: "var(--radius-xs)",
                  cursor: "pointer",
                  border: `1px solid ${active ? "var(--accent-color)" : "var(--border-color)"}`,
                  background: active ? "var(--bg-active)" : "var(--bg-secondary)",
                }}
              />
            );
          }),
        )}
      </div>
      <div style={{ marginTop: "8px", textAlign: "center", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
        {t("editor.tablePickerLabel", { rows: hover.r + 1, cols: hover.c + 1, defaultValue: "{{rows}} × {{cols}}" })}
      </div>
    </div>
  );
};
