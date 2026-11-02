import { isAnswerableToken, isCursorToken, scanTemplate, replaceTemplateTokens, type ResolvedTemplate, type TemplateToken } from "./templateEngine";
import { parse as parseYaml } from "yaml";
import { deleteFrontmatterPath, editorTextOf, wikiLinkParts, noteBodyOf, setFrontmatterPath, updateVaultText, wikiTargetForFile, type TextUpdateFiles } from "@plainva/core";
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
/** Every token that carries an answer, in the one grammar of the engine. The label is the answer key. */
const isAnswerable = (token: TemplateToken): boolean => isAnswerableToken(token);

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
 * Pure — assumes resolveTemplate has already run.
 *
 * Given what `resolveTemplate` returned, only the tokens it left for this step
 * are filled (Sammelplan § 3.143 Nr. 1): it has already taken the backslash
 * off an escaped `\{{cursor}}` or `\{{prompt:Name}}`, and it has put a
 * selection, a title or a description into the text that may carry such a
 * token as text — read again here, the first set the caret and vanished, the
 * second became an answer or nothing. An answer is never read again either. */
export function finalizeTemplate(text: string | ResolvedTemplate, answers: Record<string, string> = {}): FinalizedTemplate {
  if (typeof text !== "string") return finalizeResolved(text, answers);
  const filled = replaceTemplateTokens(text, token => {
    if (!isAnswerable(token)) return token.raw;
    if (token.escaped) return token.raw.slice(1);
    const label = labelOf(token.arg!);
    return Object.prototype.hasOwnProperty.call(answers, label) ? answers[label] : "";
  });
  const at = filled.indexOf(CURSOR_TOKEN);
  return { text: filled.split(CURSOR_TOKEN).join(""), cursor: at < 0 ? null : at };
}

function finalizeResolved(resolved: ResolvedTemplate, answers: Record<string, string>): FinalizedTemplate {
  const parts: string[] = [];
  let length = 0;
  let at = 0;
  let cursor: number | null = null;
  for (const late of resolved.late) {
    const before = resolved.text.slice(at, late.index);
    parts.push(before);
    length += before.length;
    at = late.index + late.raw.length;
    const token = scanTemplate(late.raw)[0];
    let value = late.raw;
    if (token && isCursorToken(token)) {
      if (cursor === null) cursor = length;
      value = "";
    } else if (token && isAnswerable(token)) {
      const label = labelOf(token.arg!);
      value = Object.prototype.hasOwnProperty.call(answers, label) ? answers[label] : "";
    }
    parts.push(value);
    length += value.length;
  }
  parts.push(resolved.text.slice(at));
  return { text: parts.join(""), cursor };
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
  return finalizeTemplate(resolved).text;
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
  // In front of the alias bar and of the backslash of `\|` (Sammelplan § 3.133 Nr. 1).
  inner = inner.slice(0, wikiLinkParts(inner).headEnd);
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

/** One path that changed: a file, or a folder with everything under it. */
export interface VaultPathMove {
  from: string;
  to: string;
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
  return retargetTemplateForMoves({
    adapter: opts.adapter,
    folder: opts.folder,
    moves: [{ from: opts.oldBasePath, to: opts.newBasePath }],
    allFilePaths: opts.allFilePaths,
  });
}

/**
 * What every path change of a file or folder calls in both shells: the
 * template assignments follow the databases that moved. The databases come
 * from the index as it was before the move; without a template folder or an
 * index, or for moves that carry no database, nothing is read.
 */
export async function carryTemplateAssignments(
  deps: {
    adapter: ScopedTemplateListAdapter & TextUpdateFiles;
    queryService: { listBaseFilePaths(): Promise<string[]> } | null | undefined;
  },
  folder: string | undefined,
  moves: readonly VaultPathMove[],
): Promise<TemplateForSweepResult> {
  const nothing: TemplateForSweepResult = { changedPaths: [], renamed: 0, failed: [] };
  if (!folder?.trim() || !deps.queryService || moves.length === 0) return nothing;
  const bases = new Set(await deps.queryService.listBaseFilePaths());
  for (const move of moves) if (move.from.toLowerCase().endsWith(".base")) bases.add(move.from);
  return retargetTemplateForMoves({ adapter: deps.adapter, folder: folder.trim(), moves, allFilePaths: [...bases] });
}

/**
 * The same sweep for every way a `.base` changes its path (open-items plan
 * 3.71 no. 4): renamed, moved to another folder, or carried along when its
 * folder is renamed or moved — in both shells. Only the in-folder rename of
 * the desktop carried the assignments; a move left a qualified entry
 * (`[[Projects/Tasks.base]]`) naming a file that was no longer there, and the
 * phone carried none at all.
 *
 * `moves` are the paths as they were and are now; a folder move covers every
 * `.base` of `allFilePaths` under it. A bare entry changes only when the name
 * changed (a bare name still finds a database that only moved); a qualified
 * entry changes whenever the path did.
 */
export async function retargetTemplateForMoves(opts: {
  adapter: ScopedTemplateListAdapter & TextUpdateFiles;
  folder: string;
  moves: readonly VaultPathMove[];
  /** Vault file list as before the moves, for collision-safe bare targets. */
  allFilePaths: readonly string[];
}): Promise<TemplateForSweepResult> {
  const { adapter, folder } = opts;
  const changedPaths: string[] = [];
  const failed: string[] = [];
  let renamed = 0;

  // Every database that changed its path, old path to new.
  const baseMoves = new Map<string, string>();
  const known = new Set(opts.allFilePaths);
  for (const move of opts.moves) {
    if (move.from === move.to) continue;
    if (move.from.toLowerCase().endsWith(".base")) baseMoves.set(move.from, move.to);
    const prefix = `${move.from}/`;
    for (const path of known) {
      if (path.startsWith(prefix) && path.toLowerCase().endsWith(".base")) baseMoves.set(path, `${move.to}/${path.slice(prefix.length)}`);
    }
  }
  if (baseMoves.size === 0) return { changedPaths, renamed, failed };
  const adjusted = opts.allFilePaths.map((p) => baseMoves.get(p) ?? p);
  const nameOf = (p: string) => p.split("/").pop() ?? p;

  /** What an entry names now: its new link text, or null where it names none of the moved databases. */
  const movedTarget = (target: string): string | null => {
    const qualified = target.includes("/") || target.includes("\\");
    for (const [from, to] of baseMoves) {
      if (!templateMatchesBase([target], from)) continue;
      if (qualified) return `[[${to}]]`;
      // A bare name still finds a database that only moved.
      if (normalizedVaultPath(nameOf(from)) === normalizedVaultPath(nameOf(to))) return null;
      return `[[${wikiTargetForFile(to, adjusted)}]]`;
    }
    return null;
  };

  const retargeted = (content: string): { hits: number; next: string | null } => {
    const raw = rawTemplateForOf(content);
    let hits = 0;
    const next = (raw?.values ?? []).map((value) => {
      const target = templateForTargetOf(value);
      const moved = target === null ? null : movedTarget(target);
      if (moved === null) return value;
      hits++;
      return moved;
    });
    return { hits, next: !raw || hits === 0 ? null : setFrontmatterPath(content, TEMPLATE_FOR_PATH, raw.scalar ? next[0] : next) };
  };

  // The template folder itself may be among the moves: its templates are read where they are now.
  const movedFolder = opts.moves.find((m) => folder === m.from || folder.startsWith(`${m.from}/`));
  const folderNow = movedFolder ? `${movedFolder.to}${folder.slice(movedFolder.from.length)}` : folder;
  for (const item of await listTemplates(adapter, folderNow)) {
    try {
      // Counted on the template as it was changed; a working copy of an open conflict is retargeted the same way.
      const update = await updateVaultText(adapter, item.path, (content) => retargeted(content).next);
      const { hits } = retargeted(update.before);
      if (!hits) continue;
      changedPaths.push(item.path);
      renamed += hits;
    } catch (e) {
      // The move itself must go through. A template that is gone since it
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

/**
 * The text a template contributes when it goes INTO another text — the body of
 * a mail (the composers of both shells): its own properties block stays out,
 * since a mail body has none and the recipient would get YAML, and it is read
 * as an editor holds it — `\n` line ends, no byte order mark. A mark is its
 * file's first character, not text; read as the file has it, the mark of a
 * template without a properties block stood at the start of the body, and
 * "insert template" put it into the message (finding 2026-10-11).
 *
 * The placeholders stay: the pipeline with questions fills them, ONCE. The
 * composers filled the text here first, without the shell's context and
 * without asking — every question became nothing, its default too — and then
 * ran the pipeline on what was left (Sammelplan § 3.97).
 */
export function templateBodyOf(raw: string): string {
  return noteBodyOf(editorTextOf(raw));
}
