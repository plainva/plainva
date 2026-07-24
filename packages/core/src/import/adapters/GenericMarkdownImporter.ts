import { ImportFamily, ImportOptions, ImportPlan, ImportReport, ImportSource, ImportSourceId } from '../ImportTypes.js';

export interface MarkdownInputFile {
  relativePath: string;
  content: string;
  mtimeMs?: number;
}

export class GenericMarkdownImporter implements ImportSource {
  readonly id: ImportSourceId = 'generic_markdown';
  readonly name = 'Markdown Ordner / ZIP';
  readonly family: ImportFamily = 'markdown';
  readonly description = 'Importiert generische Markdown-Dateien und Ordnerstrukturen.';

  async detect(input: any): Promise<boolean> {
    if (Array.isArray(input)) {
      return input.some((item: any) => typeof item.relativePath === 'string' && item.relativePath.endsWith('.md'));
    }
    return false;
  }

  async analyze(input: MarkdownInputFile[], _opts: ImportOptions): Promise<ImportPlan> {
    const files = Array.isArray(input) ? input : [];
    const notes = files.filter(f => typeof f.relativePath === 'string' && f.relativePath.endsWith('.md'));
    const attachments = files.filter(f => typeof f.relativePath === 'string' && !f.relativePath.endsWith('.md'));
    const totalBytes = files.reduce((acc, f) => acc + (f.content ? f.content.length : 0), 0);

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes.length,
      totalAttachments: attachments.length,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings: files.length === 0 ? ['Keine Markdown-Dateien in der Auswahl gefunden.'] : [],
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
    const files = Array.isArray(input) ? input : [];
    const items: ImportReport['items'] = [];
    let importedNotes = 0;
    let importedAttachments = 0;

    const prefix = opts.targetSubfolder ? `${opts.targetSubfolder}/` : '';

    if (opts.vaultAdapter && prefix) {
      try {
        await opts.vaultAdapter.createFolder(prefix.replace(/\/$/, ''));
      } catch {
        // Ignore if exists
      }
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file || !file.relativePath) continue;

      const targetPath = `${prefix}${file.relativePath}`;
      const isMd = file.relativePath.endsWith('.md');

      if (opts.vaultAdapter && file.content !== undefined) {
        // Create subdirectories if nested
        if (targetPath.includes('/')) {
          const folderPart = targetPath.substring(0, targetPath.lastIndexOf('/'));
          try { await opts.vaultAdapter.createFolder(folderPart); } catch { /* ignore existing dir */ }
        }
        await opts.vaultAdapter.writeTextFile(targetPath, file.content);
      }

      if (isMd) importedNotes++;
      else importedAttachments++;

      items.push({
        path: targetPath,
        status: 'imported',
      });

      if (onProgress && files.length > 0) {
        const pct = Math.round(((i + 1) / files.length) * 100);
        onProgress(pct, `Importiere ${file.relativePath}...`);
      }
    }

    const durationMs = Date.now() - startTime;
    const reportPath = `${prefix}Import-Bericht.md`;

    const summaryMarkdown = `# Import-Bericht (${this.name})\n\n` +
      `- **Datum:** ${new Date().toISOString()}\n` +
      `- **Dauer:** ${Math.round(durationMs / 1000)}s\n` +
      `- **Importierte Notizen:** ${importedNotes}\n` +
      `- **Importierte Anhänge:** ${importedAttachments}\n\n` +
      `## Importierte Dateien\n\n` +
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
