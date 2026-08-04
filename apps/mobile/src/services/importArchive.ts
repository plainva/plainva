import { unzip } from "fflate";
import {
  classifyArchiveEntry,
  DEFAULT_EXTRACT_LIMITS,
  isTextPath,
  type ExtractSkipReason,
  type UnpackedFile,
} from "@plainva/core";

/**
 * Unpacking an import archive on the phone (S40).
 *
 * The desktop streams entries to a temp folder through a Rust extractor. A
 * phone has no such command, so this unzips in the WebView — but it obeys the
 * SAME rules, which is why they live in @plainva/core: which entries count as
 * text, which paths may be written, and the ceilings. Anything the shared
 * classifier refuses is reported as skipped rather than quietly dropped, so
 * the import report can say what did not come along.
 *
 * Entries stay in memory as bytes instead of being written to a temp folder:
 * the importers read `content` for text and the writer copies attachments from
 * `bytes`, and a phone has no temp directory worth managing. The ceilings are
 * therefore also what keeps a hostile archive from filling the heap.
 */

export interface MobileUnpackedFile extends UnpackedFile {
  /** Raw entry bytes — attachments the writer copies without decoding. */
  bytes?: Uint8Array;
}

export interface ExtractedArchive {
  files: MobileUnpackedFile[];
  skipped: Array<{ relativePath: string; reason: ExtractSkipReason }>;
  totalBytes: number;
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, files) => (err ? reject(err) : resolve(files)));
  });
}

/**
 * Unpacks a zip the user picked.
 *
 * Decoding is per entry and failure is per entry: an archive with one
 * undecodable file still imports the rest, because the alternative — failing
 * the run — is how someone loses an export they cannot re-create.
 */
export async function extractArchive(
  data: Uint8Array,
  limits = DEFAULT_EXTRACT_LIMITS,
): Promise<ExtractedArchive> {
  const entries = await unzipAsync(data);
  const files: MobileUnpackedFile[] = [];
  const skipped: ExtractedArchive["skipped"] = [];
  const written = { entries: 0, totalBytes: 0 };

  for (const [relativePath, bytes] of Object.entries(entries)) {
    // fflate yields directory entries as empty payloads with a trailing slash;
    // the shared guard already calls those unsafe, so they land in `skipped`
    // only if they are not plain directories.
    if (relativePath.endsWith("/")) continue;

    const reason = classifyArchiveEntry(
      { relativePath, byteSize: bytes.byteLength },
      written,
      limits,
    );
    if (reason) {
      skipped.push({ relativePath, reason });
      continue;
    }

    written.entries += 1;
    written.totalBytes += bytes.byteLength;

    if (!isTextPath(relativePath)) {
      files.push({ relativePath, content: "", isText: false, byteSize: bytes.byteLength, sourcePath: relativePath, bytes });
      continue;
    }
    try {
      // fatal: a mislabelled binary must not become mojibake in a note.
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      files.push({ relativePath, content, isText: true, byteSize: bytes.byteLength });
    } catch {
      files.push({ relativePath, content: "", isText: false, byteSize: bytes.byteLength, sourcePath: relativePath, bytes });
    }
  }

  return { files, skipped, totalBytes: written.totalBytes };
}

/** Whether a picked file looks like an archive rather than a single document. */
export function isArchiveName(name: string): boolean {
  return name.toLowerCase().endsWith(".zip");
}

/**
 * Turns the files a user picked into the importers' input.
 *
 * A single archive is unpacked; anything else is taken as the selection it is,
 * which is how the phone offers "a folder of Markdown" — the document picker
 * returns the files, not the folder.
 */
export async function unpackSelection(picked: File[]): Promise<ExtractedArchive> {
  if (picked.length === 1 && isArchiveName(picked[0].name)) {
    return extractArchive(new Uint8Array(await picked[0].arrayBuffer()));
  }

  const files: MobileUnpackedFile[] = [];
  const skipped: ExtractedArchive["skipped"] = [];
  const written = { entries: 0, totalBytes: 0 };

  for (const file of picked) {
    // webkitRelativePath is set when a whole folder was picked and carries the
    // structure the importers need; a plain multi-select has only the name.
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const reason = classifyArchiveEntry({ relativePath, byteSize: file.size }, written);
    if (reason) {
      skipped.push({ relativePath, reason });
      continue;
    }
    written.entries += 1;
    written.totalBytes += file.size;

    if (!isTextPath(relativePath)) {
      files.push({
        relativePath,
        content: "",
        isText: false,
        byteSize: file.size,
        sourcePath: relativePath,
        mtimeMs: file.lastModified || undefined,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      continue;
    }
    files.push({
      relativePath,
      content: await file.text(),
      isText: true,
      byteSize: file.size,
      mtimeMs: file.lastModified || undefined,
    });
  }

  return { files, skipped, totalBytes: written.totalBytes };
}

/**
 * A reader for the writer's `readSourceBytes` hook.
 *
 * The desktop hands out temp-folder paths; the phone keeps entries in memory,
 * so `sourcePath` is the relative path and this looks it up. Without the hook
 * the importers can SEE an attachment and still not carry it over — they would
 * report it as skipped, which is honest but needlessly lossy.
 */
export function archiveByteReader(archive: ExtractedArchive): (sourcePath: string) => Promise<Uint8Array | null> {
  const byPath = new Map<string, Uint8Array>();
  for (const file of archive.files) if (file.bytes) byPath.set(file.relativePath, file.bytes);
  return async (sourcePath: string) => byPath.get(sourcePath) ?? null;
}
