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

export interface GoogleKeepNote {
  title?: string;
  textContent?: string;
  listContent?: Array<{ text: string; isChecked: boolean }>;
  labels?: Array<{ name: string }>;
  color?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  attachments?: Array<{ filePath?: string; mimetype?: string }>;
  userEditedTimestampUsec?: number;
}

export class GoogleKeepImporter implements ImportSource {
  readonly id: ImportSourceId = 'google_keep';
  readonly name = 'Google Keep (Takeout)';
  readonly family: ImportFamily = 'json';
  readonly description = 'Imports notes, checklists and labels from Google Keep Takeout JSON files.';

  private parseInput(input: any): GoogleKeepNote[] {
    if (!Array.isArray(input)) return [];
    const notes: GoogleKeepNote[] = [];

    for (const item of input) {
      if (typeof item === 'object' && item !== null) {
        // Case A: Pre-parsed GoogleKeepNote object
        if (item.textContent !== undefined || item.listContent !== undefined || item.title !== undefined) {
          notes.push(item as GoogleKeepNote);
          continue;
        }
        // Case B: Raw file wrapper { relativePath, content }
        if (typeof item.content === 'string' && item.content.trim()) {
          try {
            const parsed = JSON.parse(item.content);
            if (typeof parsed === 'object' && parsed !== null) {
              notes.push(parsed as GoogleKeepNote);
            }
          } catch {
            // Ignore non-JSON content
          }
        }
      }
    }
    return notes;
  }

  private convertNoteToMarkdown(note: GoogleKeepNote, title: string): string {
    const lines: string[] = [];

    const labels = Array.isArray(note.labels) ? note.labels.map(l => l.name) : [];
    if (labels.length > 0 || note.color || note.isPinned || note.isArchived) {
      lines.push('---');
      if (labels.length > 0) {
        lines.push('tags:');
        labels.forEach(l => lines.push(`  - ${l.replace(/\s+/g, '_')}`));
      }
      if (note.color) lines.push(`color: ${note.color}`);
      if (note.isPinned) lines.push('pinned: true');
      if (note.isArchived) lines.push('archived: true');
      lines.push('---');
      lines.push('');
    }

    lines.push(`# ${title}`);
    lines.push('');

    if (note.textContent) {
      lines.push(note.textContent);
      lines.push('');
    }

    if (Array.isArray(note.listContent) && note.listContent.length > 0) {
      note.listContent.forEach(item => {
        const check = item.isChecked ? '[x]' : '[ ]';
        lines.push(`- ${check} ${item.text}`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  async detect(input: any): Promise<boolean> {
    const notes = this.parseInput(input);
    return notes.length > 0;
  }

  async analyze(input: any, opts: ImportOptions): Promise<ImportPlan> {
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const notes = this.parseInput(input);
    let checklists = 0;
    let withAttachments = 0;
    for (const n of notes) {
      if (Array.isArray(n.listContent) && n.listContent.length > 0) checklists++;
      if (Array.isArray(n.attachments) && n.attachments.length > 0) withAttachments++;
    }

    const warnings: string[] = [];
    if (notes.length === 0) warnings.push('No valid Google Keep JSON notes found in the selection.');
    if (withAttachments > 0) warnings.push(labels.limitKeepAttachments);

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes.length,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: checklists,
      warnings,
      requiredSpaceBytes: notes.length * 1024,
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
    const notes = this.parseInput(input);
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const rawTitle = (note.title || '').trim() || `Keep_${i + 1}`;
      const safeTitle = rawTitle.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const mdContent = this.convertNoteToMarkdown(note, rawTitle);

      // Keep stores attachments as separate binary files that a JSON-only
      // import never sees — say so on the note instead of silently dropping it.
      const droppedAttachments = Array.isArray(note.attachments) ? note.attachments.length : 0;
      await writer.writeNote(`${safeTitle}.md`, mdContent, {
        details: droppedAttachments > 0 ? `${labels.limitKeepAttachments} (${droppedAttachments})` : undefined,
      });

      if (droppedAttachments > 0) writer.noteLimitation(labels.limitKeepAttachments);

      if (onProgress && notes.length > 0) {
        onProgress(Math.round(((i + 1) / notes.length) * 100), `Importing Keep note ${safeTitle}...`);
      }
    }

    return writer.finish(this, startTime);
  }
}
