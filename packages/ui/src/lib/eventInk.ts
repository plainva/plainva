import type { CSSProperties } from "react";

/**
 * The text on an appointment's surface (plan Oberfläche O7, D15). The fill is
 * the calendar's own colour — data, from Google, Microsoft, iCloud or the
 * user —, so the theme cannot know which text reads on it: white stood on
 * a light turquoise, and the dark theme's accent ink on a dark one. The ink
 * is the one of the two that contrasts more with the fill (WCAG relative
 * luminance). Where the fill is the app's accent (no colour of its own, or a
 * colour that is no literal), the accent pair holds: `--accent-on`.
 *
 * A colour with an alpha (`rgba(0,0,0,0.1)`, `#00000000`) is what it shows
 * over the ground (review O7, A1): it is laid over the light and the dark
 * theme's ground first. Where the two call for different inks, the fill is
 * close to the ground, and the theme's own text reads on it ("text").
 */
export type EventInk = "light" | "dark" | "text";

type Rgba = [number, number, number, number];

function channels(color: string): Rgba | null {
  const c = color.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(c);
  if (m) {
    const [r, g, b, a = "f"] = [...m[1]!];
    return [r!, g!, b!, a].map((x) => parseInt(x + x, 16)).map((v, i) => (i === 3 ? v / 255 : v)) as Rgba;
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(c);
  if (m) return [...[0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)), m[2] ? parseInt(m[2], 16) / 255 : 1] as Rgba;
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/.exec(c);
  if (m) {
    const alpha = m[4] === undefined ? 1 : Math.min(1, Number(m[4]) / (m[5] ? 100 : 1));
    return [...[m[1], m[2], m[3]].map((v) => Math.min(255, Number(v))), Number.isFinite(alpha) ? alpha : 1] as Rgba;
  }
  return null;
}

function luminance([r, g, b]: readonly number[]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}

/** The relative luminance of the two inks (`--evt-ink-light` #ffffff, `--evt-ink-dark` #10201e in `tokens.css`). */
const LIGHT_INK = 1;
const DARK_INK = luminance([0x10, 0x20, 0x1e]);
/** The grounds a translucent fill lies on: `--bg-primary` of the light and of the dark theme (`base-colors.css`). */
const GROUNDS: readonly (readonly number[])[] = [
  [0xff, 0xff, 0xff],
  [0x0f, 0x1c, 0x1b],
];

function inkOn(rgb: readonly number[]): "light" | "dark" {
  const l = luminance(rgb);
  const onLight = (LIGHT_INK + 0.05) / (l + 0.05);
  const onDark = (l + 0.05) / (DARK_INK + 0.05);
  return onLight >= onDark ? "light" : "dark";
}

/** Which ink reads on a fill; null where the fill is no literal colour (then the accent pair holds). */
export function eventInk(fill: string): EventInk | null {
  const rgba = channels(fill);
  if (!rgba) return null;
  const alpha = rgba[3];
  if (alpha >= 1) return inkOn(rgba);
  const inks = GROUNDS.map((ground) => inkOn(ground.map((g, i) => rgba[i]! * alpha + g * (1 - alpha))));
  return inks[0] === inks[1] ? inks[0]! : "text";
}

const INK_VAR: Record<EventInk, string> = { light: "var(--evt-ink-light)", dark: "var(--evt-ink-dark)", text: "var(--text-main)" };
/**
 * What the hatch of a tentative appointment mixes into its second stripe (review O7, A2): away from the ink, so the
 * stripe never reads worse than the solid fill — darker under light ink, lighter under dark ink, the ground under the
 * theme's own text.
 */
const HATCH_VAR: Record<EventInk, string> = { light: "var(--evt-hatch-light-ink)", dark: "var(--evt-hatch-dark-ink)", text: "var(--bg-primary)" };

/** The custom properties an appointment's surface carries: its calendar's colour, the ink that reads on it, and its hatch. */
export function eventColorVars(fill: string): CSSProperties {
  const ink = eventInk(fill);
  return { ["--evt-color" as string]: fill, ...(ink ? { ["--evt-ink" as string]: INK_VAR[ink], ["--evt-hatch" as string]: HATCH_VAR[ink] } : {}) } as CSSProperties;
}
