import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { ACCENT_PALETTE as PALETTE } from "./palette";
import { ICON } from "@plainva/ui";

export interface HeaderColorPickerProps {
  x: number;
  y: number;
  /** Currently set color (enables the remove action and preselects the custom input). */
  value?: string;
  onSelect: (color: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Popover to pick the document header color: palette + free color + remove. */
export const HeaderColorPicker: React.FC<HeaderColorPickerProps> = ({
  x,
  y,
  value,
  onSelect,
  onRemove,
  onClose,
}) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  // Custom color is staged locally and applied via OK — the native color input
  // fires change events while picking, and applying directly would close the
  // popover on the very first click in the OS dialog.
  const [custom, setCustom] = useState(
    value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#2f6f6f"
  );

  // Keep the popover inside the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + rect.width > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - rect.width - 8);
    if (ny + rect.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - rect.height - 8);
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Invisible full-viewport click-catcher (dismiss on outside click). No
          shared class provides a bare, non-dimmed fixed overlay without
          touching styles/ui.css — position:fixed stays inline here. */}
      <div
        className="pv-click-catch"
        style={{ zIndex: "var(--z-menu)" }}
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-label={t("colorPicker.title")}
        className="pv-popover pv-popover--fixed"
        style={{
          left: pos.x,
          top: pos.y,
          padding: "0.6rem",
          width: "228px",
          visibility: "visible",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px" }}>
          {PALETTE.map((color) => (
            <button
              key={color}
              onClick={() => onSelect(color)}
              data-tip={color}
              aria-label={color}
              style={{
                width: "36px",
                height: "28px",
                borderRadius: "var(--radius-sm)",
                border:
                  value?.toLowerCase() === color
                    ? "2px solid var(--accent-color)"
                    : "1px solid var(--border-color)",
                background: color,
                cursor: "pointer",
              }}
            />
          ))}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginTop: "0.6rem",
            fontSize: "var(--text-ui)",
            color: "var(--text-muted)",
          }}
        >
          <input
            type="color"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-label={t("colorPicker.custom")}
            style={{ width: "36px", height: "28px", padding: 0, border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", background: "transparent", cursor: "pointer" }}
          />
          <span style={{ flex: 1 }}>{t("colorPicker.custom")}</span>
          <button
            onClick={() => onSelect(custom)}
            className="pv-btn pv-btn--primary"
          >
            {t("colorPicker.apply")}
          </button>
        </div>
        {value && (
          <button
            onClick={onRemove}
            className="pv-btn pv-btn--ghost"
            style={{ width: "100%", marginTop: "0.6rem" }}
          >
            <Trash2 size={ICON.ui} />
            {t("colorPicker.remove")}
          </button>
        )}
      </div>
    </>
  );
};
