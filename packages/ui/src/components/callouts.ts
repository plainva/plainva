// Shared helpers for Obsidian-style callouts: > [!type] Title
// Used by both the read view (MarkdownReader) and the editor (LivePreviewPlugin).

const COLORS: Record<string, string> = {
  blue: "#3a8ca6",
  green: "#3fae6a",
  amber: "#d9a23f",
  orange: "#d9883f",
  red: "#d64d4d",
  purple: "#9d6ddb",
  gray: "#8a8a8a",
  cyan: "#2fa39a",
};

const TYPE_TO_COLORKEY: Record<string, keyof typeof COLORS> = {
  note: "blue", info: "blue", todo: "blue",
  tip: "green", hint: "green", important: "green", success: "green", check: "green", done: "green",
  question: "orange", help: "orange", faq: "orange",
  warning: "amber", caution: "amber", attention: "amber",
  failure: "red", fail: "red", missing: "red", danger: "red", error: "red", bug: "red",
  example: "purple",
  quote: "gray", cite: "gray",
  abstract: "cyan", summary: "cyan", tldr: "cyan",
};

// Lucide-style icon markup (inner SVG, 24x24, currentColor) per canonical
// callout type. Single source shared by the slash menu (SlashCommandIcons) and
// the callout header in both the editor (LivePreviewPlugin) and read view.
const CALLOUT_ICON_PATHS: Record<string, string> = {
  note: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  todo: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  abstract:
    '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  tip: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  success: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  warning:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  failure: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  danger:
    '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  example: '<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>',
  quote: '<path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/><path d="M3 12v6"/>',
};

// Aliases -> canonical icon key (mirrors TYPE_TO_COLORKEY's alias groups).
const TYPE_TO_ICONKEY: Record<string, keyof typeof CALLOUT_ICON_PATHS> = {
  summary: "abstract", tldr: "abstract",
  hint: "tip", important: "tip",
  check: "success", done: "success",
  help: "question", faq: "question",
  caution: "warning", attention: "warning",
  fail: "failure", missing: "failure",
  error: "danger",
  cite: "quote",
};

/** Inner SVG markup for a callout type's icon (aliases resolved; default note). */
export function calloutIconPath(type: string): string {
  const t = type.toLowerCase();
  return CALLOUT_ICON_PATHS[t] || CALLOUT_ICON_PATHS[TYPE_TO_ICONKEY[t]] || CALLOUT_ICON_PATHS.note;
}

export type CalloutColorKey = keyof typeof COLORS;

export function calloutColorKey(type: string): CalloutColorKey {
  return TYPE_TO_COLORKEY[type.toLowerCase()] || "blue";
}

export function calloutColor(type: string): string {
  return colorForKey(calloutColorKey(type));
}

/** All color keys — used to generate the editor's callout CSS classes. */
export const CALLOUT_COLOR_KEYS = Object.keys(COLORS) as CalloutColorKey[];

// Callout colours are exposed as CSS variables (`--callout-<key>` /
// `--callout-<key>-tint`, defined in App.css) so a theme can override them via
// the `data-theme-name` axis — and the hard-coded hex above is the fallback. The
// returned `var(...)` string is valid wherever a CSS color is expected: inline
// `style.color`, the CodeMirror theme object, and React style props.
export function colorForKey(key: CalloutColorKey): string {
  return `var(--callout-${key}, ${COLORS[key]})`;
}

/** Faint background tint (~8% alpha) for a callout color. CSS variable + hex fallback. */
export function calloutTint(key: CalloutColorKey): string {
  return `var(--callout-${key}-tint, ${COLORS[key]}14)`;
}

export interface ParsedCallout {
  type: string;
  title: string;
}

/**
 * Parses a callout marker from a single line (already stripped of the leading
 * "> " quote markers). Returns null if the line is not a callout header.
 * Examples: "[!info]", "[!warning]- Collapsed", "[!tip] My title".
 */
export function parseCalloutMarker(line: string): ParsedCallout | null {
  const m = line.match(/^\s*\[!([A-Za-z]+)\][+-]?\s*(.*)$/);
  if (!m) return null;
  return { type: m[1].toLowerCase(), title: m[2].trim() };
}
