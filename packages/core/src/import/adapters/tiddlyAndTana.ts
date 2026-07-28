import {
  DEFAULT_IMPORT_LABELS,
  ImportFamily,
  ImportOptions,
  ImportPlan,
  ImportReport,
  ImportSource,
  ImportSourceId,
  isTextEntry,
} from '../ImportTypes.js';
import { ImportWriter } from '../ImportWriter.js';
import { MarkdownFamilyImporter } from './markdownFamily.js';

function safeName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, '_')
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 0x20)
    .join('')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 90) : fallback;
}

/** Every text file of a selection, whatever shape the caller handed over. */
function textsOf(input: any): string[] {
  if (typeof input === 'string') return [input];
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const file of input) {
    if (typeof file?.content === 'string' && isTextEntry(file)) out.push(file.content);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * TiddlyWiki
 * ------------------------------------------------------------------ */

interface Tiddler {
  title?: string;
  text?: string;
  tags?: string;
  type?: string;
  created?: string;
  modified?: string;
}

/**
 * TiddlyWiki's own timestamp: `YYYYMMDDHHMMSSmmm`, no separators.
 *
 * `Date.parse` cannot read it, and passing it through would put a
 * seventeen-digit number where a date belongs.
 */
export function parseTiddlyDate(raw: string | undefined): number | undefined {
  if (!raw || !/^\d{14,17}$/.test(raw)) return undefined;
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(
    10,
    12
  )}:${raw.slice(12, 14)}.${(raw.slice(14, 17) || '0').padEnd(3, '0')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * TiddlyWiki keeps tags in one string and quotes the ones with spaces.
 *
 * `[[Getting Things Done]] work` is two tags, not four words.
 */
export function parseTiddlyTags(raw: string | undefined): string[] {
  if (!raw) return [];
  const tags: string[] = [];
  for (const match of raw.matchAll(/\[\[([^\]]+)\]\]|(\S+)/g)) {
    const tag = (match[1] ?? match[2] ?? '').trim();
    if (tag) tags.push(tag);
  }
  return tags;
}

/**
 * Imports a TiddlyWiki JSON export.
 *
 * Tiddlers whose `type` is not text are skipped rather than written: a
 * TiddlyWiki carries its own images, stylesheets and JavaScript as tiddlers,
 * and a vault full of those would bury the writing. System tiddlers ($:/…)
 * are the wiki's configuration and go the same way — both are named in the
 * report so the decision is visible.
 *
 * WikiText is left as it is. It is not Markdown, and converting it would mean
 * guessing at a syntax with its own macros and transclusions; the text is
 * readable, and saying so beats a lossy translation.
 */
export class TiddlyWikiImporter implements ImportSource {
  readonly id: ImportSourceId = 'tiddlywiki';
  readonly name = 'TiddlyWiki (JSON export)';
  readonly family: ImportFamily = 'json';
  readonly description = 'Imports a TiddlyWiki JSON export: tiddlers with their tags and dates. WikiText is kept as written.';
  readonly detectPriority = 35;
  readonly options = [{ key: 'preserveTimestamps' as const, defaultValue: true }];
  readonly pickModes = ['files'] as const;

  private parse(input: any): Tiddler[] {
    if (Array.isArray(input) && input.some((t: any) => typeof t?.title === 'string' && 'text' in t && !('relativePath' in t))) {
      return input as Tiddler[];
    }
    for (const text of textsOf(input)) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.every((t: any) => t && typeof t === 'object')) {
          if (parsed.some((t: any) => typeof t.title === 'string' && typeof t.text === 'string')) {
            return parsed as Tiddler[];
          }
        }
      } catch {
        // Not this file.
      }
    }
    return [];
  }

  /** Writing, as opposed to the wiki's own machinery. */
  private isNote(t: Tiddler): boolean {
    if (typeof t.title !== 'string' || t.title.startsWith('$:/')) return false;
    const type = t.type ?? 'text/vnd.tiddlywiki';
    return type.startsWith('text/');
  }

  async detect(input: any): Promise<boolean> {
    const tiddlers = this.parse(input);
    return tiddlers.length > 0 && tiddlers.some((t) => typeof t.title === 'string');
  }

  async analyze(input: any, _opts: ImportOptions): Promise<ImportPlan> {
    const tiddlers = this.parse(input);
    const notes = tiddlers.filter((t) => this.isNote(t));
    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes.length,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings: notes.length === 0 ? ['No TiddlyWiki tiddlers found in the selection.'] : [],
      requiredSpaceBytes: notes.reduce((acc, t) => acc + (t.text?.length ?? 0), 0),
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
    const tiddlers = this.parse(input);
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();

    return writer.runGuarded(this, startTime, async () => {
      for (let i = 0; i < tiddlers.length; i += 1) {
        writer.abortIfRequested();
        const tiddler = tiddlers[i];
        const title = (tiddler.title ?? '').trim() || `Tiddler ${i + 1}`;

        if (!this.isNote(tiddler)) {
          writer.recordSkipped(title, labels.skippedTiddlyNonNote);
          writer.noteLimitation(labels.skippedTiddlyNonNote);
          continue;
        }

        try {
          const tags = parseTiddlyTags(tiddler.tags);
          const lines: string[] = [];
          if (tags.length > 0) {
            lines.push('---', 'tags:');
            for (const tag of tags) lines.push(`  - ${tag.replace(/\s+/g, '_')}`);
            lines.push('---', '');
          }
          lines.push(`# ${title}`, '', tiddler.text ?? '');

          await writer.writeNote(`${safeName(title, `Tiddler ${i + 1}`)}.md`, lines.join('\n'), {
            times: {
              createdMs: parseTiddlyDate(tiddler.created),
              modifiedMs: parseTiddlyDate(tiddler.modified),
            },
          });
        } catch (error) {
          writer.recordFailure(title, error);
        }

        if (onProgress && tiddlers.length > 0) {
          onProgress(Math.round(((i + 1) / tiddlers.length) * 100), `Importing ${title}...`);
        }
      }
    });
  }
}

/* ------------------------------------------------------------------ *
 * Tana Paste
 * ------------------------------------------------------------------ */

/**
 * Imports Tana's own interchange format, Tana Paste.
 *
 * Recognised by the `%%tana%%` header the format requires — a real signature,
 * and the reason this and not Tana's JSON export: the paste format is
 * documented and stable, the export is neither.
 *
 * Each top-level node becomes a note, its children the bullets they already
 * are. Tana's supertags (`#tag`) and fields (`Field:: value`) are left in the
 * text: a supertag is close enough to a tag to read, and a field is not a
 * property until somebody decides which database it belongs to.
 */
export class TanaPasteImporter implements ImportSource {
  readonly id: ImportSourceId = 'tana';
  readonly name = 'Tana (Tana Paste)';
  readonly family: ImportFamily = 'markdown';
  readonly description = 'Imports Tana Paste text: every top-level node becomes a note, its children stay bullets.';
  readonly detectPriority = 35;
  readonly options = [{ key: 'preserveTimestamps' as const, defaultValue: true }];
  readonly pickModes = ['files'] as const;

  private pastes(input: any): string[] {
    return textsOf(input).filter((t) => t.trimStart().startsWith('%%tana%%'));
  }

  /** Top-level nodes with the lines that belong under them. */
  private split(paste: string): Array<{ title: string; body: string[] }> {
    const lines = paste.split('\n').filter((l) => !l.trim().startsWith('%%tana%%'));
    const nodes: Array<{ title: string; body: string[] }> = [];
    for (const line of lines) {
      const match = line.match(/^(\s*)-\s?(.*)$/);
      if (!match) {
        if (nodes.length > 0 && line.trim()) nodes[nodes.length - 1].body.push(line);
        continue;
      }
      const [, indent, text] = match;
      if (indent.length === 0) nodes.push({ title: text.trim(), body: [] });
      else if (nodes.length > 0) nodes[nodes.length - 1].body.push(line);
    }
    return nodes;
  }

  async detect(input: any): Promise<boolean> {
    return this.pastes(input).length > 0;
  }

  async analyze(input: any, _opts: ImportOptions): Promise<ImportPlan> {
    const nodes = this.pastes(input).flatMap((p) => this.split(p));
    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: nodes.length,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings: nodes.length === 0 ? ['No Tana Paste content found in the selection.'] : [],
      requiredSpaceBytes: Math.max(1024, nodes.length * 512),
      estimatedDurationSec: Math.max(1, Math.ceil(nodes.length / 50)),
    };
  }

  async run(
    input: any,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const nodes = this.pastes(input).flatMap((p) => this.split(p));
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();

    return writer.runGuarded(this, startTime, async () => {
      for (let i = 0; i < nodes.length; i += 1) {
        writer.abortIfRequested();
        const node = nodes[i];
        const title = node.title || `Node ${i + 1}`;
        try {
          await writer.writeNote(
            `${safeName(title, `Node ${i + 1}`)}.md`,
            `# ${title}\n\n${node.body.join('\n')}\n`
          );
        } catch (error) {
          writer.recordFailure(title, error);
        }
        if (onProgress && nodes.length > 0) {
          onProgress(Math.round(((i + 1) / nodes.length) * 100), `Importing ${title}...`);
        }
      }
    });
  }
}

/**
 * RemNote's Markdown export.
 *
 * Rems come out as Markdown with their hierarchy as nested bullets, which the
 * family already writes through unchanged. No signature — it is Markdown in a
 * folder like the others, so it is picked from its tile.
 */
export class RemNoteImporter extends MarkdownFamilyImporter {
  readonly id: ImportSourceId = 'remnote';
  readonly name = 'RemNote (Markdown export)';
  readonly description = 'Imports a RemNote Markdown export with its documents and nested rems.';

  protected signature(): boolean {
    return false;
  }
}
