import type { CSSProperties } from "react";
import { cx } from "@plainva/ui";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface MobileSwatchGridProps {
  presets: readonly string[];
  value?: string | null;
  onPick: (hex: string) => void;
  /** An optional first tile: "default" (letter A) or "no own colour" (slash). */
  none?: { label: string; active: boolean; onPick: () => void; glyph?: "letter" | "slash" };
  /** An optional last tile: the free colour, a tile with a hue ring. */
  free?: { label: string; onChange: (hex: string) => void };
  ariaLabel?: string;
}

/**
 * The phone's colour grid (plan "Farbwahl überall", 2026-09-04): the same
 * vocabulary as the desktop SwatchGrid in touch size — five tiles per row,
 * the pick a frame, the free colour the last tile wearing a hue ring with
 * the native colour input invisible on top. Replaces the separate "custom
 * colour" row under the grid, and brings the free colour to the icon tint,
 * which had only the palette (parity finding 2026-09-04).
 */
export function MobileSwatchGrid({ presets, value, onPick, none, free, ariaLabel }: MobileSwatchGridProps) {
  const current = value ? value.toLowerCase() : "";
  const isPreset = presets.some((p) => p.toLowerCase() === current);
  const freeActive = !!free && !!current && !isPreset && !none?.active;
  const freeValue = value && HEX6.test(value) ? value : (presets[0] ?? "");
  return (
    <div className="m-colorgrid" role="group" aria-label={ariaLabel}>
      {none && (
        <button
          aria-label={none.label}
          aria-pressed={none.active}
          className={cx("m-colorgrid-none", none.glyph === "slash" && "m-colorgrid-none--slash", none.active && "is-on")}
          onClick={none.onPick}
        >
          {none.glyph === "slash" ? null : "A"}
        </button>
      )}
      {presets.map((hex) => {
        const active = !none?.active && hex.toLowerCase() === current;
        return (
          <button
            aria-label={hex}
            aria-pressed={active}
            className={active ? "is-on" : undefined}
            key={hex}
            onClick={() => onPick(hex)}
            style={{ background: hex }}
          />
        );
      })}
      {free && (
        <label className={cx("m-colorgrid-free", freeActive && "is-on")} style={{ "--swatch": freeValue } as CSSProperties}>
          <input aria-label={free.label} onChange={(e) => free.onChange(e.target.value)} type="color" value={freeValue} />
        </label>
      )}
    </div>
  );
}
