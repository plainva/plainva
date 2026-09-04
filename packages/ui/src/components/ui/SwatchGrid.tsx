import { type CSSProperties } from "react";
import { cx } from "./cx";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface SwatchProps {
  /** The colour the disc shows — DATA, painted inline. */
  color: string;
  active?: boolean;
  /** Accessible name; defaults to the hex. */
  label?: string;
  /** Without a handler the disc is a plain, non-interactive swatch. */
  onClick?: () => void;
  className?: string;
  testId?: string;
}

/**
 * One colour disc (plan "Farbwahl überall", 2026-09-04): a `--control-md`
 * circle with a hairline, the pick an outline ring on `--text-main`. Also the
 * toolbar affordance of the image editor, where the current pen colour is a
 * disc that opens the grid.
 */
export function Swatch({ color, active, label, onClick, className, testId }: SwatchProps) {
  const name = label ?? color;
  if (!onClick) {
    return <span aria-hidden="true" data-tip={name} className={cx("pv-swatch", "pv-swatch--static", className)} style={{ background: color }} />;
  }
  return (
    <button
      type="button"
      className={cx("pv-swatch", active && "is-on", className)}
      aria-label={name}
      aria-pressed={!!active}
      data-tip={name}
      data-testid={testId}
      onClick={onClick}
      style={{ background: color }}
    />
  );
}

export interface SwatchGridNone {
  label: string;
  active: boolean;
  onPick: () => void;
  /** "letter" shows an A (default tint); "slash" a struck disc (no own colour). */
  glyph?: "letter" | "slash";
  testId?: string;
}

export interface SwatchGridFree {
  label: string;
  onChange: (hex: string) => void;
  testId?: string;
}

export interface SwatchGridProps {
  presets: readonly string[];
  /** The current colour; compared case-insensitively. */
  value?: string | null;
  onPick?: (hex: string) => void;
  /** Fixed slots per row: 8 on settings pages, 6 in popovers. */
  columns?: number;
  /** An optional first slot for "no own colour" / "default". */
  none?: SwatchGridNone;
  /** An optional last slot: the free colour, a disc with a hue ring. */
  free?: SwatchGridFree;
  /** Plain discs, nothing to pick (the derived text colours of a theme). */
  readOnly?: boolean;
  /** `data-testid` per preset: `${prefix}${hex}`. */
  testIdPrefix?: string;
  ariaLabel?: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * THE colour choice of the app (plan "Farbwahl überall", 2026-09-04): discs
 * in fixed slots, so rows line up in columns whatever their count; the pick
 * is a ring, never a check glyph (it vanished on white); the free colour is
 * the last slot, a disc like the others wearing a hue ring, with the native
 * colour input invisible on top so the OS picker opens from the disc. The
 * free disc carries the ring whenever the value is none of the presets — the
 * ring always sits somewhere. Grew out of the "My theme" page, where the
 * swatches had been a wrapping flex row with a rectangle among the discs.
 */
export function SwatchGrid({
  presets,
  value,
  onPick,
  columns = 8,
  none,
  free,
  readOnly,
  testIdPrefix,
  ariaLabel,
  className,
  "data-testid": testId,
}: SwatchGridProps) {
  const current = value ? value.toLowerCase() : "";
  const isPreset = presets.some((p) => p.toLowerCase() === current);
  const freeActive = !!free && !!current && !isPreset && !none?.active;
  // The native input needs a six-digit hex; anything else falls back to the
  // first preset, so the disc never shows a colour the input cannot hold.
  const freeValue = value && HEX6.test(value) ? value : (presets[0] ?? "");
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      className={cx("pv-swatches", className)}
      style={{ "--swatch-cols": columns } as CSSProperties}
    >
      {none && (
        <button
          type="button"
          className={cx("pv-swatch", "pv-swatch--none", none.glyph === "slash" && "pv-swatch--none-slash", none.active && "is-on")}
          aria-label={none.label}
          aria-pressed={none.active}
          data-tip={none.label}
          data-testid={none.testId}
          onClick={none.onPick}
        >
          {none.glyph === "slash" ? null : "A"}
        </button>
      )}
      {presets.map((hex) => (
        <Swatch
          key={hex}
          color={hex}
          active={!none?.active && hex.toLowerCase() === current}
          onClick={readOnly ? undefined : () => onPick?.(hex)}
          testId={testIdPrefix ? `${testIdPrefix}${hex}` : undefined}
        />
      ))}
      {free && (
        <label
          className={cx("pv-swatch", "pv-swatch--free", freeActive && "is-on")}
          data-tip={free.label}
          data-testid={free.testId}
          style={{ "--swatch": freeValue } as CSSProperties}
        >
          <input type="color" aria-label={free.label} value={freeValue} onChange={(e) => free.onChange(e.target.value)} />
        </label>
      )}
    </div>
  );
}
