import { format } from "date-fns";
import { deleteFrontmatterPath } from "@plainva/core";

/**
 * Template file helpers (moved from the desktop newItemFlow in R3 so the
 * mobile shell lists and interpolates templates identically). Storage access
 * stays structural — any vault adapter with exists/listDir fits.
 */

export interface TemplateItem {
  path: string;
  title: string;
}

export type TemplateListAdapter = {
  exists(path: string): Promise<boolean>;
  listDir(path: string): Promise<Array<{ path: string; isDirectory: boolean }>>;
};

/** Templater-lite tokens resolved at INSERT time — they need per-insert input,
 * unlike date/time/title: a caret marker and named value prompts. */
const CURSOR_TOKEN = "{{cursor}}";
const PROMPT_RE = /\{\{prompt:([^}]+)\}\}/g;

/** date/time/title interpolation only — the always-resolvable placeholders. */
function interpolateDates(content: string, title: string, now: Date): string {
  return content
    .replace(/{{date}}/g, format(now, "yyyy-MM-dd"))
    .replace(/{{time}}/g, format(now, "HH:mm"))
    .replace(/{{title}}/g, title);
}

/** Unique {{prompt:Label}} labels in first-seen order — what to ask the user
 * before an interactive insert. */
export function extractTemplatePrompts(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(PROMPT_RE)) {
    const label = m[1].trim();
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

export interface FinalizedTemplate {
  /** Text with {{prompt:…}} filled (missing → empty) and every {{cursor}} removed. */
  text: string;
  /** Offset of the FIRST {{cursor}} in `text`, or null if there was none. */
  cursor: number | null;
}

/** Fills {{prompt:Label}} from `answers` and extracts the first {{cursor}} as a
 * caret offset; ALL {{cursor}} markers are stripped so no literal token can leak
 * into a note. Pure — assumes date/title were already interpolated. */
export function finalizeTemplate(text: string, answers: Record<string, string> = {}): FinalizedTemplate {
  const filled = text.replace(PROMPT_RE, (_m, label: string) => answers[label.trim()] ?? "");
  const at = filled.indexOf(CURSOR_TOKEN);
  return { text: filled.split(CURSOR_TOKEN).join(""), cursor: at < 0 ? null : at };
}

/** Placeholders for creating/seeding a note: date/time/title PLUS the
 * insert-time tokens resolved non-interactively ({{cursor}} stripped,
 * {{prompt}} blanked) so a "new note from template" never leaves a literal
 * token behind. Shared with the editor's template picker. */
export function applyTemplatePlaceholders(content: string, title: string, now: Date = new Date()): string {
  const filled = finalizeTemplate(interpolateDates(content, title, now)).text;
  // `plainva.tasks: false` opts the TEMPLATE out of the Tasks view; a note
  // created from it is real content, so the marker must not carry over (else
  // the new note's tasks would be hidden). Malformed frontmatter → leave as-is.
  try {
    return deleteFrontmatterPath(filled, ["plainva", "tasks"]);
  } catch {
    return filled;
  }
}

/** OKF reserved note names — folder infrastructure, never a fill-in template. */
const RESERVED_TEMPLATE_NAME = /^(?:index|log)\.md$/i;

/** All .md files of the template folder, sorted by title. Reserved OKF notes
 * (index.md/log.md — a managed folder index can live in the template folder)
 * are never offered as templates. */
export async function listTemplates(adapter: TemplateListAdapter, folder: string): Promise<TemplateItem[]> {
  const items: TemplateItem[] = [];
  try {
    if (!(await adapter.exists(folder))) return items;
    for (const f of await adapter.listDir(folder)) {
      const base = f.path.split(/[/\\]/).pop() ?? "";
      if (!f.isDirectory && f.path.toLowerCase().endsWith(".md") && !RESERVED_TEMPLATE_NAME.test(base)) {
        items.push({ path: f.path, title: base.replace(/\.md$/i, "") || f.path });
      }
    }
  } catch (e) {
    console.warn("[templateFiles] listing templates failed", folder, e);
  }
  return items.sort((a, b) => a.title.localeCompare(b.title));
}

const LEADING_FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Interpolated template BODY for an interactive insert: frontmatter stripped,
 * date/time/title filled, but {{cursor}}/{{prompt}} PRESERVED so the caller can
 * extractTemplatePrompts → ask the user → finalizeTemplate. */
export function interpolateTemplateBody(raw: string, title: string, now: Date = new Date()): string {
  return interpolateDates(raw.replace(LEADING_FRONTMATTER, ""), title, now);
}

/** Insert-into-note parts WITH caret placement (prompts already answered). */
export function templateInsertParts(
  raw: string,
  title: string,
  answers: Record<string, string> = {},
  now: Date = new Date()
): FinalizedTemplate {
  return finalizeTemplate(interpolateTemplateBody(raw, title, now), answers);
}

/**
 * Text a template contributes when inserted INTO an existing note (slash
 * command "insert template"): the template's own frontmatter would be inert
 * garbage mid-document, so it is stripped; placeholders interpolate against the
 * hosting note's title, and {{cursor}}/{{prompt}} are resolved (stripped/blank)
 * so they never leak. Callers wanting caret/prompt handling use
 * templateInsertParts + extractTemplatePrompts.
 */
export function templateInsertText(raw: string, title: string, now: Date = new Date()): string {
  return templateInsertParts(raw, title, {}, now).text;
}
