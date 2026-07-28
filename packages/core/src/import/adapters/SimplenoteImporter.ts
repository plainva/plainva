import {
  DEFAULT_IMPORT_LABELS,
  ImportFamily,
  ImportOptions,
  ImportPlan,
  ImportReport,
  ImportSource,
  ImportSourceId,
} from '../ImportTypes.js';
import { ImportWriter } from '../ImportWriter.js';
import { msFromIso, timesOrUndefined } from '../sourceTimes.js';

export interface SimplenoteExportNote {
  id: string;
  content: string;
  tags?: string[];
  deleted?: boolean;
  creationDate?: string;
  lastModified?: string;
}

export interface SimplenoteExportPayload {
  activeNotes?: SimplenoteExportNote[];
  trashedNotes?: SimplenoteExportNote[];
}

export class SimplenoteImporter implements ImportSource {
  readonly id: ImportSourceId = 'simplenote';
  readonly name = 'Simplenote JSON';
  readonly family: ImportFamily = 'json';
  readonly description = 'Imports notes and tags from a Simplenote JSON export.';

  private parseInput(input: any): SimplenoteExportNote[] {
    if (typeof input === 'object' && input !== null && Array.isArray(input.activeNotes)) {
      return input.activeNotes;
    }
    if (Array.isArray(input)) {
      const notes: SimplenoteExportNote[] = [];
      for (const item of input) {
        if (typeof item === 'object' && item !== null) {
          if (item.content && item.id) {
            notes.push(item as SimplenoteExportNote);
          } else if (typeof item.content === 'string') {
            try {
              const parsed = JSON.parse(item.content);
              if (parsed && Array.isArray(parsed.activeNotes)) {
                notes.push(...parsed.activeNotes);
              }
            } catch {
              // Ignore non-json
            }
          }
        }
      }
      return notes;
    }
    return [];
  }

  /**
   * The notes the export keeps in its trash.
   *
   * Skipped by default and named in the report; the wizard's "import deleted
   * notes too" option brings them across (same rule as Keep, G5).
   */
  private parseTrashed(input: any): SimplenoteExportNote[] {
    if (typeof input === 'object' && input !== null && Array.isArray(input.trashedNotes)) {
      return input.trashedNotes;
    }
    if (Array.isArray(input)) {
      const notes: SimplenoteExportNote[] = [];
      for (const item of input) {
        if (typeof item?.content === 'string') {
          try {
            const parsed = JSON.parse(item.content);
            if (parsed && Array.isArray(parsed.trashedNotes)) notes.push(...parsed.trashedNotes);
          } catch {
            // Ignore non-json
          }
        }
      }
      return notes;
    }
    return [];
  }

  private countTrashed(input: any): number {
    return this.parseTrashed(input).length;
  }

  /** `activeNotes`/`trashedNotes` is Simplenote's own envelope. */
  readonly detectPriority = 40;

  readonly options = [
    { key: 'preserveTimestamps' as const, defaultValue: true },
    { key: 'includeTrashed' as const, defaultValue: false },
  ];

  // A single exported file, nothing folder-shaped about it.
  readonly pickModes = ['files'] as const;


  async detect(input: any): Promise<boolean> {
    return this.parseInput(input).length > 0 || this.countTrashed(input) > 0;
  }

  /** The notes this run will write, in the order they are imported. */
  private notesToImport(input: any, opts: ImportOptions): SimplenoteExportNote[] {
    const active = this.parseInput(input);
    return opts.includeTrashed ? [...active, ...this.parseTrashed(input)] : active;
  }

  async analyze(input: any, opts: ImportOptions): Promise<ImportPlan> {
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const importable = this.notesToImport(input, opts);
    const totalBytes = importable.reduce((acc, n) => acc + (n.content ? n.content.length : 0), 0);

    const trashed = this.countTrashed(input);
    const warnings: string[] = [];
    if (importable.length === 0) warnings.push('No valid Simplenote notes found in the JSON selection.');
    if (trashed > 0 && !opts.includeTrashed) warnings.push(`${labels.limitSimplenoteTrashed} (${trashed})`);

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: importable.length,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings,
      requiredSpaceBytes: totalBytes,
      estimatedDurationSec: Math.max(1, Math.ceil(importable.length / 50)),
    };
  }

  async run(
    input: any,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const active = this.notesToImport(input, opts);
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();

    const trashed = this.countTrashed(input);
    if (trashed > 0 && !opts.includeTrashed) {
      writer.noteLimitation(`${labels.limitSimplenoteTrashed} (${trashed})`);
    }

    return writer.runGuarded(this, startTime, async () => {
      for (let i = 0; i < active.length; i++) {
        writer.abortIfRequested();
        const note = active[i];
        const lines = (note.content || '').split('\n');
        const rawTitle = lines[0] ? lines[0].replace(/^[#\s]+/, '').trim() : `Note_${note.id}`;
        const safeTitle = (rawTitle || 'Untitled note').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);

        try {
          let mdContent = note.content || '';
          if (Array.isArray(note.tags) && note.tags.length > 0) {
            const tagsHeader = `---\ntags:\n${note.tags.map(t => `  - ${t}`).join('\n')}\n---\n\n`;
            mdContent = tagsHeader + mdContent;
          }

          await writer.writeNote(`${safeTitle}.md`, mdContent, {
            times: timesOrUndefined({
              createdMs: msFromIso(note.creationDate),
              modifiedMs: msFromIso(note.lastModified),
            }),
          });
        } catch (error) {
          writer.recordFailure(`${safeTitle}.md`, error);
        }

        if (onProgress && active.length > 0) {
          onProgress(Math.round(((i + 1) / active.length) * 100), `Importing ${safeTitle}...`);
        }
      }
    });
  }
}
