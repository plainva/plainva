import { ImportLabels, ImportOptions, UnpackedFile, isTextEntry } from './ImportTypes.js';
import { ImportWriter } from './ImportWriter.js';
import { normalizePath } from './notionFileLinks.js';
import { timesFromFile } from './sourceTimes.js';

/**
 * Copies the non-text entries of an archive into the import.
 *
 * Until the native extractor landed, an attachment never reached an importer at
 * all — the webview decoded a list of text extensions and dropped the rest. Now
 * the bytes are on disk, so the honest thing is to bring them along instead of
 * listing them as lost.
 *
 * Files keep the relative position they had inside the export. That is not
 * tidiness: a Markdown export references its images relatively, so a picture
 * that stays next to its note keeps working without anyone rewriting a link.
 * Sources that rename paths on the way in (Notion strips its 32-character ids)
 * pass `mapPath` and get the mapping back to repoint their own links.
 */
export interface ArchiveAttachmentResult {
  /** Original archive path (normalized) -> path inside the import. */
  linkMap: Map<string, string>;
  copied: number;
  /** Entries that exist but could not be carried over. */
  lost: number;
}

export async function copyArchiveAttachments(
  files: UnpackedFile[],
  writer: ImportWriter,
  opts: ImportOptions,
  labels: ImportLabels,
  mapPath?: (relativePath: string) => string
): Promise<ArchiveAttachmentResult> {
  const linkMap = new Map<string, string>();
  let copied = 0;
  let lost = 0;

  for (const file of files) {
    if (isTextEntry(file)) continue;
    writer.abortIfRequested();

    const bytes =
      file.sourcePath && typeof opts.readSourceBytes === 'function'
        ? await opts.readSourceBytes(file.sourcePath).catch(() => null)
        : null;

    if (!bytes) {
      // Either nobody can read it here, or reading failed. Both are reportable;
      // neither may pass silently.
      writer.recordSkipped(file.relativePath, labels.skippedAttachment);
      lost += 1;
      continue;
    }

    const target = mapPath ? mapPath(file.relativePath) : file.relativePath;
    try {
      const written = await writer.writeBinary(target, bytes, timesFromFile(file));
      const importRelative =
        writer.prefix && written.startsWith(writer.prefix)
          ? written.slice(writer.prefix.length)
          : written;
      linkMap.set(normalizePath(file.relativePath), importRelative);
      copied += 1;
    } catch (error) {
      writer.recordFailure(file.relativePath, error);
      lost += 1;
    }
  }

  return { linkMap, copied, lost };
}
