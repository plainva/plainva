// Icon rendering for the editor's `/` command menu.
//
// Icons are built as plain DOM (CodeMirror renders completion options outside of
// React) and follow the app theme through `currentColor`, so they adapt to
// light/dark automatically. Two visual styles are used, matching Notion:
//   - line icons (Lucide-style SVGs) for blocks and media
//   - typographic badges ("H1"…"H6", "B", "I", "S") for headings and inline
//     emphasis, which read instantly in an editor context.
//
// The matching CSS lives in MarkdownTheme.ts (`.plainva-slash-icon`,
// `.plainva-slash-badge`, `.plainva-slash-desc`).

import { calloutColor, calloutIconPath } from "./callouts";

const SVG_NS = "http://www.w3.org/2000/svg";

// Build a 24x24 Lucide-style stroke icon from its inner path markup.
function svg(inner: string): SVGElement {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", "2");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  el.setAttribute("aria-hidden", "true");
  // Static, trusted markup only (constants below) — no user input.
  el.innerHTML = inner;
  return el;
}

// Build a typographic badge (e.g. "H1", "B"). `modifier` toggles italic/strike.
function badge(text: string, modifier?: string): HTMLElement {
  const span = document.createElement("span");
  span.className = modifier ? `plainva-slash-badge ${modifier}` : "plainva-slash-badge";
  span.textContent = text;
  return span;
}

// type (= slash command key) -> icon factory.
const ICONS: Record<string, () => Node> = {
  // --- Basics ---
  text: () => svg('<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>'),
  h1: () => badge("H1"),
  h2: () => badge("H2"),
  h3: () => badge("H3"),
  h4: () => badge("H4"),
  h5: () => badge("H5"),
  h6: () => badge("H6"),
  ul: () =>
    svg(
      '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
    ),
  ol: () =>
    svg(
      '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
    ),
  task: () =>
    svg(
      '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    ),
  quote: () => svg('<path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/><path d="M3 12v6"/>'),
  callout: () => svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  code: () =>
    svg(
      '<path d="m10 9.5-2 2.5 2 2.5"/><path d="m14 9.5 2 2.5-2 2.5"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
    ),
  table: () =>
    svg(
      '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
    ),
  hr: () => svg('<path d="M5 12h14"/>'),
  // Math (Part 2): lucide "sigma" — the summation sign for a LaTeX formula.
  math: () => svg('<path d="M18 7V4H6l6 8-6 8h12v-3"/>'),
  // Mermaid (Part 2): lucide "workflow" — a flow of connected nodes.
  mermaid: () =>
    svg(
      '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
    ),
  // --- Inline formatting ---
  bold: () => badge("B"),
  italic: () => badge("I", "plainva-slash-badge-italic"),
  strike: () => badge("S", "plainva-slash-badge-strike"),
  inlinecode: () => svg('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>'),
  highlight: () =>
    svg(
      '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    ),
  // Footnote (P3.6): lucide "superscript" — a raised reference mark.
  footnote: () =>
    svg(
      '<path d="m4 19 8-8"/><path d="m12 19-8-8"/><path d="M20 12h-4c0-1.5.442-2 1.5-2.5 1.11-.523 2.5-1.06 2.5-2.5a2.5 2.5 0 0 0-2.5-2.5c-1.14 0-2.06.674-2.4 1.6"/>',
    ),
  // --- Links & media ---
  link: () =>
    svg(
      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    ),
  wikilink: () =>
    svg(
      '<path d="M4 8V4a2 2 0 0 1 2-2h8.5L20 7.5V20a2 2 0 0 1-2 2h-5.5"/><polyline points="14 2 14 8 20 8"/><path d="m8 16 3-3-3-3"/><path d="M2 13h7"/>',
    ),
  image: () =>
    svg(
      '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    ),
  internalimage: () =>
    svg(
      '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    ),
  embed: () =>
    svg(
      '<path d="M18 22H4a2 2 0 0 1-2-2V6"/><path d="m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18"/><circle cx="12" cy="8" r="2"/><rect width="16" height="16" x="6" y="2" rx="2"/>',
    ),
  // --- @ mention menu / .base embeds ---
  date: () =>
    svg(
      '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    ),
  base: () => dbIcon(),
  embedbase: () => dbIcon(),
  newbase: () => dbIcon(),
  // --- Document-level presentation (W3): lucide smile / paintbrush ---
  icon: () =>
    svg('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>'),
  // Emoji insertion into text (/emoji + :name): lucide "smile".
  emoji: () =>
    svg('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>'),
  headercolor: () =>
    svg('<path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/>'),
  tag: () =>
    svg('<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>'),
};

// Database cylinder (shared by base / embedbase / newbase).
function dbIcon(): SVGElement {
  return svg('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>');
}

// Render the icon box for a given command type (falls back to the text icon).
// Callout variants ("callout-<type>") use the shared callout icon (callouts.ts)
// tinted with the callout's own semantic colour, mirroring Obsidian.
export function renderSlashIcon(type: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "plainva-slash-icon";
  if (type.startsWith("callout-")) {
    const calloutType = type.slice("callout-".length);
    const icon = svg(calloutIconPath(calloutType));
    icon.style.color = calloutColor(calloutType);
    box.appendChild(icon);
    return box;
  }
  box.appendChild((ICONS[type] ?? ICONS.text)());
  return box;
}

// Render the secondary description line, or null when there is none.
export function renderSlashDescription(description?: string): HTMLElement | null {
  if (!description) return null;
  const el = document.createElement("div");
  el.className = "plainva-slash-desc";
  el.textContent = description;
  return el;
}
