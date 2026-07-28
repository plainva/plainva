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
import { MarkdownFamilyImporter } from './markdownFamily.js';

/** Hosts a Roam export legitimately points at for the user's own uploads. */
const ROAM_FILE_HOSTS = ['firebasestorage.googleapis.com', 'roamresearch.com'];

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

interface RoamBlock {
  string?: string;
  uid?: string;
  heading?: number;
  children?: RoamBlock[];
  'create-time'?: number;
  'edit-time'?: number;
}

interface RoamPage extends RoamBlock {
  title?: string;
}

function safeName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, '_')
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 0x20)
    .join('')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 90) : fallback;
}

/** Every block of the export, by uid — the table block references need. */
export function indexRoamBlocks(pages: RoamPage[]): Map<string, string> {
  const byUid = new Map<string, string>();
  const walk = (blocks: RoamBlock[] | undefined) => {
    for (const block of blocks ?? []) {
      if (block?.uid && typeof block.string === 'string') byUid.set(block.uid, block.string);
      walk(block?.children);
    }
  };
  for (const page of pages) walk(page.children);
  return byUid;
}

/**
 * Resolves Roam's `((uid))` block references to the text they point at.
 *
 * Plainva links notes, not blocks, so a reference has three possible fates:
 * leave it as dead syntax, drop it, or put the referenced text where it stood.
 * The third is the only one that keeps the sentence readable — a Roam page
 * built on references is unreadable without them — and it is reported, because
 * the *link* is genuinely lost even though the words survive.
 *
 * A reference whose target is not in the export stays as it was: inventing
 * text for it would be worse than showing that something is missing.
 */
export function resolveBlockRefs(
  text: string,
  byUid: Map<string, string>
): { text: string; resolved: number; unresolved: number } {
  let resolved = 0;
  let unresolved = 0;
  const out = text.replace(/\(\(([A-Za-z0-9_-]{5,})\)\)/g, (whole, uid: string) => {
    const target = byUid.get(uid);
    if (target === undefined) {
      unresolved += 1;
      return whole;
    }
    resolved += 1;
    return target;
  });
  return { text: out, resolved, unresolved };
}

/**
 * Imports a Roam Research JSON export.
 *
 * A page becomes a note and its outline becomes nested bullets. `[[Page]]`
 * links and `#tags` are already what Plainva writes, so they are left exactly
 * as they are — the one place where doing nothing is the correct mapping.
 */
export class RoamImporter implements ImportSource {
  readonly id: ImportSourceId = 'roam_research';
  readonly name = 'Roam Research (JSON export)';
  readonly family: ImportFamily = 'json';
  readonly description = 'Imports a Roam JSON export: pages as notes, outlines as nested bullets, block references resolved to their text.';
  readonly detectPriority = 35;
  readonly options = [{ key: 'preserveTimestamps' as const, defaultValue: true }];
  readonly pickModes = ['files'] as const;

  private parse(input: any): RoamPage[] {
    const texts: string[] = [];
    if (Array.isArray(input)) {
      // Already-parsed pages, as a caller assembling a payload would hand them
      // over. A page has a title or an outline; an archive entry has neither.
      if (input.some((p: any) => typeof p?.title === 'string' && !('relativePath' in p))) {
        return input as RoamPage[];
      }
      for (const file of input) {
        if (typeof file?.content === 'string' && isTextEntry(file as UnpackedFile)) texts.push(file.content);
      }
    } else if (typeof input === 'string') {
      texts.push(input);
    }

    for (const text of texts) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.some((p: any) => typeof p?.title === 'string')) {
          return parsed as RoamPage[];
        }
      } catch {
        // Not this file.
      }
    }
    return [];
  }

  /** One page's outline as nested bullets, references already resolved. */
  private render(
    blocks: RoamBlock[] | undefined,
    byUid: Map<string, string>,
    depth: number,
    stats: { resolved: number; unresolved: number }
  ): string[] {
    const lines: string[] = [];
    for (const block of blocks ?? []) {
      const raw = typeof block.string === 'string' ? block.string : '';
      const { text, resolved, unresolved } = resolveBlockRefs(raw, byUid);
      stats.resolved += resolved;
      stats.unresolved += unresolved;

      if (text.trim()) {
        // Roam marks headings on the block; at the top level that is a real
        // heading, deeper down it is a bullet that happens to be big.
        if (block.heading && depth === 0) lines.push(`${'#'.repeat(Math.min(6, block.heading))} ${text}`);
        else lines.push(`${'  '.repeat(depth)}- ${text}`);
      }
      lines.push(...this.render(block.children, byUid, depth + 1, stats));
    }
    return lines;
  }

  async detect(input: any): Promise<boolean> {
    const pages = this.parse(input);
    return pages.length > 0 && pages.some((p) => Array.isArray(p.children) || typeof p.title === 'string');
  }

  async analyze(input: any, _opts: ImportOptions): Promise<ImportPlan> {
    const pages = this.parse(input);
    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: pages.length,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings: pages.length === 0 ? ['No Roam pages found in the selection.'] : [],
      requiredSpaceBytes: Math.max(1024, pages.length * 2048),
      estimatedDurationSec: Math.max(1, Math.ceil(pages.length / 50)),
    };
  }

  /**
   * Downloads the files a Roam page points at.
   *
   * Only from the hosts Roam itself uses for uploads: an export is full of
   * ordinary web links too, and following those would turn an import into a
   * crawler. The link is rewritten only when the file actually arrived.
   */
  private async takeAttachments(
    text: string,
    writer: ImportWriter,
    opts: ImportOptions,
    folder: string
  ): Promise<{ text: string; taken: number; lost: number }> {
    const fetchFn = opts.httpFetch;
    if (!fetchFn) return { text, taken: 0, lost: 0 };

    const urls = new Set<string>();
    for (const match of text.matchAll(/!?\[[^\]]*\]\((https:\/\/[^\s)]+)\)/g)) {
      const url = match[1];
      if (ROAM_FILE_HOSTS.some((host) => url.includes(host))) urls.add(url);
    }
    if (urls.size === 0) return { text, taken: 0, lost: 0 };

    let out = text;
    let taken = 0;
    let lost = 0;

    for (const url of urls) {
      let bytes: Uint8Array | null = null;
      try {
        const res = await fetchFn(url);
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          if (buffer.byteLength <= MAX_ATTACHMENT_BYTES) bytes = new Uint8Array(buffer);
        }
      } catch {
        // Reported below; a dead upload must not fail the note.
      }

      if (!bytes) {
        lost += 1;
        continue;
      }

      const last = decodeURIComponent(url.split('?')[0].split('/').pop() ?? '');
      const name = safeName(last, `attachment-${taken + 1}`);
      const written = await writer.writeBinary(`${folder}/${name}`, bytes);
      out = out.split(url).join(written);
      taken += 1;
    }

    return { text: out, taken, lost };
  }

  async run(
    input: any,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const pages = this.parse(input);
    const writer = new ImportWriter(opts, labels);
    const attachmentsFolder = opts.attachmentsFolder ?? 'Attachments';

    await writer.ensureRoot();

    return writer.runGuarded(this, startTime, async () => {
      const byUid = indexRoamBlocks(pages);

      for (let i = 0; i < pages.length; i += 1) {
        writer.abortIfRequested();
        const page = pages[i];
        const title = (page.title || '').trim() || `Page ${i + 1}`;

        try {
          const stats = { resolved: 0, unresolved: 0 };
          const body = this.render(page.children, byUid, 0, stats).join('\n');
          const media = await this.takeAttachments(body, writer, opts, attachmentsFolder);

          const notes: string[] = [];
          if (stats.resolved > 0) {
            notes.push(`${labels.degradedRoamBlockRefs} (${stats.resolved})`);
            writer.noteLimitation(labels.degradedRoamBlockRefs);
          }
          if (media.lost > 0) notes.push(`${labels.skippedAttachment} (${media.lost})`);

          await writer.writeNote(`${safeName(title, `Page ${i + 1}`)}.md`, `# ${title}\n\n${media.text}\n`, {
            details: notes.length > 0 ? notes.join(' · ') : undefined,
            times: {
              createdMs: typeof page['create-time'] === 'number' ? page['create-time'] : undefined,
              modifiedMs: typeof page['edit-time'] === 'number' ? page['edit-time'] : undefined,
            },
          });
        } catch (error) {
          writer.recordFailure(title, error);
        }

        if (onProgress && pages.length > 0) {
          onProgress(Math.round(((i + 1) / pages.length) * 100), `Importing ${title}...`);
        }
      }
    });
  }
}

/**
 * Reflect's Markdown export.
 *
 * Notes with `[[links]]` and daily notes, which Plainva writes the same way —
 * so the family's plain path is the whole mapping. No signature: it is
 * Markdown in a ZIP like the others, and picked from its tile.
 */
export class ReflectImporter extends MarkdownFamilyImporter {
  readonly id: ImportSourceId = 'reflect';
  readonly name = 'Reflect (Markdown export)';
  readonly description = 'Imports a Reflect Markdown export; its wiki links and daily notes are already what Plainva writes.';

  protected signature(): boolean {
    return false;
  }
}
