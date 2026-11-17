/**
 * A template's placeholder (`{{title}}`, `{{date:YYYY}}`): text a template
 * fills in when a note is made from it, no name of the template itself.
 *
 * No name a note is mentioned by: the index reads a template's `- {{title}}`
 * under `aliases` since 2026-10-22 (ADR 0009), and as a phrase for the
 * full-text index it is the word inside — every note with `title` in it would
 * mention the template. The title a link finds a note by is
 * `isTemplateTitle`'s, below.
 */
const PLACEHOLDER = /\{\{[^{}]*\}\}/;

/** Whether `text` holds a template placeholder. */
export function holdsTemplatePlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text);
}

/**
 * The names a template fills in (`packages/ui/src/base/templateEngine.ts`):
 * the note's own, the dates, the questions it asks, and a meeting's.
 */
const FILLED_NAMES = new Set([
  "title", "date", "time", "yesterday", "tomorrow", "folder", "vault", "daily", "weekday",
  "selection", "clipboard", "cursor", "prompt", "select", "date_prompt",
  "start", "end", "location", "attendees", "organizer", "link", "description",
]);

/** `{{name[±N][:arg]}}`, the grammar of the template engine's placeholders. */
const TOKEN = /\{\{([a-zA-Z_][a-zA-Z_0-9]*)(?:[+-]\d+)?(?::[^{}]*)?\}\}/g;

/**
 * Whether `title` is the title of a template: it holds a placeholder the
 * template fills in when a note is made from it (`{{title}}`,
 * `Daily {{date:YYYY-MM-DD}}`). Such a title names the notes made from the
 * template, not the template (Fehlerliste 0.9.0, B26) — while a note about
 * `{{each}}` or `{{ variable }}` keeps its title.
 */
export function isTemplateTitle(title: string): boolean {
  for (const token of title.matchAll(TOKEN)) if (FILLED_NAMES.has(token[1])) return true;
  return false;
}
