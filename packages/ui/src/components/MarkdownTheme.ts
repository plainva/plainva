import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { HEADING_SIZES } from "../lib/typography";
import { Prec } from "@codemirror/state";
import { CALLOUT_COLOR_KEYS, calloutLine, calloutTint } from "./callouts";
import { INDENT_EM, MAX_LIST_GUIDES } from "./listIndent";

// Callout line + tint colors (Obsidian > [!type]), generated from the single
// source of truth in callouts.ts so editor and read view never drift.
const calloutThemeRules = Object.fromEntries(
  CALLOUT_COLOR_KEYS.map((key) => [
    `.cm-callout-${key}`,
    { borderColor: calloutLine(key), backgroundColor: calloutTint(key) },
  ]),
);

// Indent guides (finding 2026-09-19): from the second list level on, a hairline
// under each parent bullet. Drawn as BACKGROUND layers of the line - no extra
// DOM, nothing to select, nothing for the caret to land in. The middle of
// level k's bullet was MEASURED at k * INDENT_EM + 0.05em (levels one to three,
// the step is listIndent.ts's), so that is where its guide runs.
const GUIDE = "linear-gradient(var(--border-color), var(--border-color))";
/** Measured: how far right of k * INDENT_EM the middle of a bullet sits. */
const GUIDE_OFFSET_EM = 0.05;
const indentGuideRules = Object.fromEntries(
  Array.from({ length: MAX_LIST_GUIDES }, (_, i) => i + 1).map((n) => [
    `.cm-list-guides-${n}`,
    {
      backgroundImage: Array.from({ length: n }, () => GUIDE).join(", "),
      backgroundSize: "1px 100%",
      backgroundRepeat: "no-repeat",
      backgroundPosition: Array.from({ length: n }, (_, k) => `calc(${(k + 1) * INDENT_EM + GUIDE_OFFSET_EM}em - 0.5px) 0`).join(", "),
    },
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
    // User-adjustable content size (issue #5) — services/contentFont.ts
    // overrides the variable on <html>; 16px is the shipped default.
    fontSize: "var(--content-font-size, 16px)",
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
    transition: "opacity var(--dur-1) var(--ease-1)",
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
  // A callout is ONE card built from its lines (finding 2026-09-19): sides and
  // tint on every line, the top and its corners on the first, the bottom on the
  // last. Padding, never margin - CodeMirror measures lines, and a margin is a
  // gap its height map does not know. Colors come from callouts.ts (top of file).
  ".cm-callout": {
    borderLeft: "1px solid",
    borderRight: "1px solid",
    paddingLeft: "var(--space-3)",
    paddingRight: "var(--space-3)",
  },
  ".cm-callout--first": {
    borderTop: "1px solid",
    borderTopLeftRadius: "var(--radius-md)",
    borderTopRightRadius: "var(--radius-md)",
    paddingTop: "var(--space-2)",
  },
  ".cm-callout--last": {
    borderBottom: "1px solid",
    borderBottomLeftRadius: "var(--radius-md)",
    borderBottomRightRadius: "var(--radius-md)",
    paddingBottom: "var(--space-2)",
  },
  ...calloutThemeRules,
  ...indentGuideRules,
  // Quoted text is muted and italic - in a plain quote. A callout is a card
  // with its own title, and its body reads like the note's text, exactly as
  // the reading view draws it; the title takes the callout's colour.
  ".cm-md-quote": { color: "var(--text-muted)", fontStyle: "italic" },
  ".cm-callout .cm-md-quote": { color: "var(--text-main)", fontStyle: "normal" },
  ".cm-callout .cm-callout-title .cm-md-quote": { color: "inherit" },
  // A done task: muted and struck through; the box stays as it is.
  ".cm-md-task-done": {
    color: "var(--text-muted)",
    textDecoration: "line-through",
  },
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
    borderRadius: "var(--radius-xs)",
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
    // The wrapper must not report the table's width as its own: `.cm-content`
    // grows to its widest child, and a six-column table then stretched the
    // whole note — every line scrolled sideways, the colour stripe drifted
    // with it (feedback round 2026-09-01, T2). Zero intrinsic width plus a
    // 100 % minimum keeps the wrapper at the note's width, so only the table
    // scrolls, inside its own box.
    width: 0,
    minWidth: "100%",
    boxSizing: "border-box",
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
  // Links inside rendered table cells (shared; was desktop-only in App.css, so
  // mobile table links had no cursor:pointer/underline and looked unclickable).
  ".cm-md-cell-link": {
    color: "var(--wiki-link-color, var(--accent-color))",
    textDecoration: "underline",
    cursor: "pointer",
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
    fontSize: "var(--text-sm)",
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
  ".cm-searchMatch": { backgroundColor: "var(--highlight-bg)", borderRadius: "var(--radius-xs)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--selection-bg)", outline: "1px solid var(--accent-color)" },
  ".cm-selectionMatch": { backgroundColor: "var(--bg-active)" },
  ".cm-md-bullet": {
    color: "var(--text-main)",
    fontWeight: "bold",
    marginRight: "4px",
  },
  // A bullet with nested lines behind it is the fold control (T8c): the
  // pointer says so, and a folded item shows the bullet in the accent so the
  // "…" placeholder is not the only hint that something is hidden.
  ".cm-md-bullet--foldable": {
    cursor: "pointer",
  },
  ".cm-md-bullet--foldable.is-folded": {
    color: "var(--accent-color)",
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
    fontSize: "var(--text-md)",
  },
  // Section headers (Grundlagen / Text formatieren / …). Override CM defaults
  // (silver border, list marker, reduced opacity).
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    display: "block",
    padding: "10px 10px 4px",
    margin: 0,
    fontSize: "var(--text-xs)",
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
    fontSize: "var(--text-xs)",
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
    fontSize: "var(--text-xs)",
    color: "var(--text-faint)",
  },
  // Second-line description, indented to sit under the title.
  ".cm-tooltip-autocomplete .plainva-slash-desc": {
    order: 3,
    flexBasis: "100%",
    width: "100%",
    paddingLeft: "38px",
    fontSize: "var(--text-sm)",
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
  // A NAMED class instead of a generated one: inside a callout card the quote
  // look has to step aside (finding 2026-09-19), and a rule can only address a
  // class it knows. The look itself lives in editorTheme (".cm-md-quote").
  { tag: t.quote, class: "cm-md-quote" },
  { tag: t.monospace, fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)", backgroundColor: "var(--code-bg)", padding: "2px 4px", borderRadius: "var(--radius-xs)", fontSize: "0.9em" },
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
