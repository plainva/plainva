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
import { copyArchiveAttachments } from '../archiveAttachments.js';
import { ImportWriter } from '../ImportWriter.js';
import { htmlToMarkdown } from '../../pim/htmlToMarkdown.js';
import { timesFromFile } from '../sourceTimes.js';

const HTML_RE = /\.html?$/i;

function isHtml(file: UnpackedFile): boolean {
  return isTextEntry(file) && HTML_RE.test(file.relativePath);
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

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * The page's own title, and the body with that heading removed.
 *
 * `<h1>` first, `<title>` second: an HTML export usually puts the page title in
 * both, but the `<title>` carries the site's name as well — a Confluence space
 * export writes "Space : Page" there. Taking the `<h1>` and dropping it from
 * the body avoids the heading appearing twice in the note.
 */
export function htmlTitleAndBody(content: string, fallback: string): { title: string; body: string } {
  const h1 = content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const title = decodeEntities(h1[1].replace(/<[^>]+>/g, '')).trim();
    if (title) return { title, body: content.slice(0, h1.index) + content.slice((h1.index ?? 0) + h1[0].length) };
  }

  const titleTag = content.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleTag ? decodeEntities(titleTag[1].replace(/<[^>]+>/g, '')).trim() : '';
  return { title: title || fallback, body: content };
}

/** Resolves `href="../a/b.html"` against the folder the link sits in. */
export function resolveRelative(fromPath: string, href: string): string {
  const base = fromPath.split('/').slice(0, -1);
  const parts = href.split('/');
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

/**
 * Imports a folder, ZIP or selection of HTML files.
 *
 * The route in for everything that exports HTML and nothing better — a
 * Confluence space export above all, which is why this exists: Confluence's own
 * API returns its storage format, an XHTML dialect built around macros that
 * would need a converter of its own, while the space export is plain HTML that
 * the converter Plainva already uses for Evernote and Trilium reads directly.
 *
 * Links between the imported pages are repointed at the notes actually written,
 * resolved through the file they point at rather than by title — so a
 * Confluence export's `12345.html` links keep working instead of going dead.
 *
 * `detect` deliberately stays quiet: HTML in a folder is what half a dozen
 * tools export, and claiming another source's export would be worse than
 * letting the user pick the tile.
 */
export class HtmlFolderImporter implements ImportSource {
  readonly id: ImportSourceId = 'html_folder';
  readonly name = 'HTML folder / ZIP (incl. Confluence space export)';
  readonly family: ImportFamily = 'xml';
  readonly description =
    'Imports HTML pages as Markdown notes, with the links between them repointed. Also reads a Confluence space export.';
  readonly detectPriority = 3;
  readonly options = [{ key: 'preserveTimestamps' as const, defaultValue: true }];
  readonly pickModes = ['files', 'folder'] as const;

  /**
   * Every page's note path, keyed by its source path.
   *
   * Built before anything is written, because a link can point forwards: page A
   * links to page B long before B has been converted.
   */
  private planPaths(pages: UnpackedFile[]): Map<string, { path: string; title: string }> {
    const plan = new Map<string, { path: string; title: string }>();
    const taken = new Set<string>();

    for (const page of pages) {
      const fallback = page.relativePath.split('/').pop()?.replace(HTML_RE, '') ?? 'Page';
      const { title } = htmlTitleAndBody(page.content ?? '', fallback);
      const folder = page.relativePath.split('/').slice(0, -1).join('/');
      const stem = safeName(title, fallback);

      let candidate = folder ? `${folder}/${stem}.md` : `${stem}.md`;
      let n = 2;
      while (taken.has(candidate.toLowerCase())) {
        candidate = folder ? `${folder}/${stem} (${n}).md` : `${stem} (${n}).md`;
        n += 1;
      }
      taken.add(candidate.toLowerCase());
      plan.set(page.relativePath, { path: candidate, title });
    }

    return plan;
  }

  /** Points Markdown links at the notes this run writes. */
  private repointLinks(
    markdown: string,
    fromPath: string,
    plan: Map<string, { path: string; title: string }>
  ): string {
    return markdown.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, text: string, href: string) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return whole;
      const target = plan.get(resolveRelative(fromPath, decodeURIComponent(href.split('#')[0])));
      if (!target) return whole;
      const label = text.trim();
      return label && label !== target.title ? `[[${target.title}|${label}]]` : `[[${target.title}]]`;
    });
  }

  async detect(): Promise<boolean> {
    return false;
  }

  async analyze(input: UnpackedFile[], _opts: ImportOptions): Promise<ImportPlan> {
    const files = Array.isArray(input) ? input : [];
    const pages = files.filter((f) => isHtml(f));
    const attachments = files.filter((f) => !isTextEntry(f));

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: pages.length,
      totalAttachments: attachments.length,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings: pages.length === 0 ? ['No HTML pages found in the selection.'] : [],
      requiredSpaceBytes: files.reduce((acc, f) => acc + (f.byteSize ?? f.content?.length ?? 0), 0),
      estimatedDurationSec: Math.max(1, Math.ceil(pages.length / 50)),
    };
  }

  async run(
    input: UnpackedFile[],
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const files = Array.isArray(input) ? input : [];
    const pages = files.filter((f) => isHtml(f));
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();

    // Keeps its place in the export, so a relative <img src> still resolves.
    const attachments = await copyArchiveAttachments(files, writer, opts, labels);
    if (attachments.lost > 0) writer.noteLimitation(labels.limitBinaryFilesInZip);

    return writer.runGuarded(this, startTime, async () => {
      const plan = this.planPaths(pages);
      let sawStructure = false;

      for (let i = 0; i < pages.length; i += 1) {
        writer.abortIfRequested();
        const page = pages[i];
        const planned = plan.get(page.relativePath);
        if (!planned) continue;

        try {
          const fallback = page.relativePath.split('/').pop()?.replace(HTML_RE, '') ?? 'Page';
          const { title, body } = htmlTitleAndBody(page.content ?? '', fallback);
          const markdown = this.repointLinks(htmlToMarkdown(body), page.relativePath, plan);

          // The converter turns a table into its cells' text: honest to say so
          // rather than let the reader discover it in the note.
          const flattened = /<t(?:able|r|d)\b/i.test(page.content ?? '') || /<pre\b/i.test(page.content ?? '');
          if (flattened) sawStructure = true;

          await writer.writeNote(planned.path, `# ${title}\n\n${markdown.trim()}\n`, {
            details: flattened ? labels.degradedHtmlStructure : undefined,
            times: timesFromFile(page),
          });
        } catch (error) {
          writer.recordFailure(page.relativePath, error);
        }

        if (onProgress && pages.length > 0) {
          onProgress(Math.round(((i + 1) / pages.length) * 100), `Importing ${page.relativePath}...`);
        }
      }

      if (sawStructure) writer.noteLimitation(labels.degradedHtmlStructure);
    });
  }
}
