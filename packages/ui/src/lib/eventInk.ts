import type { CSSProperties } from "react";

/**
 * The text on an appointment's surface (plan Oberfläche O7, D15). The fill is
 * the calendar's own colour — data, from Google, Microsoft, iCloud or the
 * user —, so the theme cannot know which text reads on it: white stood on
 * a light turquoise, and the dark theme's accent ink on a dark one. The ink
 * is the one of the two that contrasts more with the fill (WCAG relative
 * luminance). Where the fill is the app's accent (no colour of its own, or a
 * colour that is no literal), the accent pair holds: `--accent-on`.
 */
export type EventInk = "light" | "dark";

function channels(color: string): [number, number, number] | null {
  const c = color.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1]![i]! + m![1]![i]!, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(c);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => Math.min(255, v)) as [number, number, number];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The relative luminance of the two inks (`--evt-ink-light` #ffffff, `--evt-ink-dark` #10201e in `tokens.css`). */
const LIGHT_INK = 1;
const DARK_INK = luminance([0x10, 0x20, 0x1e]);

/** Which ink reads on a fill; null where the fill is no literal colour (then the accent pair holds). */
export function eventInk(fill: string): EventInk | null {
  const rgb = channels(fill);
  if (!rgb) return null;
  const l = luminance(rgb);
  const onLight = (LIGHT_INK + 0.05) / (l + 0.05);
  const onDark = (l + 0.05) / (DARK_INK + 0.05);
  return onLight >= onDark ? "light" : "dark";
}

/** The custom properties an appointment's surface carries: its calendar's colour, and the ink that reads on it. */
export function eventColorVars(fill: string): CSSProperties {
  const ink = eventInk(fill);
  return { ["--evt-color" as string]: fill, ...(ink ? { ["--evt-ink" as string]: ink === "light" ? "var(--evt-ink-light)" : "var(--evt-ink-dark)" } : {}) } as CSSProperties;
}
