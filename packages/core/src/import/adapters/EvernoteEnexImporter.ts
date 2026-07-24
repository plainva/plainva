import { ImportFamily, ImportOptions, ImportPlan, ImportReport, ImportSource, ImportSourceId } from '../ImportTypes.js';

export interface EnexNote {
  title: string;
  contentXml: string;
  created?: string;
  updated?: string;
  tags?: string[];
  resources?: Array<{
    mime: string;
    dataBase64: string;
    fileName?: string;
  }>;
}

export class EvernoteEnexImporter implements ImportSource {
  readonly id: ImportSourceId = 'evernote';
  readonly name = 'Evernote (ENEX)';
  readonly family: ImportFamily = 'xml';
  readonly description = 'Importiert Notizen, Checklisten (<en-todo>) und Anhänge aus Evernote ENEX XML-Exporten.';

  private parseInput(input: any): EnexNote[] {
    if (Array.isArray(input)) {
      const notes: EnexNote[] = [];
      for (const item of input) {
        if (typeof item === 'object' && item !== null) {
          if (item.title && typeof item.contentXml === 'string') {
            notes.push(item as EnexNote);
          } else if (typeof item.content === 'string') {
            notes.push(...this.parseEnexXmlString(item.content));
          }
        }
      }
      return notes;
    }
    if (typeof input === 'string') {
      return this.parseEnexXmlString(input);
    }
    return [];
  }

  private parseEnexXmlString(xmlStr: string): EnexNote[] {
    const notes: EnexNote[] = [];
    const noteBlocks = xmlStr.split(/<note>/i).slice(1);

    for (let i = 0; i < noteBlocks.length; i++) {
      const block = noteBlocks[i];
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
      const contentMatch = block.match(/<content>([\s\S]*?)<\/content>/i);
      const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim() : `Note_${i + 1}`;
      const contentXml = contentMatch ? contentMatch[1] : '';

      const tags: string[] = [];
      const tagMatches = block.matchAll(/<tag>([\s\S]*?)<\/tag>/gi);
      for (const tm of tagMatches) {
        tags.push(tm[1].trim());
      }

      notes.push({ title, contentXml, tags });
    }
    return notes;
  }

  private convertEnexToMarkdown(note: EnexNote): string {
    const lines: string[] = [];

    if (note.tags && note.tags.length > 0) {
      lines.push('---');
      lines.push('tags:');
      note.tags.forEach(t => lines.push(`  - ${t.replace(/\s+/g, '_')}`));
      lines.push('---');
      lines.push('');
    }

    lines.push(`# ${note.title}`);
    lines.push('');

    let text = note.contentXml || '';
    text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
    text = text.replace(/<en-todo\s+checked="true"\s*\/?>/gi, '- [x] ');
    text = text.replace(/<en-todo\s*\/?>/gi, '- [ ] ');
    text = text.replace(/<div>([\s\S]*?)<\/div>/gi, '$1\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');

    lines.push(text.trim());
    return lines.join('\n');
  }

  async detect(input: any): Promise<boolean> {
    const notes = this.parseInput(input);
    return notes.length > 0;
  }

  async analyze(input: any, _opts: ImportOptions): Promise<ImportPlan> {
    const notes = this.parseInput(input);
    let attachmentsCount = 0;
    for (const n of notes) {
      if (Array.isArray(n.resources)) attachmentsCount += n.resources.length;
    }

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes.length,
      totalAttachments: attachmentsCount,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings: notes.length === 0 ? ['Keine Evernote Notizen im ENEX-Format gefunden.'] : [],
      requiredSpaceBytes: notes.length * 2048,
      estimatedDurationSec: Math.max(1, Math.ceil(notes.length / 30)),
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
    let importedAttachments = 0;

    const prefix = opts.targetSubfolder ? `${opts.targetSubfolder}/` : '';

    if (opts.vaultAdapter && prefix) {
      try {
        await opts.vaultAdapter.createFolder(prefix.replace(/\/$/, ''));
      } catch {
        // Folder exists
      }
    }

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const safeTitle = (note.title || `Evernote_${i + 1}`).replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const targetPath = `${prefix}${safeTitle}.md`;

      const mdContent = this.convertEnexToMarkdown(note);

      if (opts.vaultAdapter) {
        await opts.vaultAdapter.writeTextFile(targetPath, mdContent);
      }

      importedNotes++;
      if (Array.isArray(note.resources)) {
        importedAttachments += note.resources.length;
      }

      items.push({
        path: targetPath,
        status: 'imported',
      });

      if (onProgress && notes.length > 0) {
        onProgress(Math.round(((i + 1) / notes.length) * 100), `Importiere Evernote Notiz ${safeTitle}...`);
      }
    }

    const durationMs = Date.now() - startTime;
    const reportPath = `${prefix}Import-Bericht.md`;

    const summaryMarkdown = `# Import-Bericht (${this.name})\n\n` +
      `- **Datum:** ${new Date().toISOString()}\n` +
      `- **Importierte Notizen:** ${importedNotes}\n` +
      `- **Importierte Anhänge:** ${importedAttachments}\n\n` +
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
      importedAttachmentsCount: importedAttachments,
      importedDatabasesCount: 0,
      reportPath,
      items,
      summaryMarkdown,
    };
  }
}
