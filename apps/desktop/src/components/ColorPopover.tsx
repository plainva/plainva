import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { ACCENT_PALETTE, Button, ICON, SwatchGrid } from "@plainva/ui";

export interface ColorPopoverProps {
  x: number;
  y: number;
  /** Currently set colour (enables the remove action and rings the disc). */
  value?: string | null;
  /** The tones offered; the curated accent palette by default. */
  presets?: readonly string[];
  /**
   * A tone applies AND closes (`close: true`); the free disc applies and stays
   * open (`close: false`) — the OS colour dialog fires change events while a
   * person is still picking, and closing on the first of them used to leave
   * the dialog without its popover. Callers decide what "close" means.
   */
  onSelect: (color: string, opts: { close: boolean }) => void;
  /** Present → a ghost "remove" row appears under the grid while a value is set. */
  onRemove?: () => void;
  onClose: () => void;
  testId?: string;
}

/**
 * The colour popover (plan "Farbwahl überall", 2026-09-04): the shared
 * SwatchGrid in six columns — ten tones plus the free disc make two rows —
 * with an optional remove action. Replaces the HeaderColorPicker (rectangles
 * plus an apply button that existed only for the free colour) and serves the
 * document header, the database icon, the pinboard card and the image pen.
 */
export const ColorPopover: React.FC<ColorPopoverProps> = ({ x, y, value, presets = ACCENT_PALETTE, onSelect, onRemove, onClose, testId }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  // The free disc shows what was just picked even while the document's
  // frontmatter (the `value` prop) is still catching up behind its debounce;
  // the popover unmounts on close, so the draft never outlives the pick.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

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
      {/* Invisible full-viewport click-catcher (dismiss on outside click). A
          change from the OS colour dialog is not a click here — the dialog is
          a native window — so the popover survives a free pick. */}
      <div className="pv-click-catch" style={{ zIndex: "var(--z-menu)" }} onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-label={t("colorPicker.title")}
        className="pv-popover pv-popover--fixed"
        data-testid={testId}
        style={{ left: pos.x, top: pos.y, padding: "var(--space-3)", visibility: "visible" }}
      >
        <SwatchGrid
          ariaLabel={t("colorPicker.title")}
          presets={presets}
          value={shown}
          columns={6}
          onPick={(hex) => onSelect(hex, { close: true })}
          free={{ label: t("colorPicker.custom"), onChange: (hex) => { setDraft(hex); onSelect(hex, { close: false }); } }}
        />
        {value && onRemove && (
          <Button variant="ghost" size="sm" icon={<Trash2 size={ICON.ui} />} onClick={onRemove} style={{ width: "100%", marginTop: "var(--space-3)" }}>
            {t("colorPicker.remove")}
          </Button>
        )}
      </div>
    </>
  );
};
