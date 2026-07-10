import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { HEADING_SIZES } from "../lib/typography";
import { Prec } from "@codemirror/state";
import { CALLOUT_COLOR_KEYS, colorForKey, calloutTint } from "./callouts";

// Callout left-border + tint colors (Obsidian > [!type]), generated from the
// single source of truth in callouts.ts so editor and read view never drift.
const calloutThemeRules = Object.fromEntries(
  CALLOUT_COLOR_KEYS.map((key) => [
    `.cm-callout-${key}`,
    { borderLeftColor: colorForKey(key), backgroundColor: calloutTint(key) },
  ]),
);

// Editor chrome (background, caret, selection, gutter, active line) and the
// classes our decoration plugin adds — all driven by CSS variables so the editor
// follows the app theme (light/dark) instead of a hardcoded "light" theme.
export const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-main)",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-content)",
    lineHeight: "1.6",
    overflow: "auto",
  },
  ".cm-content": {
    caretColor: "var(--text-main)",
    fontSize: "16px",
    // Breathing room so editor text doesn't stick to the surrounding panels
    // (live + source mode). See Phase 9 backlog block 1.
    padding: "0.75rem 1.5rem",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--text-main)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection-bg)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-secondary)",
    color: "var(--text-faint)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--active-line-bg)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--bg-hover)" },
  // Remove CodeMirror's always-on focus box; the keyboard focus ring still comes
  // from the global :focus-visible rule (App.css), so a mouse click shows no box
  // while Tab navigation keeps an indicator (#7 feedback).
  "&.cm-focused": { outline: "none" },
  // Block handles (#7): grips in an overlay anchored to the text column (see
  // blockHandles.ts), revealed on editor hover; position set via inline styles.
  ".cm-block-handle": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "1.6em",
    color: "var(--text-faint)",
    cursor: "grab",
    borderRadius: "var(--radius-xs)",
    opacity: 0,
    transition: "opacity 0.12s",
  },
  "&:hover .cm-block-handle": { opacity: 0.5 },
  ".cm-block-handle:hover": { opacity: 1, backgroundColor: "var(--bg-hover)" },
  // Markdown decoration classes (see LivePreviewPlugin)
  ".cm-frontmatter": {
    color: "var(--text-faint)",
  },
  ".cm-frontmatter *": {
    fontSize: "1em !important",
    fontWeight: "normal !important",
    color: "var(--text-faint) !important",
  },
  ".cm-blockquote-line": {
    borderLeft: "4px solid var(--quote-border)",
    paddingLeft: "10px",
  },
  // Callout left-border + tint colors, generated from callouts.ts (see top of file).
  ...calloutThemeRules,
  // Callout header (live mode): colored type icon + bold title / type name.
  ".cm-callout-icon": {
    display: "inline-flex",
    alignItems: "center",
    verticalAlign: "text-bottom",
    marginRight: "6px",
  },
  ".cm-callout-icon svg": {
    width: "1.1em",
    height: "1.1em",
  },
  ".cm-callout-label": { fontWeight: "600" },
  ".cm-callout-title": { fontWeight: "600" },
  ".cm-md-highlight": {
    backgroundColor: "var(--highlight-bg)",
    borderRadius: "2px",
  },
  // Revealed inline markup markers (notion style): kept subtle/dimmed (#3).
  ".cm-md-mark": {
    color: "var(--text-faint)",
    opacity: 0.7,
  },
  // Dynamic date chip (@YYYY-MM-DD rendered relatively, #4).
  ".cm-date-chip": {
    backgroundColor: "var(--bg-active)",
    color: "var(--accent-color)",
    borderRadius: "var(--radius-xs)",
    padding: "0 5px",
    fontSize: "0.92em",
    fontWeight: "500",
    whiteSpace: "nowrap",
  },
  ".cm-md-hr-line": {
    borderBottom: "2px solid var(--border-color)",
  },
  // Live-mode rendered GFM table (see LivePreviewPlugin tableField/TableWidget).
  ".cm-md-table-wrap": {
    padding: "4px 0",
    overflowX: "auto",
    cursor: "text",
  },
  ".cm-md-table": {
    borderCollapse: "collapse",
    width: "auto",
    fontSize: "0.95em",
  },
  ".cm-md-table th, .cm-md-table td": {
    border: "1px solid var(--border-color)",
    // Taller, more comfortable rows so a freshly inserted table looks right
    // immediately (requirement #9) instead of cramped single-line cells.
    padding: "var(--pad-cell)",
    minWidth: "90px",
    lineHeight: "1.6",
    verticalAlign: "top",
    color: "var(--text-main)",
  },
  ".cm-md-table th": {
    backgroundColor: "var(--bg-secondary)",
    fontWeight: "600",
  },
  ".cm-md-table tbody tr:nth-child(even)": {
    backgroundColor: "var(--active-line-bg)",
  },
  // Inline cell editing (TS3): a native <input> opens in place on click.
  ".cm-md-table-input": {
    width: "100%",
    boxSizing: "border-box",
    border: "none",
    outline: "2px solid var(--accent-color)",
    borderRadius: "var(--radius-xs)",
    background: "var(--bg-primary)",
    color: "var(--text-main)",
    font: "inherit",
    padding: "0 2px",
    margin: "0",
  },
  // Find & replace panel (#10) — theme the built-in CodeMirror search panel.
  ".cm-panels": {
    backgroundColor: "var(--bg-secondary)",
    color: "var(--text-main)",
    borderBottom: "1px solid var(--border-color)",
  },
  ".cm-panel.cm-search": {
    padding: "6px 8px",
    fontFamily: "var(--font-ui)",
  },
  ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": {
    fontFamily: "var(--font-ui)",
    fontSize: "12px",
  },
  ".cm-panel.cm-search input[type=text]": {
    background: "var(--bg-primary)",
    color: "var(--text-main)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-xs)",
    padding: "3px 6px",
  },
  ".cm-panel.cm-search button": {
    background: "var(--bg-primary)",
    color: "var(--text-main)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-xs)",
    padding: "2px 8px",
    cursor: "pointer",
  },
  ".cm-panel.cm-search button[name=close]": {
    color: "var(--text-muted)",
    border: "none",
    background: "transparent",
  },
  ".cm-searchMatch": { backgroundColor: "var(--highlight-bg)", borderRadius: "2px" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--selection-bg)", outline: "1px solid var(--accent-color)" },
  ".cm-selectionMatch": { backgroundColor: "var(--bg-active)" },
  ".cm-md-bullet": {
    color: "var(--text-main)",
    fontWeight: "bold",
    marginRight: "4px",
  },
  ".cm-md-task": {
    marginRight: "6px",
    verticalAlign: "middle",
    cursor: "pointer",
  },
  // --- Slash command menu ("/") — themed, Notion-style ---
  // The card. Overrides the generic .cm-tooltip border so it follows the theme.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-2)",
    padding: "4px",
    color: "var(--text-main)",
    fontFamily: "var(--font-family)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    maxHeight: "min(420px, 60vh)",
    minWidth: "300px",
    maxWidth: "min(440px, 92vw)",
    fontFamily: "var(--font-family)",
    fontSize: "14px",
  },
  // Section headers (Grundlagen / Text formatieren / …). Override CM defaults
  // (silver border, list marker, reduced opacity).
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    display: "block",
    padding: "10px 10px 4px",
    margin: 0,
    fontSize: "11px",
    fontWeight: "600",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-faint)",
    border: "none",
    opacity: 1,
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section:first-child": {
    paddingTop: "4px",
  },
  // Each command row. Flex-wrap lays out [icon | title | hint] on line 1 and the
  // description on line 2 (via `order` + a full-width basis on the description).
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: "10px",
    rowGap: 0,
    padding: "6px 8px",
    margin: "1px 0",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-main)",
    cursor: "pointer",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--bg-active) !important",
    color: "var(--text-main) !important",
  },
  // Icon box.
  ".cm-tooltip-autocomplete .plainva-slash-icon": {
    order: 0,
    flex: "0 0 28px",
    width: "28px",
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--border-color)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--bg-secondary)",
    color: "var(--text-muted)",
  },
  ".cm-tooltip-autocomplete li[aria-selected] .plainva-slash-icon": {
    color: "var(--accent-color)",
    borderColor: "var(--accent-color)",
  },
  ".cm-tooltip-autocomplete .plainva-slash-icon svg": {
    width: "16px",
    height: "16px",
  },
  ".cm-tooltip-autocomplete .plainva-slash-badge": {
    fontSize: "11px",
    fontWeight: "700",
    lineHeight: 1,
    letterSpacing: "-0.02em",
  },
  ".cm-tooltip-autocomplete .plainva-slash-badge-italic": {
    fontStyle: "italic",
    fontFamily: "Georgia, 'Times New Roman', serif",
  },
  ".cm-tooltip-autocomplete .plainva-slash-badge-strike": {
    textDecoration: "line-through",
  },
  // Title.
  ".cm-tooltip-autocomplete .cm-completionLabel": {
    order: 1,
    flex: "1 1 auto",
    minWidth: 0,
    fontWeight: "500",
    color: "var(--text-main)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  // Right-aligned Markdown-syntax hint.
  ".cm-tooltip-autocomplete .cm-completionDetail": {
    order: 2,
    marginLeft: "auto",
    flexShrink: 0,
    paddingLeft: "8px",
    fontStyle: "normal",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    fontSize: "11.5px",
    color: "var(--text-faint)",
  },
  // Second-line description, indented to sit under the title.
  ".cm-tooltip-autocomplete .plainva-slash-desc": {
    order: 3,
    flexBasis: "100%",
    width: "100%",
    paddingLeft: "38px",
    fontSize: "12px",
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

// Base theme for header sizing (kept for parsers that emit .cm-header* classes).
export const markdownBaseTheme = EditorView.baseTheme({
  ".cm-line": { padding: "0 2px" },
  ".cm-header": { fontWeight: "bold" },
  ".cm-header-1": { fontSize: "2em" },
  ".cm-header-2": { fontSize: "1.5em" },
  ".cm-header-3": { fontSize: "1.17em" },
  ".cm-header-4": { fontSize: "1em" },
  ".cm-header-5": { fontSize: HEADING_SIZES.h5 },
  ".cm-header-6": { fontSize: HEADING_SIZES.h6 },
});

// Syntax highlighting for Markdown tags — all colors via CSS variables.
export const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: "2em", fontWeight: "bold", color: "var(--text-main)" },
  { tag: t.heading2, fontSize: "1.5em", fontWeight: "bold", color: "var(--text-main)" },
  { tag: t.heading3, fontSize: "1.17em", fontWeight: "bold", color: "var(--text-main)" },
  { tag: t.heading4, fontSize: "1em", fontWeight: "bold", color: "var(--text-main)" },
  { tag: t.heading5, fontSize: HEADING_SIZES.h5, fontWeight: "bold", color: "var(--text-main)" },
  { tag: t.heading6, fontSize: HEADING_SIZES.h6, fontWeight: "bold", color: "var(--text-main)" },
  { tag: t.strong, fontWeight: "bold", color: "var(--text-main)" },
  { tag: t.emphasis, fontStyle: "italic", color: "var(--text-main)" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--text-muted)" },
  { tag: t.link, color: "var(--accent-color)", textDecoration: "underline" },
  { tag: t.url, color: "var(--accent-color)" },
  { tag: t.quote, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: t.monospace, fontFamily: "monospace", backgroundColor: "var(--code-bg)", padding: "2px 4px", borderRadius: "var(--radius-xs)", fontSize: "0.9em" },
  { tag: t.list, color: "var(--text-main)" },
  { tag: t.comment, fontStyle: "italic", color: "var(--text-muted)" },
  { tag: t.keyword, color: "var(--accent-color)" },
  { tag: t.meta, color: "var(--text-muted)" },
  { tag: t.punctuation, color: "var(--text-faint)" },
]);

export function markdownTheme() {
  return [
    editorTheme,
    markdownBaseTheme,
    // Highest precedence so our markdown highlighting wins over any default
    // highlight style shipped by the editor's basic setup (this is what made
    // emphasis/italic appear "missing").
    Prec.highest(syntaxHighlighting(markdownHighlightStyle)),
  ];
}
