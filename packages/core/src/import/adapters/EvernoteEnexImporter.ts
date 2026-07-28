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
import { msFromEnexStamp, timesOrUndefined } from '../sourceTimes.js';

export interface EnexNote {
  title: string;
  contentXml: string;
  created?: string;
  updated?: string;
  tags?: string[];
  /** Number of `<resource>` blocks on the note. Counted, never imported. */
  resourceCount?: number;
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
  readonly description = 'Imports notes, checklists (<en-todo>) and tags from Evernote ENEX exports.';

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

      // Attachments live in <resource> blocks as base64. We do not decode or
      // write them, so count them here to report the loss instead of hiding it.
      const resourceCount = (block.match(/<resource>/gi) || []).length;

      const created = block.match(/<created>([\s\S]*?)<\/created>/i)?.[1]?.trim();
      const updated = block.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1]?.trim();

      notes.push({ title, contentXml, tags, resourceCount, created, updated });
    }
    return notes;
  }

  /**
   * Converts an ENEX timestamp (`20260725T101530Z`) into a full ISO instant.
   *
   * This used to return the date only and throw the time away, so every note
   * of a day collapsed onto midnight and their order was lost.
   */
  private toIsoDate(stamp?: string): string | undefined {
    const ms = msFromEnexStamp(stamp);
    return ms === undefined ? undefined : new Date(ms).toISOString();
  }

  /** Flattens the inline HTML of one checklist item to a single text line. */
  private flattenInline(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Turns both checklist syntaxes Evernote has shipped into GFM task lines.
   *
   * The classic ENML element is `<en-todo checked="true"/>`; the current
   * Evernote 10 apps export a `<ul style="--en-todo:true;">` whose items carry
   * `--en-checked:true|false`. The old parser matched `checked="true"` and the
   * bare element, so an UNCHECKED `<en-todo checked="false"/>` fell through to
   * the generic tag strip: the box vanished and the item read as ordinary
   * text — the one state where losing the checkbox also loses the meaning.
   */
  private convertChecklists(text: string): string {
    let out = text;

    // Evernote 10: the checked state sits on the list item, not on a marker.
    out = out.replace(
      /<li\b[^>]*--en-checked\s*:\s*true[^>]*>([\s\S]*?)<\/li>/gi,
      (_m, inner: string) => `\n- [x] ${this.flattenInline(inner)}`
    );
    out = out.replace(
      /<li\b[^>]*--en-checked\s*:\s*false[^>]*>([\s\S]*?)<\/li>/gi,
      (_m, inner: string) => `\n- [ ] ${this.flattenInline(inner)}`
    );
    out = out.replace(/<ul\b[^>]*--en-todo[^>]*>/gi, '\n');

    // Classic ENML marker: anything that is not explicitly checked is open.
    out = out.replace(/<en-todo\b([^>]*)>/gi, (_m, attrs: string) =>
      /checked\s*=\s*["']?\s*true/i.test(attrs) ? '- [x] ' : '- [ ] '
    );

    return out;
  }

  /** Whether a note carries at least one checklist item, in either syntax. */
  private hasChecklist(note: EnexNote): boolean {
    const xml = note.contentXml || '';
    return /<en-todo\b/i.test(xml) || /--en-checked/i.test(xml);
  }

  private convertEnexToMarkdown(note: EnexNote): string {
    const lines: string[] = [];

    const created = this.toIsoDate(note.created);
    const updated = this.toIsoDate(note.updated);
    const hasTags = note.tags && note.tags.length > 0;

    if (hasTags || created || updated) {
      lines.push('---');
      if (hasTags) {
        lines.push('tags:');
        note.tags!.forEach(t => lines.push(`  - ${t.replace(/\s+/g, '_')}`));
      }
      if (created) lines.push(`created: ${created}`);
      if (updated) lines.push(`updated: ${updated}`);
      lines.push('---');
      lines.push('');
    }

    lines.push(`# ${note.title}`);
    lines.push('');

    let text = note.contentXml || '';
    text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
    text = this.convertChecklists(text);
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

  async analyze(input: any, opts: ImportOptions): Promise<ImportPlan> {
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const notes = this.parseInput(input);
    let attachmentsCount = 0;
    for (const n of notes) {
      attachmentsCount += n.resourceCount ?? (Array.isArray(n.resources) ? n.resources.length : 0);
    }

    const warnings: string[] = [];
    if (notes.length === 0) warnings.push('No Evernote notes found in the ENEX selection.');
    if (attachmentsCount > 0) warnings.push(`${labels.limitEvernoteAttachments} (${attachmentsCount})`);

    return {
      sourceId: this.id,
      sourceName: this.name,
      // Attachments are counted so the preview is honest, but none are written.
      totalNotes: notes.length,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: notes.filter((n) => this.hasChecklist(n)).length,
      warnings,
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
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const notes = this.parseInput(input);
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();

    let droppedTotal = 0;

    return writer.runGuarded(this, startTime, async () => {
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const safeTitle = (note.title || `Evernote_${i + 1}`).replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);

        try {
          const mdContent = this.convertEnexToMarkdown(note);

          const dropped = note.resourceCount ?? (Array.isArray(note.resources) ? note.resources.length : 0);
          droppedTotal += dropped;

          await writer.writeNote(`${safeTitle}.md`, mdContent, {
            details: dropped > 0 ? `${labels.limitEvernoteAttachments} (${dropped})` : undefined,
            times: timesOrUndefined({
              createdMs: msFromEnexStamp(note.created),
              modifiedMs: msFromEnexStamp(note.updated),
            }),
          });
        } catch (error) {
          writer.recordFailure(`${safeTitle}.md`, error);
        }

        if (onProgress && notes.length > 0) {
          onProgress(Math.round(((i + 1) / notes.length) * 100), `Importing Evernote note ${safeTitle}...`);
        }
      }

      if (droppedTotal > 0) writer.noteLimitation(`${labels.limitEvernoteAttachments} (${droppedTotal})`);
    });
  }
}
