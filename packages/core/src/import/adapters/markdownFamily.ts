import {
  DEFAULT_IMPORT_LABELS,
  ImportFamily,
  ImportOptions,
  ImportPlan,
  ImportReport,
  ImportSource,
  ImportSourceId,
  SourceTimestamps,
  UnpackedFile,
  isTextEntry,
} from '../ImportTypes.js';
import { copyArchiveAttachments } from '../archiveAttachments.js';
import { ImportWriter } from '../ImportWriter.js';
import { timesFromFile } from '../sourceTimes.js';

/**
 * The shared body of every "Markdown plus frontmatter in a ZIP" importer.
 *
 * A dozen apps export the same thing in the same shape, and what separates
 * them is small: which folder holds the pictures, which frontmatter key means
 * "created", whether the same note appears in two notebooks. Writing an
 * adapter per app would have meant twelve copies of the loop that already
 * exists — and twelve places to fix the next writer bug. A subclass here says
 * only what makes its app different.
 *
 * Two rules the family enforces on itself:
 *
 * 1. **`detect` may only answer yes to a real signature.** Every one of these
 *    exports is "a folder of Markdown" to anyone who looks; a guessed
 *    signature would silently claim another app's export. Where an app leaves
 *    no fingerprint, `detect` says no and the user picks the tile — which is
 *    what the tiles are for.
 * 2. **Nothing is invented.** A mapping exists only where the app's own
 *    documentation says what it writes.
 */
export interface MappedNote {
  /** Path inside the import; return null to leave the entry alone. */
  relativePath: string;
  content: string;
  times?: SourceTimestamps;
  details?: string;
}

/** Frontmatter key spellings the family reads for the source dates. */
const CREATED_KEYS = ['created', 'created at', 'createdat', 'created_at', 'date created'];
const UPDATED_KEYS = ['updated', 'updated at', 'updatedat', 'updated_at', 'modified', 'last modified'];

/**
 * Reads created/updated out of a note's own frontmatter.
 *
 * These exports put the dates in the file rather than on it, and the file's
 * own mtime is the moment the ZIP was written — the same instant for every
 * note in the export, which is exactly the flattened time axis P1.2 set out to
 * avoid. Spellings differ per app, so the lookup is case- and separator-blind.
 */
export function frontmatterTimes(content: string): SourceTimestamps | undefined {
  if (!content.startsWith('---')) return undefined;
  const end = content.indexOf('\n---', 3);
  if (end < 0) return undefined;

  let createdMs: number | undefined;
  let modifiedMs: number | undefined;

  for (const line of content.slice(3, end).split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase().replace(/^["']|["']$/g, '');
    const raw = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    if (!raw) continue;
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) continue;
    if (createdMs === undefined && CREATED_KEYS.includes(key)) createdMs = parsed;
    else if (modifiedMs === undefined && UPDATED_KEYS.includes(key)) modifiedMs = parsed;
  }

  if (createdMs === undefined && modifiedMs === undefined) return undefined;
  return { createdMs, modifiedMs };
}

export abstract class MarkdownFamilyImporter implements ImportSource {
  abstract readonly id: ImportSourceId;
  abstract readonly name: string;
  abstract readonly description: string;
  readonly family: ImportFamily = 'markdown';

  /**
   * Above the generic fallback, below the sources with a hard signature.
   *
   * A subclass without a signature never wins a detection anyway; the rank
   * only orders the ones that do.
   */
  readonly detectPriority: number = 5;

  readonly options = [{ key: 'preserveTimestamps' as const, defaultValue: true }];
  readonly pickModes = ['files', 'folder'] as const;

  /** Whether this export carries something only this app writes. */
  protected abstract signature(files: UnpackedFile[]): boolean;

  /**
   * Where a text entry goes and what it says. `null` drops it — which is the
   * right answer for an app's own metadata sidecar.
   */
  protected mapNote(file: UnpackedFile): MappedNote | null {
    if (!file.relativePath.toLowerCase().endsWith('.md')) return null;
    return {
      relativePath: file.relativePath,
      content: file.content ?? '',
      times: frontmatterTimes(file.content ?? '') ?? timesFromFile(file),
    };
  }

  /** Rewrites an attachment's position; the default keeps it where it was. */
  protected mapAttachmentPath(relativePath: string): string {
    return relativePath;
  }

  /** Notes this export writes more than once; the base drops the repeats. */
  protected readonly dedupeByContent: boolean = false;

  /**
   * A text entry that is the app's own bookkeeping and belongs in no vault.
   *
   * Everything else that is not a note is written through as a file. Dropping
   * it would be the quiet kind of loss this importer exists to avoid: a
   * Capacities collection CSV is the user's data, even when Plainva has
   * nothing clever to do with it yet.
   */
  protected shouldDrop(_file: UnpackedFile): boolean {
    return false;
  }

  async detect(input: any): Promise<boolean> {
    if (!Array.isArray(input)) return false;
    const files = input.filter((f: any) => typeof f?.relativePath === 'string') as UnpackedFile[];
    if (files.length === 0) return false;
    return this.signature(files);
  }

  async analyze(input: UnpackedFile[], _opts: ImportOptions): Promise<ImportPlan> {
    const files = Array.isArray(input) ? input : [];
    const notes = files.filter((f) => isTextEntry(f) && this.mapNote(f) !== null);
    const attachments = files.filter((f) => !isTextEntry(f));
    const totalBytes = files.reduce((acc, f) => acc + (f.byteSize ?? (f.content ? f.content.length : 0)), 0);

    const warnings: string[] = [];
    if (notes.length === 0) warnings.push('No notes found in the selection.');

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes.length,
      totalAttachments: attachments.length,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings,
      requiredSpaceBytes: totalBytes,
      estimatedDurationSec: Math.max(1, Math.ceil(notes.length / 50)),
    };
  }

  async run(
    input: UnpackedFile[],
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const files = Array.isArray(input) ? input : [];
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();

    const attachments = await copyArchiveAttachments(files, writer, opts, labels, (rel) =>
      this.mapAttachmentPath(rel)
    );
    if (attachments.lost > 0) writer.noteLimitation(labels.limitBinaryFilesInZip);

    return writer.runGuarded(this, startTime, async () => {
      /** Content already written -> the note it landed in. */
      const seen = new Map<string, string>();

      for (let i = 0; i < files.length; i += 1) {
        writer.abortIfRequested();
        const file = files[i];
        if (!file?.relativePath) continue;
        // Attachments were handled before the loop; a non-text entry here has
        // already been copied or reported.
        if (!isTextEntry(file)) continue;

        try {
          if (this.shouldDrop(file)) continue;

          const mapped = this.mapNote(file);
          if (!mapped) {
            // Not a note, but still the user's file — a collection CSV, a
            // stylesheet, whatever the app put beside the notes.
            await writer.writeFile(
              file.relativePath,
              file.content ?? '',
              'attachment',
              undefined,
              timesFromFile(file)
            );
            continue;
          }

          if (this.dedupeByContent) {
            const previous = seen.get(mapped.content);
            if (previous) {
              // The same note filed under two notebooks is one note, exported
              // twice. Keeping both would make the vault look like the user
              // wrote it twice.
              writer.recordSkipped(mapped.relativePath, `${labels.skippedDuplicate}: ${previous}`);
              continue;
            }
          }

          const written = await writer.writeNote(mapped.relativePath, mapped.content, {
            details: mapped.details,
            times: mapped.times,
          });
          if (this.dedupeByContent) seen.set(mapped.content, written);
        } catch (error) {
          writer.recordFailure(file.relativePath, error);
        }

        if (onProgress && files.length > 0) {
          onProgress(Math.round(((i + 1) / files.length) * 100), `Importing ${file.relativePath}...`);
        }
      }
    });
  }
}

/**
 * Joplin, exported as "Markdown + Front Matter".
 *
 * Signature: the export puts every attachment in a top-level `_resources/`
 * folder and nothing else does. The notes keep their notebook folders and
 * their YAML frontmatter (Title, Source, Created, Updated, Tags), and their
 * links into `_resources/` are relative — so leaving both where they are is
 * what makes the pictures still show.
 */
export class JoplinImporter extends MarkdownFamilyImporter {
  readonly id: ImportSourceId = 'joplin';
  readonly name = 'Joplin (Markdown + Front Matter)';
  readonly description = 'Imports a Joplin Markdown export with its notebooks, frontmatter and resources.';
  readonly detectPriority = 20;

  protected signature(files: UnpackedFile[]): boolean {
    const hasResources = files.some((f) => /(^|\/)_resources\//.test(f.relativePath));
    const hasMarkdown = files.some((f) => f.relativePath.toLowerCase().endsWith('.md'));
    return hasResources && hasMarkdown;
  }
}

/**
 * Bear, exported as TextBundle.
 *
 * A `.textbundle` is a folder: `text.markdown` plus an `assets/` folder and an
 * `info.json` nobody needs in a vault. The note comes out as `Note.md` and its
 * pictures move to `Note/assets/`, which means the bundle's own `assets/…`
 * links have to be repointed — the one rewrite in this family, and only
 * because the alternative is every bundle's pictures colliding in one folder.
 */
export class BearImporter extends MarkdownFamilyImporter {
  readonly id: ImportSourceId = 'bear';
  readonly name = 'Bear (TextBundle)';
  readonly description = 'Imports Bear notes exported as TextBundle, with their images.';
  readonly detectPriority = 20;

  protected signature(files: UnpackedFile[]): boolean {
    return files.some((f) => f.relativePath.includes('.textbundle/'));
  }

  /** `Note.textbundle/assets/x.png` -> `Note/assets/x.png`. */
  protected mapAttachmentPath(relativePath: string): string {
    return relativePath.replace(/\.textbundle\//, '/');
  }

  /** `info.json` and friends describe the bundle, not the note inside it. */
  protected shouldDrop(file: UnpackedFile): boolean {
    return (
      file.relativePath.includes('.textbundle/') &&
      !/\.textbundle\/text\.(markdown|md)$/.test(file.relativePath)
    );
  }

  protected mapNote(file: UnpackedFile): MappedNote | null {
    const match = file.relativePath.match(/^(.*)\.textbundle\/text\.(markdown|md)$/);
    if (!match) return super.mapNote(file);

    const stem = match[1];
    const name = stem.slice(stem.lastIndexOf('/') + 1);
    const content = (file.content ?? '').replace(/\]\(assets\//g, `](${name}/assets/`);

    return {
      relativePath: `${stem}.md`,
      content,
      times: frontmatterTimes(content) ?? timesFromFile(file),
    };
  }
}

/**
 * Notesnook's Markdown export.
 *
 * Signature: Notesnook prefixes every exported image with an xxh64 hash so
 * two notes cannot collide on a file name — sixteen hex characters and a
 * dash, which nothing else writes.
 *
 * A note filed in two notebooks is exported into both folders. Importing both
 * would make the vault look like it was written twice, so repeats are dropped
 * and named in the report.
 */
export class NotesnookImporter extends MarkdownFamilyImporter {
  readonly id: ImportSourceId = 'notesnook';
  readonly name = 'Notesnook (Markdown)';
  readonly description = 'Imports a Notesnook Markdown export; a note filed in two notebooks is imported once.';
  readonly detectPriority = 15;
  protected readonly dedupeByContent = true;

  protected signature(files: UnpackedFile[]): boolean {
    const hashedImage = /(^|\/)[0-9a-f]{16}-[^/]+\.(png|jpe?g|gif|webp|svg)$/i;
    return (
      files.some((f) => hashedImage.test(f.relativePath)) &&
      files.some((f) => f.relativePath.toLowerCase().endsWith('.md'))
    );
  }
}

/**
 * Capacities' Markdown export.
 *
 * Its properties become frontmatter and its collections are written as CSV
 * files next to the notes. Those CSVs come across as files: turning them into
 * `.base` databases would mean guessing which collection belongs to which
 * folder, and a wrong guess writes a database the user then has to undo.
 *
 * No signature: the export is Markdown, frontmatter and CSV, which is what
 * half a dozen other apps write too. Picked from the tile, not detected.
 */
export class CapacitiesImporter extends MarkdownFamilyImporter {
  readonly id: ImportSourceId = 'capacities';
  readonly name = 'Capacities (Markdown export)';
  readonly description = 'Imports a Capacities export: notes with their properties as frontmatter, media and collection CSVs.';

  protected signature(): boolean {
    return false;
  }
}

/**
 * Amplenote's Markdown export.
 *
 * Notes as Markdown with the note name as the file name, their metadata as
 * YAML frontmatter, and the uploaded images in the same ZIP. Nothing in that
 * is unique to Amplenote, so it is picked from the tile rather than detected.
 */
export class AmplenoteImporter extends MarkdownFamilyImporter {
  readonly id: ImportSourceId = 'amplenote';
  readonly name = 'Amplenote (Markdown export)';
  readonly description = 'Imports an Amplenote Markdown export with its frontmatter and images.';

  protected signature(): boolean {
    return false;
  }
}

/**
 * Supernotes' Markdown export.
 *
 * Cards as Markdown with their metadata beside them. The metadata files come
 * across as files rather than being read: what exactly Supernotes writes into
 * them is not documented well enough to map, and a mapping built on a guess
 * would put wrong values into somebody's frontmatter. No signature either —
 * picked from the tile.
 */
export class SupernotesImporter extends MarkdownFamilyImporter {
  readonly id: ImportSourceId = 'supernotes';
  readonly name = 'Supernotes (Markdown export)';
  readonly description = 'Imports a Supernotes Markdown export with its cards and the metadata files beside them.';

  protected signature(): boolean {
    return false;
  }
}

/**
 * Heptabase's Markdown export.
 *
 * Cards as Markdown with YAML frontmatter, which the family already reads for
 * the dates. The whiteboards themselves are Heptabase's own spatial layer and
 * have no counterpart here — what comes across is the writing, not the canvas.
 */
export class HeptabaseImporter extends MarkdownFamilyImporter {
  readonly id: ImportSourceId = 'heptabase';
  readonly name = 'Heptabase (Markdown export)';
  readonly description = 'Imports a Heptabase Markdown export: the cards with their frontmatter. Whiteboard layout is not carried over.';

  protected signature(): boolean {
    return false;
  }
}

/** UpNote's Markdown export: notes and their folders, nothing app-specific. */
export class UpNoteImporter extends MarkdownFamilyImporter {
  readonly id: ImportSourceId = 'upnote';
  readonly name = 'UpNote (Markdown export)';
  readonly description = 'Imports an UpNote Markdown export with its notebooks and attachments.';

  protected signature(): boolean {
    return false;
  }
}

/** Craft's Markdown export: documents plus the assets they reference. */
export class CraftImporter extends MarkdownFamilyImporter {
  readonly id: ImportSourceId = 'craft';
  readonly name = 'Craft (Markdown export)';
  readonly description = 'Imports a Craft Markdown export with its documents and assets.';

  protected signature(): boolean {
    return false;
  }
}

/**
 * Anytype's Markdown export.
 *
 * Objects as Markdown with their relations as frontmatter. Anytype's own
 * object types have no equivalent on the way in — a note is a note here — so
 * the type survives as a frontmatter value rather than as structure.
 */
export class AnytypeImporter extends MarkdownFamilyImporter {
  readonly id: ImportSourceId = 'anytype';
  readonly name = 'Anytype (Markdown export)';
  readonly description = 'Imports an Anytype Markdown export: objects with their relations as frontmatter.';

  protected signature(): boolean {
    return false;
  }
}
