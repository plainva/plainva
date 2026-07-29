/**
 * Shared types + text helpers for the vault structure templates. The actual
 * localized template sets live in `templates.<lang>.ts` next to this file —
 * one module per app language, resolved by `getVaultTemplates` (index.ts)
 * with an English fallback.
 */

/** OKF type of scaffolded daily notes (previously the desktop VaultContext constant). */
export const DEFAULT_DAILY_NOTE_TYPE = "Daily Note";

export type VaultTemplateId = "plainva" | "para" | "zettelkasten" | "ace" | "jd" | "gtd" | "journal";

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

/** A verbatim file shipped with a template (SVG illustrations, sample assets).
 * TEXT ONLY — the scaffolder writes through `writeTextFile`, there is no binary
 * path. File names stay language-neutral; only the folder name is localized. */
export interface VaultTemplateRawFile {
  /** Vault-relative path incl. extension. */
  path: string;
  /** File content, written verbatim (no frontmatter, no interpolation). */
  content: string;
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
  /** Non-note files written as-is (attachments); never listed in index.md. */
  rawFiles?: VaultTemplateRawFile[];
  /** Per-vault settings wired after scaffolding. All keys optional: the
   * Journal template wires the full daily-notes trio, DB templates wire only
   * `templateFolder` so their "Neu" button finds the shipped note templates.
   * `taskDatabase` points the Tasks view at the template's own task database,
   * so its database section is populated from the first launch. */
  settings?: {
    dailyNotesFolder?: string;
    templateFolder?: string;
    dailyNoteTemplate?: string;
    /** Vault-relative `.base` path of the standard task database. */
    taskDatabase?: string;
  };
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

/** One link of a welcome-note section (a database or a key example note). */
export interface WelcomeLink {
  /** Link text — the database/note name as the reader sees it. */
  name: string;
  /** Vault-relative target incl. extension (`Projekte.base`, `Bereiche/Arbeit.md`). */
  path: string;
  description?: string;
}

/** A headed link list rendered between the folder bullets and the outro. */
export interface WelcomeSection {
  /** Localized H2 heading, e.g. "Deine Datenbanken". */
  heading: string;
  links: WelcomeLink[];
}

/**
 * Welcome-note body: intro, index-style folder bullets (URL-encoded), optional
 * link sections, outro.
 *
 * The folder bullets alone point at managed `index.md` files, which the graph
 * hides by default — a welcome note that links nothing else leaves the graph
 * looking empty. `sections` therefore carries direct links to the template's
 * databases and key notes, which DO become graph edges. Empty sections (and
 * sections without links) are omitted, so the six-argument-free call of older
 * templates renders exactly as before.
 */
export function welcomeBody(
  title: string,
  intro: string,
  folders: FolderLine[],
  outro: string,
  sections: WelcomeSection[] = []
): string {
  const bullets = folders
    .map((f) => `* [${f.name}](${encodeURI(`${f.name}/index.md`)}) - ${f.description}`)
    .join("\n");
  const blocks = sections
    .filter((s) => s.links.length > 0)
    .map((s) => {
      const links = s.links
        .map((l) => `* [${l.name}](${encodeURI(l.path)})${l.description ? ` - ${l.description}` : ""}`)
        .join("\n");
      return `## ${s.heading}\n\n${links}`;
    });
  return [`# ${title}`, intro, bullets, ...blocks, outro].join("\n\n") + "\n";
}
