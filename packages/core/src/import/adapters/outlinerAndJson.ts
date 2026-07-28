import { XMLParser } from 'fast-xml-parser';
import {
  DEFAULT_IMPORT_LABELS,
  ImportFamily,
  ImportOptions,
  ImportPlan,
  ImportReport,
  ImportSource,
  ImportSourceId,
  UnpackedFile,
  isTextEntry,
} from '../ImportTypes.js';
import { htmlToMarkdown } from '../../pim/htmlToMarkdown.js';
import { copyArchiveAttachments } from '../archiveAttachments.js';
import { ImportWriter } from '../ImportWriter.js';
import { timesFromFile } from '../sourceTimes.js';

/** A file name that survives every platform, with a fallback for the empty case. */
function safeName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, '_')
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 0x20)
    .join('')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 90) : fallback;
}

/* ------------------------------------------------------------------ *
 * Standard Notes
 * ------------------------------------------------------------------ */

/**
 * Standard Notes' decrypted JSON backup.
 *
 * The export is one file: an `items` array in which everything is an item —
 * notes, tags, settings, editor components. Only `Note` items are notes, and
 * the tags they belong to are separate items that point back at them, which is
 * why the tags are resolved in a second pass rather than read off the note.
 *
 * An ENCRYPTED backup is not importable and must say so: its items carry
 * ciphertext instead of a title, and importing them would produce a vault full
 * of base64. The importer refuses it with a reason instead.
 */
export class StandardNotesImporter implements ImportSource {
  readonly id: ImportSourceId = 'standard_notes';
  readonly name = 'Standard Notes (JSON backup)';
  readonly family: ImportFamily = 'json';
  readonly description = 'Imports a decrypted Standard Notes backup: notes, their titles and their tags.';
  readonly detectPriority = 35;
  readonly options = [{ key: 'preserveTimestamps' as const, defaultValue: true }];
  readonly pickModes = ['files'] as const;

  private parse(input: any): { items: any[]; encrypted: boolean } {
    const texts: string[] = [];
    if (Array.isArray(input)) {
      for (const file of input) {
        if (typeof file?.content === 'string' && isTextEntry(file)) texts.push(file.content);
      }
    } else if (typeof input === 'string') {
      texts.push(input);
    } else if (input && typeof input === 'object') {
      return { items: Array.isArray(input.items) ? input.items : [], encrypted: false };
    }

    for (const text of texts) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed?.items)) {
          const encrypted = parsed.items.some(
            (i: any) => typeof i?.content === 'string' && i.content.startsWith('00')
          );
          return { items: parsed.items, encrypted };
        }
      } catch {
        // Not this file.
      }
    }
    return { items: [], encrypted: false };
  }

  private notesOf(items: any[]): any[] {
    return items.filter((i) => i?.content_type === 'Note' && i.content && typeof i.content === 'object');
  }

  /** uuid -> tag titles, from the tag items that reference the notes. */
  private tagIndex(items: any[]): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const item of items) {
      if (item?.content_type !== 'Tag' || !item.content) continue;
      const title = typeof item.content.title === 'string' ? item.content.title : '';
      if (!title) continue;
      for (const ref of item.content.references ?? []) {
        if (ref?.content_type !== 'Note' || typeof ref.uuid !== 'string') continue;
        const list = index.get(ref.uuid) ?? [];
        list.push(title);
        index.set(ref.uuid, list);
      }
    }
    return index;
  }

  async detect(input: any): Promise<boolean> {
    const { items } = this.parse(input);
    return items.some((i: any) => typeof i?.content_type === 'string');
  }

  async analyze(input: any, _opts: ImportOptions): Promise<ImportPlan> {
    const { items, encrypted } = this.parse(input);
    const notes = this.notesOf(items);

    const warnings: string[] = [];
    if (encrypted) {
      warnings.push(
        'This backup is encrypted. Export a decrypted backup from Standard Notes and select that file.'
      );
    } else if (notes.length === 0) {
      warnings.push('No Standard Notes notes found in the selection.');
    }

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes.length,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings,
      requiredSpaceBytes: notes.reduce((acc, n) => acc + (n.content?.text?.length ?? 0), 0),
      estimatedDurationSec: Math.max(1, Math.ceil(notes.length / 50)),
    };
  }

  async run(
    input: any,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const { items, encrypted } = this.parse(input);
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();

    return writer.runGuarded(this, startTime, async () => {
      if (encrypted) {
        // Nothing readable in here; writing the ciphertext out as notes would
        // be worse than importing nothing.
        writer.recordSkipped(
          this.name,
          'the backup is encrypted — export a decrypted backup and import that'
        );
        return;
      }

      const notes = this.notesOf(items);
      const tags = this.tagIndex(items);

      for (let i = 0; i < notes.length; i += 1) {
        writer.abortIfRequested();
        const item = notes[i];
        const title = (item.content.title || '').trim() || `Note ${i + 1}`;
        const noteTags = tags.get(item.uuid) ?? [];

        try {
          const lines: string[] = [];
          if (noteTags.length > 0) {
            lines.push('---', 'tags:');
            for (const tag of noteTags) lines.push(`  - ${tag.replace(/\s+/g, '_')}`);
            lines.push('---', '');
          }
          lines.push(`# ${title}`, '', item.content.text ?? '');

          await writer.writeNote(`${safeName(title, `Note ${i + 1}`)}.md`, lines.join('\n'), {
            times: {
              createdMs: Date.parse(item.created_at ?? '') || undefined,
              modifiedMs: Date.parse(item.updated_at ?? '') || undefined,
            },
          });
        } catch (error) {
          writer.recordFailure(title, error);
        }

        if (onProgress && notes.length > 0) {
          onProgress(Math.round(((i + 1) / notes.length) * 100), `Importing ${title}...`);
        }
      }
    });
  }
}

/* ------------------------------------------------------------------ *
 * Workflowy / Dynalist (OPML)
 * ------------------------------------------------------------------ */

interface OutlineNode {
  text: string;
  note?: string;
  children: OutlineNode[];
}

/** Attributes are the whole payload of an OPML outline, so they are kept. */
const opmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // A single child and a list of children must have the same shape, or every
  // consumer needs two code paths.
  isArray: (name) => name === 'outline',
});

/** Reads `<body>`'s outlines out of an OPML document. */
export function parseOpml(xml: string): OutlineNode[] {
  const doc = opmlParser.parse(xml);
  const body = doc?.opml?.body;
  if (!body) return [];

  const toNode = (raw: any): OutlineNode => ({
    text: typeof raw?.['@text'] === 'string' ? raw['@text'] : '',
    note: typeof raw?.['@_note'] === 'string' ? raw['@_note'] : undefined,
    children: Array.isArray(raw?.outline) ? raw.outline.map(toNode) : [],
  });

  return Array.isArray(body.outline) ? body.outline.map(toNode) : [];
}

/**
 * One outline branch as nested Markdown bullets.
 *
 * An outliner has no notion of a "note", so the top level of the export
 * becomes one note each and everything under it becomes the bullets it
 * already was. Flattening the whole export into one file would produce a
 * document nobody can navigate; a note per bullet would produce thousands.
 */
export function outlineToMarkdown(node: OutlineNode, depth = 0): string {
  const lines: string[] = [];
  const indent = '  '.repeat(depth);
  if (node.text) lines.push(`${indent}- ${node.text}`);
  if (node.note) {
    for (const line of node.note.split('\n')) lines.push(`${indent}  ${line}`);
  }
  for (const child of node.children) lines.push(outlineToMarkdown(child, depth + 1));
  return lines.join('\n');
}

export class OpmlOutlinerImporter implements ImportSource {
  readonly id: ImportSourceId = 'workflowy';
  readonly name = 'Workflowy / Dynalist (OPML)';
  readonly family: ImportFamily = 'opml';
  readonly description = 'Imports an OPML outline export: every top-level item becomes a note, its children become nested bullets.';
  readonly detectPriority = 35;
  readonly options = [{ key: 'preserveTimestamps' as const, defaultValue: true }];
  readonly pickModes = ['files', 'folder'] as const;

  private opmlFiles(input: any): UnpackedFile[] {
    if (!Array.isArray(input)) return [];
    return input.filter(
      (f: any) =>
        typeof f?.relativePath === 'string' &&
        isTextEntry(f) &&
        (/\.opml$/i.test(f.relativePath) || (typeof f.content === 'string' && f.content.includes('<opml')))
    );
  }

  async detect(input: any): Promise<boolean> {
    return this.opmlFiles(input).some((f) => typeof f.content === 'string' && f.content.includes('<opml'));
  }

  async analyze(input: any, _opts: ImportOptions): Promise<ImportPlan> {
    const files = this.opmlFiles(input);
    let notes = 0;
    for (const file of files) {
      try {
        notes += parseOpml(file.content ?? '').length;
      } catch {
        // A malformed file is reported by the run, not counted here.
      }
    }

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings: notes === 0 ? ['No OPML outlines found in the selection.'] : [],
      requiredSpaceBytes: files.reduce((acc, f) => acc + (f.content?.length ?? 0), 0),
      estimatedDurationSec: Math.max(1, Math.ceil(notes / 50)),
    };
  }

  async run(
    input: any,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const files = this.opmlFiles(input);
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();

    return writer.runGuarded(this, startTime, async () => {
      let done = 0;
      for (const file of files) {
        writer.abortIfRequested();
        let roots: OutlineNode[];
        try {
          roots = parseOpml(file.content ?? '');
        } catch (error) {
          writer.recordFailure(file.relativePath, error);
          continue;
        }

        // Several documents in one selection keep their file names as folders,
        // so two Dynalist documents cannot overwrite each other's items.
        const folder = files.length > 1 ? `${file.relativePath.replace(/\.opml$/i, '')}/` : '';

        for (let i = 0; i < roots.length; i += 1) {
          writer.abortIfRequested();
          const root = roots[i];
          const title = root.text.trim() || `Outline ${i + 1}`;
          try {
            const body = root.children.map((c) => outlineToMarkdown(c)).join('\n');
            const note = root.note ? `${root.note}\n\n${body}` : body;
            await writer.writeNote(`${folder}${safeName(title, `Outline ${i + 1}`)}.md`, `# ${title}\n\n${note}\n`, {
              times: timesFromFile(file),
            });
          } catch (error) {
            writer.recordFailure(title, error);
          }
          done += 1;
          if (onProgress) onProgress(Math.min(99, done), `Importing ${title}...`);
        }
      }
    });
  }
}

/* ------------------------------------------------------------------ *
 * Trilium
 * ------------------------------------------------------------------ */

/**
 * A Trilium subtree export.
 *
 * Recognised by `!!!meta.json`, the manifest Trilium writes into every export
 * and nothing else writes at all. The notes come as HTML or Markdown in the
 * folder structure of the subtree; HTML goes through the same converter the
 * calendar uses, which works without a DOM.
 */
export class TriliumImporter implements ImportSource {
  readonly id: ImportSourceId = 'trilium';
  readonly name = 'Trilium (subtree export)';
  readonly family: ImportFamily = 'markdown';
  readonly description = 'Imports a Trilium subtree export with its note tree and attachments.';
  readonly detectPriority = 30;
  readonly options = [{ key: 'preserveTimestamps' as const, defaultValue: true }];
  readonly pickModes = ['files', 'folder'] as const;

  private files(input: any): UnpackedFile[] {
    return Array.isArray(input) ? input.filter((f: any) => typeof f?.relativePath === 'string') : [];
  }

  async detect(input: any): Promise<boolean> {
    return this.files(input).some((f) => f.relativePath.endsWith('!!!meta.json'));
  }

  async analyze(input: any, _opts: ImportOptions): Promise<ImportPlan> {
    const files = this.files(input);
    const notes = files.filter((f) => isTextEntry(f) && /\.(html?|md)$/i.test(f.relativePath));
    const attachments = files.filter((f) => !isTextEntry(f));

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes.length,
      totalAttachments: attachments.length,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings: notes.length === 0 ? ['No Trilium notes found in the selection.'] : [],
      requiredSpaceBytes: files.reduce((acc, f) => acc + (f.byteSize ?? f.content?.length ?? 0), 0),
      estimatedDurationSec: Math.max(1, Math.ceil(notes.length / 50)),
    };
  }

  async run(
    input: any,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const files = this.files(input);
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();

    const attachments = await copyArchiveAttachments(files, writer, opts, labels);
    if (attachments.lost > 0) writer.noteLimitation(labels.limitBinaryFilesInZip);

    return writer.runGuarded(this, startTime, async () => {
      for (let i = 0; i < files.length; i += 1) {
        writer.abortIfRequested();
        const file = files[i];
        if (!isTextEntry(file)) continue;
        // The manifest describes the export; it is not one of the notes.
        if (file.relativePath.endsWith('!!!meta.json')) continue;

        try {
          const isHtml = /\.html?$/i.test(file.relativePath);
          const isMd = /\.md$/i.test(file.relativePath);
          if (!isHtml && !isMd) {
            await writer.writeFile(file.relativePath, file.content ?? '', 'attachment', undefined, timesFromFile(file));
            continue;
          }

          const target = isHtml ? file.relativePath.replace(/\.html?$/i, '.md') : file.relativePath;
          const content = isHtml ? htmlToMarkdown(file.content ?? '') : file.content ?? '';
          await writer.writeNote(target, content, { times: timesFromFile(file) });
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
