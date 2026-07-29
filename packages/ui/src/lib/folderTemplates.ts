/**
 * Folder and type templates (plan Vorlagen-Engine, P4/P4b).
 *
 * A new note picks up a template from where it is filed or from what it is,
 * without anyone choosing one: `Projekte/` starts from `Projekt.md`, a note of
 * type `Meeting` from `Besprechung.md`. The mapping lives in the per-vault
 * settings, not in the notes — it travels to the other devices through the
 * settings profile, and Obsidian sees files nobody touched.
 *
 * The rules are DATA: a folder path and a template path, nothing evaluated.
 * Resolution is pure so both shells and the tests share it.
 */

/** One mapping. Either side may be empty while it is being filled in. */
export interface FolderTemplateRule {
  /** Vault-relative folder; `""` is the vault root and matches everything. */
  folder: string;
  /** Vault-relative path of the template file. */
  template: string;
}

/** One mapping from an OKF `type` to a template (P4b). */
export interface TypeTemplateRule {
  type: string;
  template: string;
}

/**
 * Vault-relative folder path in one shape: forward slashes, no leading or
 * trailing separator, `.` and `/` collapse to the root. Everything downstream
 * compares against this, so a hand-typed `\Projekte\` behaves like a picked one.
 */
export function normalizeFolderPath(raw: string): string {
  const cleaned = raw.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "").trim();
  return cleaned === "." ? "" : cleaned;
}

/** Reads what the settings store holds, ignoring anything malformed. */
export function parseFolderTemplateRules(raw: unknown): FolderTemplateRule[] {
  if (!Array.isArray(raw)) return [];
  const out: FolderTemplateRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const folder = (entry as { folder?: unknown }).folder;
    const template = (entry as { template?: unknown }).template;
    if (typeof folder !== "string" || typeof template !== "string") continue;
    out.push({ folder: normalizeFolderPath(folder), template: template.trim() });
  }
  return out;
}

export function parseTypeTemplateRules(raw: unknown): TypeTemplateRule[] {
  if (!Array.isArray(raw)) return [];
  const out: TypeTemplateRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const type = (entry as { type?: unknown }).type;
    const template = (entry as { template?: unknown }).template;
    if (typeof type !== "string" || typeof template !== "string") continue;
    out.push({ type: type.trim(), template: template.trim() });
  }
  return out;
}

/** A rule only applies once both halves are filled in. */
function usable(rule: FolderTemplateRule): boolean {
  return rule.template.trim().length > 0;
}

/**
 * The template for a folder — the LONGEST matching rule wins.
 *
 * Someone who maps `Projekte` and `Projekte/Kunden` means the second one as the
 * special case. Any other tie-break (first match, list order) would make the
 * outcome depend on how the list happens to be sorted, which is invisible.
 *
 * Matching ignores case: the folder picker writes the exact name, but a
 * hand-typed one rarely matches it letter for letter, and no filesystem Plainva
 * runs on distinguishes two folders by case alone.
 */
export function resolveFolderTemplate(
  rules: readonly FolderTemplateRule[],
  folderPath: string
): string | null {
  const target = normalizeFolderPath(folderPath).toLowerCase();
  let best: FolderTemplateRule | null = null;
  for (const rule of rules) {
    if (!usable(rule)) continue;
    const folder = rule.folder.toLowerCase();
    // The root rule covers the whole vault; every other one covers itself and
    // everything below it.
    const hit = folder === "" || target === folder || target.startsWith(`${folder}/`);
    if (!hit) continue;
    if (!best || rule.folder.length > best.folder.length) best = rule;
  }
  return best ? best.template : null;
}

/** The template for an OKF type. First usable match wins — types are flat. */
export function resolveTypeTemplate(
  rules: readonly TypeTemplateRule[],
  type: string
): string | null {
  const target = type.trim().toLowerCase();
  if (!target) return null;
  for (const rule of rules) {
    if (!rule.template.trim()) continue;
    if (rule.type.trim().toLowerCase() === target) return rule.template;
  }
  return null;
}

/**
 * What a new note in `folderPath` of type `type` starts from.
 *
 * Folder beats type: where a note lies is the more deliberate statement — a
 * type is often just the vault's default. An explicitly chosen template
 * ("New note from template…") never reaches this function; it wins by not
 * asking.
 */
export function resolveTemplateForNewNote(
  folderRules: readonly FolderTemplateRule[],
  typeRules: readonly TypeTemplateRule[],
  folderPath: string,
  type: string
): string | null {
  return resolveFolderTemplate(folderRules, folderPath) ?? resolveTypeTemplate(typeRules, type);
}
