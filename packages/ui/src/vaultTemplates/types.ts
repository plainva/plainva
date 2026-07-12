/**
 * Shared types + text helpers for the vault structure templates. The actual
 * localized template sets live in `templates.<lang>.ts` next to this file —
 * one module per app language, resolved by `getVaultTemplates` (index.ts)
 * with an English fallback.
 */

/** OKF type of scaffolded daily notes (previously the desktop VaultContext constant). */
export const DEFAULT_DAILY_NOTE_TYPE = "Daily Note";

export type VaultTemplateId = "para" | "zettelkasten" | "ace" | "jd" | "gtd" | "journal";

export interface VaultTemplateNote {
  /** Vault-relative path incl. `.md`. */
  path: string;
  /** Frontmatter `description` — also shown in the generated listings.
   * NOTE: notes used as a `.base` new-item template MUST omit this — a
   * template's whole frontmatter is copied verbatim into every note created
   * from it (see newItemFlow.buildNewItemContent). */
  description?: string;
  /** Markdown body (starts at the H1); frontmatter is added by the scaffolder. */
  body: string;
  /** OKF type value; defaults to DEFAULT_NOTE_TYPE. */
  type?: string;
  /** Extra frontmatter written before the OKF defaults (typed properties and
   * relation values as whole-value wiki-link strings, e.g. "[[Note]]" or a
   * list of them). YAML-encoded via upsertFrontmatterKeys. */
  properties?: Record<string, unknown>;
}

/** A `.base` database shipped with a template (Gesamtplan DB-Vorlagen 2026-07-04). */
export interface VaultTemplateBase {
  /** Vault-relative path incl. `.base`. */
  path: string;
  /** In-memory `.base` config; serialized to Obsidian YAML by the scaffolder. */
  config: Record<string, unknown>;
}

export interface VaultTemplateDefinition {
  id: VaultTemplateId;
  name: string;
  description: string;
  /** All folders to create, parents before children. */
  folders: string[];
  notes: VaultTemplateNote[];
  /** `.base` databases scaffolded alongside the notes (optional). */
  bases?: VaultTemplateBase[];
  /** Per-vault settings wired after scaffolding. All keys optional: the
   * Journal template wires the full daily-notes trio, DB templates wire only
   * `templateFolder` so their "Neu" button finds the shipped note templates. */
  settings?: { dailyNotesFolder?: string; templateFolder?: string; dailyNoteTemplate?: string };
}

/** Top-level folders — the chooser cards show these as a structure preview. */
export function templatePreviewFolders(def: VaultTemplateDefinition): string[] {
  return def.folders.filter((f) => !f.includes("/"));
}

/** Database names (`.base` basename without extension) for the chooser cards'
 * database preview chips. Empty for templates without databases. */
export function templatePreviewBases(def: VaultTemplateDefinition): string[] {
  return (def.bases ?? []).map((b) => b.path.split("/").pop()!.replace(/\.base$/i, ""));
}

export interface FolderLine {
  name: string;
  description: string;
}

/** Welcome-note body: intro, index-style folder bullets (URL-encoded), outro. */
export function welcomeBody(title: string, intro: string, folders: FolderLine[], outro: string): string {
  const bullets = folders
    .map((f) => `* [${f.name}](${encodeURI(`${f.name}/index.md`)}) - ${f.description}`)
    .join("\n");
  return `# ${title}\n\n${intro}\n\n${bullets}\n\n${outro}\n`;
}
