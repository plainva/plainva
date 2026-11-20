/**
 * Colours as a mail's inline styles and attributes write them, and how two of
 * them read against each other — for the walk that reads what the mail reader
 * shows (`htmlVisibleText.ts`) and the sanitizer's list of kept styles
 * (`mailStyle.ts`). Text in the colour of what lies behind it is on screen and
 * still nobody sees it (review of 2026-11-17).
 */

/** Red, green and blue from 0 to 255, alpha from 0 to 1. */
export type Rgba = readonly [number, number, number, number];

/** The CSS colour names and their values (CSS Color 4; read off Chromium, 2026-11-17). */
const NAMED_SOURCE =
  "aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue  " +
  "0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed  " +
  "cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9  " +
  "darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f  " +
  "darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray  " +
  "696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold  " +
  "ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory  " +
  "fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff  " +
  "lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue  " +
  "87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff  " +
  "maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee  " +
  "mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5  " +
  "navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa  " +
  "palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6  " +
  "purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57  " +
  "seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f  " +
  "steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5  " +
  "yellow ffff00 yellowgreen 9acd32";

const NAMED = new Map<string, Rgba>();
{
  const words = NAMED_SOURCE.trim().split(/\s+/);
  for (let index = 0; index + 1 < words.length; index += 2) NAMED.set(words[index], hexColour(words[index + 1])!);
}

function hexColour(hex: string): Rgba | null {
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(hex)) return null;
  const long = hex.length <= 4 ? Array.from(hex, (c) => c + c).join("") : hex;
  const channel = (at: number) => parseInt(long.slice(at, at + 2), 16);
  return [channel(0), channel(2), channel(4), long.length === 8 ? channel(6) / 255 : 1];
}

const NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

/** A number or a percentage of `whole`, clamped to 0..whole; null for anything else. */
function amount(token: string, whole: number): number | null {
  const percent = token.endsWith("%");
  const digits = percent ? token.slice(0, -1) : token;
  if (!NUMBER.test(digits)) return null;
  const value = percent ? (parseFloat(digits) / 100) * whole : parseFloat(digits);
  return Math.min(whole, Math.max(0, value));
}

/** The arguments of a colour function: three, and an alpha after a comma or a slash. */
function colourArguments(inner: string): { values: string[]; alpha: string | null } | null {
  const slash = inner.split("/");
  if (slash.length > 2) return null;
  const values = slash[0].split(/[\s,]+/).filter(Boolean);
  if (slash.length === 2) {
    const alpha = slash[1].trim();
    return values.length === 3 && alpha && !/[\s,]/.test(alpha) ? { values, alpha } : null;
  }
  if (values.length === 4) return { values: values.slice(0, 3), alpha: values[3] };
  return values.length === 3 ? { values, alpha: null } : null;
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * A colour as a style writes it, in lower case: a name, `transparent`, `#rgb`
 * to `#rrggbbaa`, `rgb()`/`rgba()` and `hsl()`/`hsla()` with commas or blanks
 * and an alpha after a slash. `null` for anything else — a system colour,
 * `currentcolor`, a variable — which hangs on something the walk cannot know.
 */
export function readColour(token: string): Rgba | null {
  if (token === "transparent") return [0, 0, 0, 0];
  if (token.startsWith("#")) return hexColour(token.slice(1));
  const named = NAMED.get(token);
  if (named) return named;
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(token);
  if (!fn) return null;
  const args = colourArguments(fn[2]);
  if (!args) return null;
  const alpha = args.alpha === null ? 1 : amount(args.alpha, 1);
  if (alpha === null) return null;
  if (fn[1].startsWith("rgb")) {
    const channels = args.values.map((value) => amount(value, 255));
    if (channels.some((value) => value === null)) return null;
    return [channels[0]!, channels[1]!, channels[2]!, alpha];
  }
  const hue = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(deg)?$/.exec(args.values[0]);
  const saturation = amount(args.values[1], 1);
  const lightness = amount(args.values[2], 1);
  if (!hue || saturation === null || lightness === null || !args.values[1].endsWith("%") || !args.values[2].endsWith("%")) return null;
  const [r, g, b] = hslToRgb(parseFloat(hue[1]), saturation, lightness);
  return [r, g, b, alpha];
}

/** The whitespace of the HTML standard. */
const ASCII_SPACE = "\t\n\f\r ";

/**
 * A colour as an attribute (`bgcolor`, `<font color>`) writes it, read by the
 * HTML standard's rules for parsing a legacy colour value — the colour a
 * browser shows, never another: `fff` is not white there but rgb(15, 15, 15),
 * `chucknorris` is a red. `null` for no colour (empty, `transparent`).
 */
export function readAttributeColour(value: string): Rgba | null {
  // Trimmed of ASCII whitespace only (not `trim()`, which also takes other spaces).
  let start = 0;
  let end = value.length;
  while (start < end && ASCII_SPACE.includes(value[start])) start++;
  while (end > start && ASCII_SPACE.includes(value[end - 1])) end--;
  let input = value.slice(start, end);
  if (input === "" || input.toLowerCase() === "transparent") return null;
  const named = NAMED.get(input.toLowerCase());
  if (named) return named;
  if (/^#[0-9a-f]{3}$/i.test(input)) return hexColour(input.slice(1));
  // Characters beyond the basic plane count as two zeros; at most 128 are read.
  input = Array.from(input, (c) => (c.codePointAt(0)! > 0xffff ? "00" : c)).join("").slice(0, 128);
  if (input.startsWith("#")) input = input.slice(1);
  input = input.replace(/[^0-9a-f]/gi, "0");
  while (input.length === 0 || input.length % 3 !== 0) input += "0";
  let length = input.length / 3;
  let parts = [input.slice(0, length), input.slice(length, 2 * length), input.slice(2 * length)];
  if (length > 8) {
    parts = parts.map((part) => part.slice(length - 8));
    length = 8;
  }
  while (length > 2 && parts.every((part) => part[0] === "0")) {
    parts = parts.map((part) => part.slice(1));
    length--;
  }
  if (length > 2) parts = parts.map((part) => part.slice(0, 2));
  const [r, g, b] = parts.map((part) => parseInt(part, 16));
  return [r, g, b, 1];
}

/** An opaque colour as `#rrggbb`. */
export function colourHex(colour: Rgba): string {
  return "#" + colour.slice(0, 3).map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("");
}

/** `top` painted over an opaque `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}

function luminance(colour: Rgba): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(colour[0]) + 0.7152 * linear(colour[1]) + 0.0722 * linear(colour[2]);
}

/** The contrast of two opaque colours (WCAG 2): 1 for the same colour, 21 for black on white. */
export function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Below this contrast to what lies behind it a text is not one a person sees.
 * Light grey on white (`#cccccc`, 1.6) is a footer somebody reads; `#eeeeee`
 * on white (1.16) is a word nobody does.
 */
export const MIN_CONTRAST = 1.3;
