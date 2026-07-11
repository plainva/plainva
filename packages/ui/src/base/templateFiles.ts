import { format } from "date-fns";

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

/** Template placeholders ({{date}}, {{time}}, {{title}}) — shared with the
 * editor's template picker so both interpolate identically. */
export function applyTemplatePlaceholders(content: string, title: string, now: Date = new Date()): string {
  return content
    .replace(/{{date}}/g, format(now, "yyyy-MM-dd"))
    .replace(/{{time}}/g, format(now, "HH:mm"))
    .replace(/{{title}}/g, title);
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

/**
 * Text a template contributes when inserted INTO an existing note (slash
 * command "insert template"): the template's own frontmatter would be inert
 * garbage mid-document, so it is stripped; placeholders interpolate against
 * the hosting note's title.
 */
export function templateInsertText(raw: string, title: string, now: Date = new Date()): string {
  return applyTemplatePlaceholders(raw.replace(LEADING_FRONTMATTER, ""), title, now);
}
