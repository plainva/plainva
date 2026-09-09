import { Inflate, Unzip, unzipSync, type AsyncFlateStreamHandler, type FlateError, type UnzipDecoder } from "fflate";
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
  // Validate the central directory without allocating any entry payload.
  unzipSync(data, { filter: () => false });
  const files: MobileUnpackedFile[] = [], skipped: ExtractedArchive["skipped"] = [];
  const written = { entries: 0, totalBytes: 0 };
  let inflatedBytes = 0;
  const archive = new Unzip(file => {
    const relativePath = file.name, directory = relativePath.endsWith("/");
    let stopped = directory, size = 0, chunks: Uint8Array[] = [];
    const reject = (reason: ExtractSkipReason) => {
      if (stopped) return;
      stopped = true; chunks = [];
      skipped.push({ relativePath, reason });
      file.terminate();
    };
    const declared = Number.isFinite(file.originalSize) ? file.originalSize! : 0;
    const reason = classifyArchiveEntry({ relativePath, byteSize: declared }, written, limits);
    if (!directory && reason) reject(reason);
    if (!stopped && inflatedBytes >= limits.maxTotalBytes && declared > 0) reject("too_large");
    if (!stopped && file.compression !== 0 && file.compression !== 8) reject("unreadable");
    file.ondata = (error, chunk, final) => {
      if (stopped) return;
      if (error) { reject("unreadable"); return; }
      inflatedBytes += chunk.byteLength;
      size += chunk.byteLength;
      if (size > limits.maxEntryBytes || inflatedBytes > limits.maxTotalBytes) { reject("too_large"); return; }
      // Copy stored entries as well: retaining a view would retain the entire ZIP.
      if (chunk.byteLength) chunks.push(chunk.slice());
      if (!final) return;
      const bytes = chunks.length === 1 ? chunks[0] : new Uint8Array(size);
      if (chunks.length !== 1) { let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; } }
      chunks = []; written.entries++; written.totalBytes += size;
      if (isTextPath(relativePath)) {
        try {
          files.push({ relativePath, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes), isText: true, byteSize: size });
          return;
        } catch { /* Preserve a mislabelled binary as its original bytes. */ }
      }
      files.push({ relativePath, content: "", isText: false, byteSize: size, sourcePath: relativePath, bytes });
    };
    // Always start a decoder, including a stopped one. Unzip otherwise retains
    // every compressed chunk in case start() is called after the archive ends.
    class EntryDecoder implements UnzipDecoder {
      static compression = file.compression;
      ondata: AsyncFlateStreamHandler = () => {};
      private inflater = !stopped && file.compression === 8
        ? new Inflate((chunk, final) => this.ondata(null, chunk, final)) : undefined;
      terminate() { stopped = true; this.inflater = undefined; }
      push(chunk: Uint8Array, final: boolean) {
        if (stopped) return;
        if (file.compression === 0) { this.ondata(null, chunk.slice(), final); return; }
        try {
          // Bound expansion BEFORE the output callback: one highly compressed
          // input buffer must not allocate its complete uncompressed payload.
          for (let offset = 0; offset < chunk.length && !stopped; offset += 64)
            this.inflater!.push(chunk.subarray(offset, offset + 64), final && offset + 64 >= chunk.length);
          if (!chunk.length && !stopped) this.inflater!.push(chunk, final);
        } catch (error) { this.ondata(error as FlateError, new Uint8Array(), false); }
      }
    }
    archive.register(EntryDecoder); file.start();
  });
  for (let offset = 0; offset < data.length; offset += 4096) {
    archive.push(data.subarray(offset, offset + 4096), offset + 4096 >= data.length);
    if (offset % 65536 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (!data.length) archive.push(data, true);
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
