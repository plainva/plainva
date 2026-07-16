import { format } from "date-fns";
import { parse as parseYaml } from "yaml";
import { deleteFrontmatterPath, setFrontmatterPath, wikiTargetForFile } from "@plainva/core";
import { frontmatterBlockOf } from "../services/docMeta";

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
  // Template-only plainva keys must not carry over into created notes:
  // `plainva.tasks: false` opts the TEMPLATE out of the Tasks view (a note
  // created from it is real content) and `plainva.templateFor` scopes the
  // TEMPLATE to databases (a created entry is not a template). Other plainva
  // keys (icon, header color) stay intentionally inheritable. Malformed
  // frontmatter → leave as-is.
  try {
    return deleteFrontmatterPath(deleteFrontmatterPath(filled, ["plainva", "tasks"]), TEMPLATE_FOR_PATH);
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

/**
 * Database scoping of templates (plan Vorlagen-Datenbank-Zuordnung 2026-07-16):
 * `plainva.templateFor` on a template lists wiki links to the `.base` files the
 * template belongs to. Deliberately inside the plainva namespace — Obsidian
 * stays inert, the properties panel hides it and the link index skips it (no
 * backlink noise on the `.base`; renames are carried by a dedicated sweep).
 */
export const TEMPLATE_FOR_PATH = ["plainva", "templateFor"] as const;

export interface ScopedTemplateItem extends TemplateItem {
  /** Anchor-/alias-free templateFor targets; [] = unscoped template. */
  templateFor: string[];
}

export type ScopedTemplateListAdapter = TemplateListAdapter & {
  readTextFile(path: string): Promise<string>;
};

/** Inner target of one templateFor entry — accepts "[[X#a|alias]]" and bare
 * strings; null for non-strings and blanks. */
function templateForTargetOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let inner = value.trim();
  const wiki = /^\[\[([^[\]]+)\]\]$/.exec(inner);
  if (wiki) inner = wiki[1];
  const pipe = inner.indexOf("|");
  if (pipe !== -1) inner = inner.slice(0, pipe);
  const anchor = inner.search(/[#^]/);
  if (anchor !== -1) inner = inner.slice(0, anchor);
  inner = inner.trim();
  return inner || null;
}

/** templateFor targets of a template's raw text; [] when absent or the
 * frontmatter is unparseable (a broken template must never break the menu). */
export function parseTemplateForTargets(content: string): string[] {
  const block = frontmatterBlockOf(content);
  if (!block) return [];
  let fm: unknown;
  try {
    fm = parseYaml(block);
  } catch {
    return [];
  }
  if (typeof fm !== "object" || fm === null || Array.isArray(fm)) return [];
  const ns = (fm as Record<string, unknown>)[TEMPLATE_FOR_PATH[0]];
  if (typeof ns !== "object" || ns === null || Array.isArray(ns)) return [];
  const raw = (ns as Record<string, unknown>)[TEMPLATE_FOR_PATH[1]];
  const list = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
  return list.map(templateForTargetOf).filter((t): t is string => t !== null);
}

const normalizedVaultPath = (p: string) => p.replace(/\\/g, "/").normalize("NFC").toLowerCase();

/**
 * True when one of the templateFor targets points at `basePath`: the full
 * vault-relative path, or — bare form — the file name. The basename fallback
 * keeps assignments valid across pure folder moves of the `.base`. Two
 * same-named `.base` files both match a bare target (write paths qualify on
 * collision, see wikiTargetForFile); qualified targets match exactly.
 */
export function templateMatchesBase(targets: readonly string[], basePath: string): boolean {
  if (targets.length === 0) return false;
  const full = normalizedVaultPath(basePath);
  const name = full.split("/").pop() ?? full;
  return targets.some((t) => {
    const tn = normalizedVaultPath(t);
    return tn === full || tn === name;
  });
}

/** listTemplates plus each template's templateFor scope (unreadable files
 * count as unscoped — the menu must never fail over one broken template). */
export async function listTemplatesScoped(
  adapter: ScopedTemplateListAdapter,
  folder: string
): Promise<ScopedTemplateItem[]> {
  const items = await listTemplates(adapter, folder);
  return Promise.all(
    items.map(async (item) => {
      let templateFor: string[] = [];
      try {
        templateFor = parseTemplateForTargets(await adapter.readTextFile(item.path));
      } catch {
        /* unreadable template — unscoped */
      }
      return { ...item, templateFor };
    })
  );
}

/** Raw templateFor value of a frontmatter block: the stored strings plus
 * whether the value was a scalar (kept scalar on rewrite). Null when absent
 * or unparseable. */
function rawTemplateForOf(content: string): { values: unknown[]; scalar: boolean } | null {
  const block = frontmatterBlockOf(content);
  if (!block) return null;
  let fm: unknown;
  try {
    fm = parseYaml(block);
  } catch {
    return null;
  }
  if (typeof fm !== "object" || fm === null || Array.isArray(fm)) return null;
  const ns = (fm as Record<string, unknown>)[TEMPLATE_FOR_PATH[0]];
  if (typeof ns !== "object" || ns === null || Array.isArray(ns)) return null;
  const raw = (ns as Record<string, unknown>)[TEMPLATE_FOR_PATH[1]];
  if (raw == null || raw === "") return null;
  return Array.isArray(raw) ? { values: raw, scalar: false } : { values: [raw], scalar: true };
}

export interface TemplateForSweepResult {
  /** Template files whose assignment was rewritten (caller re-indexes these). */
  changedPaths: string[];
  /** Number of rewritten templateFor entries across all templates. */
  renamed: number;
}

/**
 * Carries `plainva.templateFor` assignments across a `.base` rename (plan P4):
 * the plainva namespace is deliberately absent from the link index, so the
 * regular backlink-driven rename chain cannot see these links — this dedicated
 * sweep over the template folder is the only carrier. Bare entries stay bare
 * (new file name; qualified on collision), qualified entries stay qualified.
 * Broken/unreadable templates are skipped — a rename must never fail over one.
 */
export async function retargetTemplateForInFolder(opts: {
  adapter: ScopedTemplateListAdapter & { writeTextFile(path: string, content: string): Promise<void> };
  folder: string;
  oldBasePath: string;
  newBasePath: string;
  /** Vault file list for collision-safe bare targets; the pre-rename list is
   * fine — oldBasePath is swapped for newBasePath internally. */
  allFilePaths: readonly string[];
}): Promise<TemplateForSweepResult> {
  const { adapter, folder, oldBasePath, newBasePath } = opts;
  const adjusted = opts.allFilePaths.map((p) => (p === oldBasePath ? newBasePath : p));
  const bareTarget = wikiTargetForFile(newBasePath, adjusted);
  const changedPaths: string[] = [];
  let renamed = 0;

  for (const item of await listTemplates(adapter, folder)) {
    try {
      const content = await adapter.readTextFile(item.path);
      const raw = rawTemplateForOf(content);
      if (!raw) continue;
      let changed = 0;
      const next = raw.values.map((value) => {
        const target = templateForTargetOf(value);
        if (target === null || !templateMatchesBase([target], oldBasePath)) return value;
        changed++;
        const qualified = target.includes("/") || target.includes("\\");
        return `[[${qualified ? newBasePath : bareTarget}]]`;
      });
      if (changed === 0) continue;
      await adapter.writeTextFile(
        item.path,
        setFrontmatterPath(content, TEMPLATE_FOR_PATH, raw.scalar ? next[0] : next)
      );
      changedPaths.push(item.path);
      renamed += changed;
    } catch {
      /* skip broken template — the rename itself must go through */
    }
  }
  return { changedPaths, renamed };
}

export interface TemplateGroups<T extends TemplateItem = ScopedTemplateItem> {
  /** Default view: templates assigned to this base ∪ the base's default template. */
  forBase: T[];
  /** Everything else — unassigned and assigned-elsewhere — behind "show all". */
  others: T[];
}

/**
 * Menu model of the base "new item" dropdown (decisions E2 + D1 of the plan):
 * unassigned templates are NOT part of the default view; the base's default
 * template is ALWAYS visible — the main "+ entry" button uses it regardless
 * of the filter, so hiding it would create entries with an invisible template.
 */
export function groupTemplatesForBase<T extends ScopedTemplateItem>(
  items: readonly T[],
  basePath: string,
  defaultTemplate: string | null
): TemplateGroups<T> {
  const forBase: T[] = [];
  const others: T[] = [];
  for (const item of items) {
    const isDefault = defaultTemplate !== null && item.path === defaultTemplate;
    if (isDefault || templateMatchesBase(item.templateFor, basePath)) forBase.push(item);
    else others.push(item);
  }
  return { forBase, others };
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
