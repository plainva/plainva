import { ImportFamily, ImportOptions, ImportPlan, ImportReport, ImportSource, ImportSourceId } from '../ImportTypes.js';

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
  readonly description = 'Importiert Notizen und Tags aus dem Simplenote JSON-Export.';

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

  async detect(input: any): Promise<boolean> {
    const notes = this.parseInput(input);
    return notes.length > 0;
  }

  async analyze(input: any, _opts: ImportOptions): Promise<ImportPlan> {
    const active = this.parseInput(input);
    const totalBytes = active.reduce((acc, n) => acc + (n.content ? n.content.length : 0), 0);

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: active.length,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings: active.length === 0 ? ['Keine gültigen Simplenote Notizen in der JSON-Auswahl gefunden.'] : [],
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
    const active = this.parseInput(input);
    const items: ImportReport['items'] = [];
    let importedNotes = 0;

    const prefix = opts.targetSubfolder ? `${opts.targetSubfolder}/` : '';

    if (opts.vaultAdapter && prefix) {
      try {
        await opts.vaultAdapter.createFolder(prefix.replace(/\/$/, ''));
      } catch {
        // Folder exists
      }
    }

    for (let i = 0; i < active.length; i++) {
      const note = active[i];
      const lines = (note.content || '').split('\n');
      const rawTitle = lines[0] ? lines[0].replace(/^[#\s]+/, '').trim() : `Notiz_${note.id}`;
      const safeTitle = (rawTitle || 'Unbenannte Notiz').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const targetPath = `${prefix}${safeTitle}.md`;

      let mdContent = note.content || '';
      if (Array.isArray(note.tags) && note.tags.length > 0) {
        const tagsHeader = `---\ntags:\n${note.tags.map(t => `  - ${t}`).join('\n')}\n---\n\n`;
        mdContent = tagsHeader + mdContent;
      }

      if (opts.vaultAdapter) {
        await opts.vaultAdapter.writeTextFile(targetPath, mdContent);
      }

      importedNotes++;
      items.push({
        path: targetPath,
        status: 'imported',
      });

      if (onProgress && active.length > 0) {
        onProgress(Math.round(((i + 1) / active.length) * 100), `Importiere ${safeTitle}...`);
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
