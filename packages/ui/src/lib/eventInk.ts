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
 * theme's ground first. Where one ink does not read on all of them, the
 * theme's own text does ("text"), on a fill shown as faint as it needs:
 * at least 4.5:1 on every ground (review O7, second round).
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
const INK_LUMINANCE = { light: LIGHT_INK, dark: DARK_INK } as const;
/**
 * The grounds a translucent fill lies on, and the theme's own text on them: `--bg-primary`, `--bg-secondary` and
 * `--text-main` of the light and of the dark theme (`base-colors.css`).
 */
const THEMES: readonly { grounds: readonly (readonly number[])[]; text: number }[] = [
  { grounds: [[0xff, 0xff, 0xff], [0xef, 0xf5, 0xf4]], text: luminance([0x1b, 0x2b, 0x29]) },
  { grounds: [[0x0f, 0x1c, 0x1b], [0x15, 0x26, 0x25]], text: luminance([0xd7, 0xe4, 0xe2]) },
];
/** What the text on an appointment reaches at least on a translucent fill (WCAG AA for normal text, review O7, F31). */
const MIN_CONTRAST = 4.5;

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const over = (rgba: Rgba, ground: readonly number[], alpha = rgba[3]) => ground.map((g, i) => rgba[i]! * alpha + g * (1 - alpha));

function inkOn(rgb: readonly number[]): "light" | "dark" {
  const l = luminance(rgb);
  return contrast(LIGHT_INK, l) >= contrast(l, DARK_INK) ? "light" : "dark";
}

/** The ink and, for a translucent fill that had to give way, the strength it is shown at. */
interface Surface {
  ink: EventInk;
  /** Present where the fill is shown fainter than given: its alpha, so the theme's text reads on it. */
  alpha?: number;
}

function surface(fill: string): Surface | null {
  const rgba = channels(fill);
  if (!rgba) return null;
  if (rgba[3] >= 1) return { ink: inkOn(rgba) };
  // A translucent fill is what it shows over each theme's ground (review O7, A1): one ink only where it reads on all
  // of them.
  const all = THEMES.flatMap((theme) => theme.grounds.map((ground) => over(rgba, ground)));
  const ink = inkOn(over(rgba, THEMES[0]!.grounds[0]!));
  if (all.every((rgb) => contrast(luminance(rgb), INK_LUMINANCE[ink]) >= MIN_CONTRAST)) return { ink };
  // Otherwise the theme's own text, and the fill as faint as that text needs it (review O7, second round): a grey
  // half over white read 3.4:1 with the light theme's text.
  const reads = (alpha: number) => THEMES.every((theme) => theme.grounds.every((ground) => contrast(luminance(over(rgba, ground, alpha)), theme.text) >= MIN_CONTRAST));
  if (reads(rgba[3])) return { ink: "text" };
  let low = 0;
  let high = rgba[3];
  for (let step = 0; step < 12; step++) {
    const mid = (low + high) / 2;
    if (reads(mid)) low = mid;
    else high = mid;
  }
  return { ink: "text", alpha: Math.floor(low * 100) / 100 };
}

/** Which ink reads on a fill; null where the fill is no literal colour (then the accent pair holds). */
export function eventInk(fill: string): EventInk | null {
  return surface(fill)?.ink ?? null;
}

const INK_VAR: Record<EventInk, string> = { light: "var(--evt-ink-light)", dark: "var(--evt-ink-dark)", text: "var(--text-main)" };
/**
 * What the hatch of a tentative appointment mixes into its second stripe (review O7, A2): away from the ink, so the
 * stripe never reads worse than the solid fill — darker under light ink, lighter under dark ink, the ground under the
 * theme's own text.
 */
const HATCH_VAR: Record<EventInk, string> = { light: "var(--evt-hatch-light-ink)", dark: "var(--evt-hatch-dark-ink)", text: "var(--bg-primary)" };

/** The custom properties an appointment's surface carries: its calendar's colour, the fill and the ink that reads on it, and its hatch. */
export function eventColorVars(fill: string): CSSProperties {
  const shown = surface(fill);
  const rgba = shown?.alpha !== undefined ? channels(fill) : null;
  // `--evt-color` stays the calendar's colour: a pill's text, an outline and a dot are drawn in it. Only the fill the
  // chosen ink stands on is shown fainter where it has to be (review O7, third round).
  return {
    ["--evt-color" as string]: fill,
    ...(rgba ? { ["--evt-fill" as string]: `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${shown!.alpha})` } : {}),
    ...(shown ? { ["--evt-ink" as string]: INK_VAR[shown.ink], ["--evt-hatch" as string]: HATCH_VAR[shown.ink] } : {}),
  } as CSSProperties;
}
