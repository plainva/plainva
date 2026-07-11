import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BlockAction, BlockTarget } from "@plainva/ui";

export type { BlockAction } from "@plainva/ui";

interface Props {
  x: number;
  y: number;
  onAction: (action: BlockAction) => void;
  onClose: () => void;
}

type Row =
  | { kind: "sep" }
  | { kind: "label"; text: string }
  | { kind: "item"; action: BlockAction; label: string; danger?: boolean };

const Btn: React.FC<{ row: Extract<Row, { kind: "item" }>; onAction: (a: BlockAction) => void }> = ({ row, onAction }) => {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onAction(row.action)}
      style={{
        display: "flex", alignItems: "center", width: "100%", textAlign: "left", gap: "8px",
        padding: "6px 12px", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", fontSize: "13px",
        background: hover ? "var(--bg-active)" : "transparent",
        color: row.danger ? "var(--error-text)" : "var(--text-main)",
      }}
    >
      {row.label}
    </button>
  );
};

// Notion-style block menu opened from a block's drag handle (#7): convert the
// block, duplicate / move / delete it. Mirrors TableContextMenu conventions
// (fixed position, outside-click / Escape close, theme variables, i18n).
export const BlockMenu: React.FC<Props> = ({ x, y, onAction, onClose }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);

  const turn = (target: BlockTarget, label: string): Row => ({ kind: "item", action: { kind: "turn", target }, label });
  const rows: Row[] = [
    { kind: "label", text: t("block.turnInto", { defaultValue: "Umwandeln in" }) },
    turn("paragraph", t("block.paragraph", { defaultValue: "Text" })),
    turn("h1", t("block.h1", { defaultValue: "Überschrift 1" })),
    turn("h2", t("block.h2", { defaultValue: "Überschrift 2" })),
    turn("h3", t("block.h3", { defaultValue: "Überschrift 3" })),
    turn("bullet", t("block.bullet", { defaultValue: "Aufzählung" })),
    turn("numbered", t("block.numbered", { defaultValue: "Nummerierte Liste" })),
    turn("task", t("block.task", { defaultValue: "Aufgabe" })),
    turn("quote", t("block.quote", { defaultValue: "Zitat" })),
    turn("code", t("block.code", { defaultValue: "Code-Block" })),
    { kind: "sep" },
    { kind: "item", action: { kind: "duplicate" }, label: t("block.duplicate", { defaultValue: "Duplizieren" }) },
    { kind: "item", action: { kind: "move-up" }, label: t("block.moveUp", { defaultValue: "Nach oben" }) },
    { kind: "item", action: { kind: "move-down" }, label: t("block.moveDown", { defaultValue: "Nach unten" }) },
    { kind: "sep" },
    { kind: "item", action: { kind: "delete" }, label: t("block.delete", { defaultValue: "Block löschen" }), danger: true },
  ];

  const WIDTH = 220;
  // Clamp against the MEASURED menu size, not a guessed constant: opened near
  // the bottom of the window the menu used to run off-screen (maintainer
  // report 2026-07-06). useLayoutEffect repositions before paint (no flicker).
  const [pos, setPos] = useState(() => ({
    left: Math.max(8, Math.min(x, window.innerWidth - WIDTH - 12)),
    top: Math.max(8, y),
  }));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 12)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y]);
  const { left, top } = pos;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t("block.menuTitle", { defaultValue: "Block-Aktionen" })}
      style={{
        position: "fixed", left, top, minWidth: `${WIDTH}px`, maxHeight: "70vh", overflowY: "auto",
        background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-2)", padding: "6px", zIndex: "var(--z-menu)", userSelect: "none",
      }}
    >
      {rows.map((r, i) =>
        r.kind === "sep" ? (
          <div key={`s${i}`} style={{ height: "1px", background: "var(--border-color)", margin: "5px 6px" }} />
        ) : r.kind === "label" ? (
          <div key={`l${i}`} style={{ padding: "4px 12px 2px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-faint)" }}>{r.text}</div>
        ) : (
          <Btn key={`i${i}`} row={r} onAction={onAction} />
        ),
      )}
    </div>
  );
};
