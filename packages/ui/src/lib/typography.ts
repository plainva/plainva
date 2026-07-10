/**
 * Shared document heading scale (plan Designsprache P7/C1): ONE source for
 * read mode (MarkdownReader) and live mode (MarkdownTheme). Before this, h5/h6
 * silently diverged (read 0.9/0.85em vs live 0.83/0.67em — the same heading
 * shrank ~27 % when switching modes).
 */
export const HEADING_SIZES = {
  h1: "2em",
  h2: "1.5em",
  h3: "1.17em",
  h4: "1em",
  h5: "0.9em",
  h6: "0.85em",
} as const;
