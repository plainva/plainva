import { scanTemplate, replaceTemplateTokens, type TemplateToken } from "./templateEngine";
import { parse as parseYaml } from "yaml";
import { deleteFrontmatterPath, editorTextOf, noteBodyOf, setFrontmatterPath, updateVaultText, wikiTargetForFile, type TextUpdateFiles } from "@plainva/core";
import { frontmatterBlockOf } from "../services/docMeta";
import { resolveTemplate, type TemplateContext } from "./templateEngine";
import { isFileNotFound } from "../lib/movedNote";

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
/** Every token that carries an answer, in the one grammar of the engine:
 *  `{{prompt:Label}}`, `{{prompt:Label|Default}}`, `{{select:Label|A,B}}`,
 *  `{{date_prompt:Label}}`. The label is the answer key. */
const ANSWERABLE = new Set(["prompt", "select", "date_prompt"]);
function isAnswerable(token: TemplateToken): boolean {
  return token.arg !== null && ANSWERABLE.has(token.name) && token.raw.startsWith((token.escaped ? "\\" : "") + "{{" + token.name + ":");
}

/** Label of an answerable token: everything before the first `|`. */
function labelOf(arg: string): string {
  const pipe = arg.indexOf("|");
  return (pipe === -1 ? arg : arg.slice(0, pipe)).trim();
}

/** Unique question labels in first-seen order — what to ask the user before an
 * interactive insert. Kept as the narrow entry point some callers already use;
 * the full shape (kind, default, options) comes from resolveTemplate. */
export function extractTemplatePrompts(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of scanTemplate(text)) {
    if (!isAnswerable(token) || token.escaped) continue;
    const label = labelOf(token.arg!);
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

/** Fills every answerable token from `answers` and extracts the first
 * {{cursor}} as a caret offset; ALL {{cursor}} markers are stripped so no
 * literal token can leak into a note. An escaped `\{{prompt:…}}` keeps its
 * text (minus the backslash) — that is how the token can be written down.
 * Pure — assumes resolveTemplate has already run. */
export function finalizeTemplate(text: string, answers: Record<string, string> = {}): FinalizedTemplate {
  const filled = replaceTemplateTokens(text, token => {
    if (!isAnswerable(token)) return token.raw;
    if (token.escaped) return token.raw.slice(1);
    const label = labelOf(token.arg!);
    return Object.prototype.hasOwnProperty.call(answers, label) ? answers[label] : "";
  });
  const at = filled.indexOf(CURSOR_TOKEN);
  return { text: filled.split(CURSOR_TOKEN).join(""), cursor: at < 0 ? null : at };
}

/** Placeholders for creating/seeding a note: date/time/title PLUS the
 * insert-time tokens resolved non-interactively ({{cursor}} stripped,
 * {{prompt}} blanked) so a "new note from template" never leaves a literal
 * token behind. Shared with the editor's template picker.
 *
 * The answer is the template, filled — its properties as they stand. What a
 * NOTE does not take over from them (`plainva.tasks`, `plainva.templateFor`,
 * a legacy `okf_version`) is taken out where the note is built
 * (`templateAsNewNote`), for this path and for the one that asks questions
 * alike. It used to be taken out here, and so only for a note nobody was
 * asked about (finding 2026-10-11). */
export function applyTemplatePlaceholders(
  content: string,
  title: string,
  now: Date = new Date(),
  extra: Omit<Partial<TemplateContext>, "title" | "now"> = {}
): string {
  const resolved = resolveTemplate(content, { ...extra, title, now }, "headless");
  return finalizeTemplate(resolved.text).text;
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
  /**
   * Templates that are assigned to the renamed database and could not be
   * written: they still name the old file. They used to be skipped without a
   * trace (finding 2026-10-12); the rename now says that not every link could
   * be updated.
   */
  failed: string[];
}

/**
 * Carries `plainva.templateFor` assignments across a `.base` rename (plan P4):
 * the plainva namespace is deliberately absent from the link index, so the
 * regular backlink-driven rename chain cannot see these links — this dedicated
 * sweep over the template folder is the only carrier. Bare entries stay bare
 * (new file name; qualified on collision), qualified entries stay qualified.
 * A rename must never fail over a template: one that is gone is skipped, one
 * that is there and cannot be read or written is listed in `failed`.
 */
export async function retargetTemplateForInFolder(opts: {
  adapter: ScopedTemplateListAdapter & TextUpdateFiles;
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
  const failed: string[] = [];
  let renamed = 0;

  const retargeted = (content: string): { hits: number; next: string | null } => {
    const raw = rawTemplateForOf(content);
    let hits = 0;
    const next = (raw?.values ?? []).map((value) => {
      const target = templateForTargetOf(value);
      if (target === null || !templateMatchesBase([target], oldBasePath)) return value;
      hits++;
      const qualified = target.includes("/") || target.includes("\\");
      return `[[${qualified ? newBasePath : bareTarget}]]`;
    });
    return { hits, next: !raw || hits === 0 ? null : setFrontmatterPath(content, TEMPLATE_FOR_PATH, raw.scalar ? next[0] : next) };
  };

  for (const item of await listTemplates(adapter, folder)) {
    try {
      // Counted on the template as it was changed; a working copy of an open conflict is retargeted the same way.
      const update = await updateVaultText(adapter, item.path, (content) => retargeted(content).next);
      const { hits } = retargeted(update.before);
      if (!hits) continue;
      changedPaths.push(item.path);
      renamed += hits;
    } catch (e) {
      // The rename itself must go through. A template that is gone since it
      // was listed names no database any more; one that is there and could
      // not be read or written may still name the old file.
      if (!isFileNotFound(e)) failed.push(item.path);
    }
  }
  return { changedPaths, renamed, failed };
}

/**
 * Adds a templateFor assignment onto `basePath` (no-op when a stored entry
 * already matches it). The link text is collision-safe via wikiTargetForFile;
 * existing entries are kept verbatim.
 *
 * A template whose properties block cannot be written — no YAML map, YAML that
 * cannot be read — throws what the writer throws. It used to answer "nothing
 * changed", the answer of a template that is assigned already, and so the
 * menu that asked said nothing and showed the template as it was (finding
 * 2026-10-12). `removeTemplateForAssignment` has no such case: it finds
 * nothing to remove in a block it cannot read.
 */
export function addTemplateForAssignment(
  content: string,
  basePath: string,
  allFilePaths: readonly string[]
): { content: string; changed: boolean } {
  const raw = rawTemplateForOf(content);
  const values = raw ? raw.values : [];
  const targets = values
    .map(templateForTargetOf)
    .filter((t): t is string => t !== null);
  if (templateMatchesBase(targets, basePath)) return { content, changed: false };
  const link = `[[${wikiTargetForFile(basePath, [...allFilePaths])}]]`;
  return { content: setFrontmatterPath(content, TEMPLATE_FOR_PATH, [...values, link]), changed: true };
}

/**
 * Removes every templateFor entry pointing at `basePath` (path or bare-name
 * match). Deletes the key — and an emptied plainva map — when nothing is left.
 */
export function removeTemplateForAssignment(
  content: string,
  basePath: string
): { content: string; changed: boolean } {
  const raw = rawTemplateForOf(content);
  if (!raw) return { content, changed: false };
  const kept = raw.values.filter((v) => {
    const t = templateForTargetOf(v);
    return t === null || !templateMatchesBase([t], basePath);
  });
  if (kept.length === raw.values.length) return { content, changed: false };
  try {
    const next =
      kept.length === 0
        ? deleteFrontmatterPath(content, TEMPLATE_FOR_PATH)
        : setFrontmatterPath(content, TEMPLATE_FOR_PATH, raw.scalar && kept.length === 1 ? kept[0] : kept);
    return { content: next, changed: true };
  } catch {
    return { content, changed: false };
  }
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

/** Interpolated template BODY for an interactive insert: frontmatter stripped,
 * date/time/title filled, but {{cursor}}/{{prompt}} PRESERVED so the caller can
 * extractTemplatePrompts → ask the user → finalizeTemplate.
 *
 * The template is read as an editor holds it (`editorTextOf`): with `\n` line
 * ends and without a byte order mark. What comes out goes INTO another text,
 * and a mark is its file's first character, not text. Read as the file has
 * it, the mark of a template without a properties block stood at the start of
 * the body — and "insert template" in the mail composer of both shells put it
 * into the message (finding 2026-10-11). */
export function interpolateTemplateBody(raw: string, title: string, now: Date = new Date()): string {
  return resolveTemplate(noteBodyOf(editorTextOf(raw)), { title, now }, "interactive").text;
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
