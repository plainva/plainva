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
import { ImportWriter } from '../ImportWriter.js';

export type LogseqFile = UnpackedFile;

/**
 * Copies a Logseq file graph across as-is.
 *
 * Deliberately verbatim: `key:: value` properties and block references are NOT
 * converted. Logseq's outline model does not map onto Markdown notes without
 * lossy guesswork, so the files are preserved unchanged and the report says so.
 */
export class LogseqImporter implements ImportSource {
  readonly id: ImportSourceId = 'logseq';
  readonly name = 'Logseq file graph';
  readonly family: ImportFamily = 'markdown';
  readonly description = 'Copies Logseq notes (journals/ & pages/) across unchanged.';

  async detect(input: any): Promise<boolean> {
    if (Array.isArray(input)) {
      return input.some((f: any) => typeof f.relativePath === 'string' && (f.relativePath.startsWith('journals/') || f.relativePath.startsWith('pages/') || f.relativePath.endsWith('.md')));
    }
    return false;
  }

  async analyze(input: LogseqFile[], opts: ImportOptions): Promise<ImportPlan> {
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const files = Array.isArray(input) ? input : [];
    const notes = files.filter(f => typeof f.relativePath === 'string' && (f.relativePath.endsWith('.md') || f.relativePath.endsWith('.org')));

    const warnings: string[] = [];
    if (notes.length === 0) warnings.push('No Logseq Markdown/Org files found in the selection.');
    warnings.push(labels.limitLogseqVerbatim);

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes.length,
      totalAttachments: files.length - notes.length,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings,
      requiredSpaceBytes: files.reduce((acc, f) => acc + (f.content?.length || 0), 0),
      estimatedDurationSec: Math.max(1, Math.ceil(notes.length / 50)),
    };
  }

  async run(
    input: LogseqFile[],
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const files = Array.isArray(input) ? input : [];
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();
    writer.noteLimitation(labels.limitLogseqVerbatim);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file || !file.relativePath) continue;

      const isNote = file.relativePath.endsWith('.md') || file.relativePath.endsWith('.org');
      if (!isTextEntry(file)) {
        writer.recordSkipped(file.relativePath, labels.skippedAttachment);
      } else if (isNote) {
        await writer.writeNote(file.relativePath, file.content ?? '');
      } else {
        await writer.writeFile(file.relativePath, file.content ?? '');
      }

      if (onProgress && files.length > 0) {
        onProgress(Math.round(((i + 1) / files.length) * 100), `Importing Logseq ${file.relativePath}...`);
      }
    }

    return writer.finish(this, startTime);
  }
}
