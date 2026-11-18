import { format } from "date-fns";
import { ensureOkfFrontmatter, generateIndexContent, isSystemJunkName, STARTER_MANIFEST_PATH, starterHash, starterManifestText, upsertFrontmatterKeys } from "@plainva/core";
import { serializeBaseConfig } from "../base/baseFormat";
import type { VaultTemplateDefinition, VaultTemplateNote } from "./types";

/**
 * Shared vault-template scaffolder (M3E package I): the desktop's adapter-
 * abstracted writer, lifted so the mobile shell scaffolds the same starting
 * structures through its own adapter chain. Only a new, empty vault may be
 * scaffolded. Existing vaults never receive additions from a template; generated
 * listings are byte-identical to the index.md auto-updater's output.
 */

/** OKF type of scaffolded notes without an explicit one (desktop default). */
export const DEFAULT_SCAFFOLD_NOTE_TYPE = "Note";

/**
 * Scaffold-time date token: `{{today}}`, `{{today+3}}`, `{{today-1}}` → an
 * ISO date, resolved ONCE while the vault is created.
 *
 * This is deliberately a different token family from the note-template engine
 * (`{{date}}`, `{{daily±N}}`, `{{prompt:…}}` …), because the two resolve at
 * different moments: `{{today}}` when the VAULT is scaffolded, everything else
 * when a NOTE is created — the shipped note templates must keep their tokens
 * verbatim. Sample notes use it so the calendar, the 21-day timeline window and
 * the due dates are populated on day one instead of showing dates that age into
 * irrelevance a few weeks after a release.
 */
const TODAY_TOKEN = /\{\{today([+-]\d+)?\}\}/g;

/** Resolves `{{today±N}}` against `now`; every other `{{…}}` token is left alone. */
export function interpolateScaffoldDates(text: string, now: Date): string {
  return text.replace(TODAY_TOKEN, (_match, offset: string | undefined) => {
    const d = new Date(now);
    if (offset) d.setDate(d.getDate() + Number(offset));
    return format(d, "yyyy-MM-dd");
  });
}

/** Deep-resolves the token in every string of a frontmatter value. */
function interpolateValue(value: unknown, now: Date): unknown {
  if (typeof value === "string") return interpolateScaffoldDates(value, now);
  if (Array.isArray(value)) return value.map((v) => interpolateValue(v, now));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, interpolateValue(v, now)])
    );
  }
  return value;
}

/** A template note with `{{today±N}}` resolved in its path, text and properties. */
export function interpolateNote(note: VaultTemplateNote, now: Date): VaultTemplateNote {
  const out: VaultTemplateNote = {
    ...note,
    path: interpolateScaffoldDates(note.path, now),
    body: interpolateScaffoldDates(note.body, now),
  };
  if (note.description) out.description = interpolateScaffoldDates(note.description, now);
  if (note.properties) out.properties = interpolateValue(note.properties, now) as Record<string, unknown>;
  return out;
}

/** The minimal adapter surface the scaffolder needs (subset of IVaultAdapter). */
export interface ScaffoldAdapter {
  listDir(path?: string): Promise<{ name: string; isDirectory?: boolean }[]>;
  /** Read only for a file a failed attempt may have left (`scaffoldObstacle`); without it such a file is an obstacle. */
  readTextFile?(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/** Frontmatter (description + typed properties + OKF type) for a
 * scaffolded note. Description and properties are YAML-encoded via the surgical
 * writer (safe for wiki-links, lists, umlauts); OKF defaults are added on top. */
export function buildTemplateNoteContent(note: VaultTemplateNote): string {
  let content = note.body;
  const fm: Record<string, unknown> = {};
  if (note.description) fm.description = note.description;
  if (note.properties) Object.assign(fm, note.properties);
  if (Object.keys(fm).length > 0) content = upsertFrontmatterKeys(content, fm);
  return ensureOkfFrontmatter(content, { type: note.type ?? DEFAULT_SCAFFOLD_NOTE_TYPE }).content;
}

/** What a scaffold is told: the template and the names it writes with. */
export interface ScaffoldOptions {
  template: VaultTemplateDefinition | null;
  /** Heading of the root index.md (the vault folder's name). */
  vaultName: string;
  /** Localized heading of the subfolder sections (i18n `indexMd.subfoldersHeading`). */
  subfoldersHeading: string;
  /** Reference date for `{{today±N}}` (injected by tests; defaults to now). */
  now?: Date;
  /**
   * Remember what was written as starter content (starterFiles.ts in the
   * core), so none of it goes into a cloud folder the vault is connected to
   * later. False for a vault created to go online at once: its template is
   * what the person asked that new folder to hold.
   */
  recordStarter?: boolean;
}

/**
 * Everything a scaffold writes, in the order it writes it: the template's
 * folders, then each file with its exact text — notes, databases,
 * attachments, the managed index.md of every folder, the starter record last.
 */
export interface ScaffoldPlan {
  folders: string[];
  files: Array<{ path: string; content: string }>;
}

/** The plan of `scaffoldVaultTemplate` for these options — the one place its output is decided. */
export function planVaultScaffold(opts: ScaffoldOptions): ScaffoldPlan {
  const { template, vaultName, subfoldersHeading } = opts;
  const now = opts.now ?? new Date();
  const folders = template?.folders ?? [];
  // Resolved once, up front: the listings below must show the SAME paths and
  // descriptions that are written to disk.
  const notes = (template?.notes ?? []).map((n) => interpolateNote(n, now));
  const files: Array<{ path: string; content: string }> = [];
  const add = (path: string, content: string) => {
    if (!files.some((f) => f.path === path)) files.push({ path, content });
  };
  for (const note of notes) add(note.path, buildTemplateNoteContent(note));
  // `.base` databases: serialized to Obsidian-native YAML, byte-identical to
  // an app save. `.base` files are not notes, so they never appear in the
  // index.md listings below.
  for (const base of template?.bases ?? []) add(base.path, serializeBaseConfig(base.config));
  // Attachments (SVG illustrations): written verbatim, no frontmatter, no
  // interpolation. They are not notes, so — like `.base` files — they never
  // appear in the index.md listings below; the app's own index generator lists
  // Markdown only, so a scaffold that listed them would be rewritten by the
  // first auto-update.
  for (const file of template?.rawFiles ?? []) add(file.path, file.content);
  // Managed index.md for the bundle root and every template folder (SPEC §11:
  // only the root carries okf_version; all listings get the managed marker).
  for (const folder of ["", ...folders]) {
    const indexPath = folder ? `${folder}/index.md` : "index.md";
    const prefix = folder ? `${folder}/` : "";
    const listed = notes
      .filter((n) => n.path.startsWith(prefix) && !n.path.slice(prefix.length).includes("/"))
      .map((n) => ({ path: n.path, description: n.description }));
    const subfolders = folders
      .filter((f) => f !== folder && f.startsWith(prefix) && !f.slice(prefix.length).includes("/"))
      // Every template folder gets its own managed index.md (loop above), so
      // each listed subfolder always has one to link to (Issue #9).
      .map((f) => ({ name: f.slice(prefix.length), hasIndex: true }));
    add(indexPath, generateIndexContent({
      folder,
      heading: folder ? folder.split("/").pop()! : vaultName,
      files: listed,
      subfolders,
      subfoldersHeading,
      bundleRoot: folder === "",
      managedMarker: true,
    }));
  }
  // An empty record for a vault made to go online: nothing in it is held back,
  // and it is not recognised as starter content later either.
  const record: Record<string, string> = {};
  if (opts.recordStarter !== false) for (const f of files) record[f.path] = starterHash(f.content);
  files.push({ path: STARTER_MANIFEST_PATH, content: starterManifestText(record) });
  return { folders, files };
}

/** The two reads `scaffoldObstacle` needs — any vault adapter has them. */
export interface ScaffoldReader {
  listDir(path?: string): Promise<{ name: string; isDirectory?: boolean }[]>;
  /** Without it, every file already there is an obstacle. */
  readTextFile?(path: string): Promise<string>;
}

/**
 * What stands in the way of writing `plan` into a vault, or null when nothing
 * does (fourth review of O8): a folder the plan makes holds nothing but what
 * the plan writes. A file with exactly the text the plan gives it is a file a
 * failed attempt left behind — no obstacle, so a new attempt goes through
 * where the take-back could not remove everything. Anything else is: a file
 * of someone else's, a file whose text differs, a folder the plan does not
 * make, a folder or file that cannot be read. Operating-system bookkeeping
 * does not count (the core's one list, E10). The root's own listing failing
 * throws: an unreadable destination is not permission to write.
 */
export async function scaffoldObstacle(reader: ScaffoldReader, plan: ScaffoldPlan): Promise<string | null> {
  const files = new Map(plan.files.map((f) => [f.path, f.content]));
  const folders = new Set<string>(plan.folders);
  for (const f of plan.files) for (let i = f.path.indexOf("/"); i > 0; i = f.path.indexOf("/", i + 1)) folders.add(f.path.slice(0, i));
  const walk = async (dir: string, entries: { name: string; isDirectory?: boolean }[]): Promise<string | null> => {
    for (const entry of entries) {
      if (isSystemJunkName(entry.name)) continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (folders.has(path) && entry.isDirectory !== false) {
        let inner: { name: string; isDirectory?: boolean }[];
        try {
          inner = await reader.listDir(path);
        } catch {
          // silent: a folder that cannot be listed is not known to hold only the plan's files — it stands in the way
          return path;
        }
        const found = await walk(path, inner);
        if (found !== null) return found;
        continue;
      }
      const planned = files.get(path);
      if (planned === undefined || entry.isDirectory === true) return path;
      if (!reader.readTextFile) return path;
      try {
        if ((await reader.readTextFile(path)) !== planned) return path;
      } catch {
        // silent: a file that cannot be read is not known to be the plan's — it stands in the way
        return path;
      }
    }
    return null;
  };
  return walk("", await reader.listDir(""));
}

/** The scaffolder refuses a vault that holds anything but what it would write. */
export class VaultNotEmptyError extends Error {
  constructor(readonly obstacle: string | null) {
    super("Vault templates can only be used when creating a new, empty vault.");
    this.name = "VaultNotEmptyError";
  }
}

/**
 * Writes the template structure (or, with `template: null`, just the bundle
 * root index.md) into the vault folder.
 */
export async function scaffoldVaultTemplate(opts: ScaffoldOptions & {
  adapter: ScaffoldAdapter;
  /** Creation-flow intent, never inferred from missing template files. */
  isNewVault: boolean;
}): Promise<void> {
  const { adapter } = opts;
  const plan = planVaultScaffold(opts);
  // Check before ANY write, including settings in the callers. A missing or
  // unreadable listing is not permission to fill gaps in a user's vault. What
  // a failed attempt left with exactly the text this one writes is no
  // obstacle (`scaffoldObstacle`); anything else is.
  if (!opts.isNewVault) throw new VaultNotEmptyError(null);
  const obstacle = await scaffoldObstacle(adapter, plan);
  if (obstacle !== null) throw new VaultNotEmptyError(obstacle);

  for (const folder of plan.folders) {
    if (!(await adapter.exists(folder))) await adapter.createDir(folder);
  }
  // The starter record is written last and always: it says what the files before it are.
  const record = plan.files[plan.files.length - 1]!;
  for (const file of plan.files.slice(0, -1)) {
    // There already means: left by a failed attempt, with exactly this text (checked above).
    if (await adapter.exists(file.path)) continue;
    await adapter.writeTextFile(file.path, file.content);
  }
  if (!(await adapter.exists(".plainva"))) await adapter.createDir(".plainva");
  await adapter.writeTextFile(record.path, record.content);
}
