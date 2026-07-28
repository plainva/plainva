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

export interface MarkdownInputFile extends UnpackedFile {
  mtimeMs?: number;
}

export class GenericMarkdownImporter implements ImportSource {
  readonly id: ImportSourceId = 'generic_markdown';
  readonly name = 'Markdown folder / ZIP';
  readonly family: ImportFamily = 'markdown';
  readonly description = 'Imports plain Markdown files and folder structures.';

  async detect(input: any): Promise<boolean> {
    if (Array.isArray(input)) {
      return input.some((item: any) => typeof item.relativePath === 'string' && item.relativePath.endsWith('.md'));
    }
    return false;
  }

  async analyze(input: MarkdownInputFile[], opts: ImportOptions): Promise<ImportPlan> {
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const files = Array.isArray(input) ? input : [];
    const notes = files.filter(f => typeof f.relativePath === 'string' && f.relativePath.endsWith('.md'));
    const attachments = files.filter(f => typeof f.relativePath === 'string' && !f.relativePath.endsWith('.md'));
    const totalBytes = files.reduce((acc, f) => acc + (f.byteSize ?? (f.content ? f.content.length : 0)), 0);

    const warnings: string[] = [];
    if (files.length === 0) warnings.push('No Markdown files found in the selection.');
    warnings.push(labels.limitBinaryFilesInZip);

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
    input: MarkdownInputFile[],
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const files = Array.isArray(input) ? input : [];
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();
    writer.noteLimitation(labels.limitBinaryFilesInZip);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file || !file.relativePath) continue;

      const isMd = file.relativePath.endsWith('.md');
      if (!isTextEntry(file)) {
        // The archive gives us the bytes, but nothing writes them into a vault
        // yet — recording the entry beats writing an empty file over its name.
        writer.recordSkipped(file.relativePath, labels.skippedAttachment);
      } else if (isMd) {
        await writer.writeNote(file.relativePath, file.content ?? '');
      } else {
        await writer.writeFile(file.relativePath, file.content ?? '');
      }

      if (onProgress && files.length > 0) {
        onProgress(Math.round(((i + 1) / files.length) * 100), `Importing ${file.relativePath}...`);
      }
    }

    return writer.finish(this, startTime);
  }
}
