/**
 * Curated accent palette (plan Designsprache P5): muted tones that work on
 * both themes. Single source for the doc-icon tints (EmojiPicker) and the
 * header color picker — the values are DATA (written into note frontmatter),
 * so they stay concrete hex here; styles/tokens.css mirrors them as
 * --palette-1..10 for pure-CSS consumers.
 */
export const ACCENT_PALETTE = [
  "#c94f4f",
  "#d97a2b",
  "#c9a227",
  "#4f9d4f",
  "#2f6f6f",
  "#2f6f8f",
  "#5a5fd0",
  "#8a4fd0",
  "#c04f8a",
  "#7a7f85",
] as const;
