import { ImportFamily, ImportOptions, ImportPlan, ImportReport, ImportSource, ImportSourceId } from '../ImportTypes.js';

export interface GoogleKeepNote {
  title?: string;
  textContent?: string;
  listContent?: Array<{ text: string; isChecked: boolean }>;
  labels?: Array<{ name: string }>;
  color?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  userEditedTimestampUsec?: number;
}

export class GoogleKeepImporter implements ImportSource {
  readonly id: ImportSourceId = 'google_keep';
  readonly name = 'Google Keep (Takeout)';
  readonly family: ImportFamily = 'json';
  readonly description = 'Importiert Notizen, Checklisten und Labels aus Google Keep Takeout JSON-Dateien.';

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
    if (labels.length > 0 || note.color) {
      lines.push('---');
      if (labels.length > 0) {
        lines.push('tags:');
        labels.forEach(l => lines.push(`  - ${l.replace(/\s+/g, '_')}`));
      }
      if (note.color) lines.push(`color: ${note.color}`);
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

  async analyze(input: any, _opts: ImportOptions): Promise<ImportPlan> {
    const notes = this.parseInput(input);
    let checklists = 0;
    for (const n of notes) {
      if (Array.isArray(n.listContent) && n.listContent.length > 0) checklists++;
    }

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes.length,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: checklists,
      warnings: notes.length === 0 ? ['Keine gültigen Google Keep JSON Notizen in der Auswahl gefunden.'] : [],
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
    const notes = this.parseInput(input);
    const items: ImportReport['items'] = [];
    let importedNotes = 0;

    const prefix = opts.targetSubfolder ? `${opts.targetSubfolder}/` : '';

    if (opts.vaultAdapter && prefix) {
      try {
        await opts.vaultAdapter.createFolder(prefix.replace(/\/$/, ''));
      } catch {
        // Folder already exists or root
      }
    }

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const rawTitle = (note.title || '').trim() || `Keep_${i + 1}`;
      const safeTitle = rawTitle.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const targetPath = `${prefix}${safeTitle}.md`;

      const mdContent = this.convertNoteToMarkdown(note, rawTitle);

      if (opts.vaultAdapter) {
        await opts.vaultAdapter.writeTextFile(targetPath, mdContent);
      }

      importedNotes++;
      items.push({
        path: targetPath,
        status: 'imported',
      });

      if (onProgress && notes.length > 0) {
        onProgress(Math.round(((i + 1) / notes.length) * 100), `Importiere Keep Notiz ${safeTitle}...`);
      }
    }

    const durationMs = Date.now() - startTime;
    const reportPath = `${prefix}Import-Bericht.md`;

    const summaryMarkdown = `# Import-Bericht (${this.name})\n\n` +
      `- **Datum:** ${new Date().toISOString()}\n` +
      `- **Importierte Notizen:** ${importedNotes}\n\n` +
      items.map(item => `- [${item.status.toUpperCase()}] ${item.path}`).join('\n');

    if (opts.vaultAdapter) {
      await opts.vaultAdapter.writeTextFile(reportPath, summaryMarkdown);
    }

    return {
      sourceId: this.id,
      sourceName: this.name,
      startedAt: new Date(startTime).toISOString(),
      durationMs,
      importedNotesCount: importedNotes,
      importedAttachmentsCount: 0,
      importedDatabasesCount: 0,
      reportPath,
      items,
      summaryMarkdown,
    };
  }
}
