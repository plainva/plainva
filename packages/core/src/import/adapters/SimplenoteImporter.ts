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

  /** Counts notes in the export's trash — reported, never imported. */
  private countTrashed(input: any): number {
    if (typeof input === 'object' && input !== null && Array.isArray(input.trashedNotes)) {
      return input.trashedNotes.length;
    }
    if (Array.isArray(input)) {
      let total = 0;
      for (const item of input) {
        if (typeof item?.content === 'string') {
          try {
            const parsed = JSON.parse(item.content);
            if (parsed && Array.isArray(parsed.trashedNotes)) total += parsed.trashedNotes.length;
          } catch {
            // Ignore non-json
          }
        }
      }
      return total;
    }
    return 0;
  }

  async detect(input: any): Promise<boolean> {
    const notes = this.parseInput(input);
    return notes.length > 0;
  }

  async analyze(input: any, opts: ImportOptions): Promise<ImportPlan> {
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const active = this.parseInput(input);
    const totalBytes = active.reduce((acc, n) => acc + (n.content ? n.content.length : 0), 0);

    const warnings: string[] = [];
    if (active.length === 0) warnings.push('No valid Simplenote notes found in the JSON selection.');
    if (this.countTrashed(input) > 0) warnings.push(labels.limitSimplenoteTrashed);

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: active.length,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings,
      requiredSpaceBytes: totalBytes,
      estimatedDurationSec: Math.max(1, Math.ceil(active.length / 50)),
    };
  }

  async run(
    input: any,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const active = this.parseInput(input);
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();

    const trashed = this.countTrashed(input);
    if (trashed > 0) writer.noteLimitation(`${labels.limitSimplenoteTrashed} (${trashed})`);

    return writer.runGuarded(this, startTime, async () => {
      for (let i = 0; i < active.length; i++) {
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
