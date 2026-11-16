/**
 * A template's placeholder (`{{title}}`, `{{date:YYYY}}`): text a template
 * fills in when a note is made from it, no name of the template itself.
 *
 * No name a note is mentioned by: the index reads a template's `- {{title}}`
 * under `aliases` since 2026-10-22 (ADR 0009), and as a phrase for the
 * full-text index it is the word inside — every note with `title` in it would
 * mention the template. And no title a link finds the template by
 * (`[[{{title}}]]`, Sammelplan § 3.144 Nr. 11).
 */
const PLACEHOLDER = /\{\{[^{}]*\}\}/;

/** Whether `text` holds a template placeholder. */
export function holdsTemplatePlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text);
}
