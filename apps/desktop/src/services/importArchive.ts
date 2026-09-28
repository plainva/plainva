import { invoke } from '@tauri-apps/api/core';
import { isTextPath, readTarEntries, JEX_LIMITS, checkArchiveAbort, type ArchiveReadControl, type UnpackedFile, trimEndChars } from '@plainva/core';

// The text-extension list moved to @plainva/core in S40 so the phone decodes
// the same entries as text; re-exported because callers here import it.
export { isTextPath };

/**
 * Unpacks an import archive through the native extractor.
 *
 * The webview used to do this with JSZip, which decoded a fixed list of text
 * extensions and dropped everything else — so no importer could ever see an
 * attachment. The Rust command streams every entry to a temp folder instead
 * (with size ceilings, symlink skipping and the same path guard the atomic
 * writer uses); this module decides which of those entries to decode as text
 * and hands the rest on as byte references.
 */

interface NativeEntry {
  rel_path: string;
  size: number;
  modified_ms: number | null;
}

interface NativeSkipped {
  rel_path: string;
  reason: string;
}

interface NativeResult {
  root: string;
  entries: NativeEntry[];
  skipped: NativeSkipped[];
  total_bytes: number;
}

export interface ExtractedArchive {
  /** Temp folder holding the entries; hand it to `discardExtractedArchive`. */
  root: string;
  files: UnpackedFile[];
  /** Entries the extractor refused (oversized, symlink, unsafe path). */
  skipped: Array<{ relativePath: string; reason: string }>;
  readSourceBytes?: (sourcePath: string) => Promise<Uint8Array | null>;
}

export async function extractArchive(archivePath: string, control: ArchiveReadControl = {}): Promise<ExtractedArchive> {
  checkArchiveAbort(control.signal);
  const result = await invoke<NativeResult>('extract_archive', { archivePath });
  if (/\.(jex|tar)$/i.test(archivePath)) {
    try {
      const archive = await readStagedTar(result, control);
      if (/\.jex$/i.test(archivePath)) {
        if (!archive.files.length) throw new Error('import.jexInvalid');
        archive.files.forEach(file => { file.sourceFormat = 'jex'; });
      }
      return archive;
    }
    catch (error) { await discardExtractedArchive(result.root); throw error; }
  }
  const { readTextFile } = await import('@tauri-apps/plugin-fs');

  const files: UnpackedFile[] = [];
  for (const entry of result.entries) {
    const sourcePath = `${result.root}/${entry.rel_path}`;
    const base = {
      relativePath: entry.rel_path,
      byteSize: entry.size,
      sourcePath,
      mtimeMs: entry.modified_ms ?? undefined,
    };

    if (!isTextPath(entry.rel_path)) {
      files.push({ ...base, content: '', isText: false });
      continue;
    }

    try {
      files.push({ ...base, content: await readTextFile(sourcePath), isText: true });
    } catch {
      // Undecodable despite the extension — pass it on as bytes rather than
      // dropping it, so the importer can still report the entry.
      files.push({ ...base, content: '', isText: false });
    }
  }

  return {
    root: result.root,
    files,
    skipped: result.skipped.map((s) => ({ relativePath: s.rel_path, reason: s.reason })),
  };
}

interface TarReadFs {
  open(path: string, options: { read: boolean }): Promise<{ seek(offset: number, whence: number): Promise<unknown>; read(bytes: Uint8Array): Promise<number | null>; close(): Promise<void> }>;
  SeekMode: { Start: number };
}
export async function readStagedTar(result: NativeResult, control: ArchiveReadControl = {}, fs?: TarReadFs): Promise<ExtractedArchive> {
  const { open, SeekMode } = fs ?? await import('@tauri-apps/plugin-fs');
  const staged = `${result.root}/source.tar`;
  const source = await open(staged, { read: true });
  const read = async (offset: number, length: number) => {
    checkArchiveAbort(control.signal);
    await source.seek(offset, SeekMode.Start);
    const bytes = new Uint8Array(length);
    let readCount = 0;
    while (readCount < length) {
      checkArchiveAbort(control.signal);
      const n = await source.read(bytes.subarray(readCount, Math.min(length, readCount + 256 * 1024)));
      if (!n) throw new Error('import.archiveInvalid');
      readCount += n;
    }
    return bytes;
  };
  const files: UnpackedFile[] = [];
  const ranges = new Map<string, { offset: number; size: number }>();
  try {
    const entries = await readTarEntries({ size: result.total_bytes, read }, { ...control, onProgress: n => control.onProgress?.(Math.floor(n * 0.6)) });
    let textBytes = 0;
    for (const entry of entries) {
      checkArchiveAbort(control.signal);
      const sourcePath = `${result.root}/@${entry.offset}:${entry.size}`;
      ranges.set(sourcePath, entry);
      const file: UnpackedFile = { relativePath: entry.relativePath, sourcePath, byteSize: entry.size, mtimeMs: entry.mtimeMs, content: '', isText: false };
      if (isTextPath(entry.relativePath) && !entry.relativePath.startsWith('resources/')) {
        if (entry.size > JEX_LIMITS.maxTextEntryBytes || (textBytes += entry.size) > JEX_LIMITS.maxTextBytes) throw new Error('import.archiveTooLarge');
        try { file.content = new TextDecoder('utf-8', { fatal: true }).decode(await read(entry.offset, entry.size)); file.isText = true; }
        catch (error) { if (!(error instanceof TypeError)) throw error; }
      }
      files.push(file);
      control.onProgress?.(60 + Math.floor(files.length / Math.max(entries.length, 1) * 40));
    }
  } finally { await source.close(); }
  return { root: result.root, files, skipped: [], readSourceBytes: async path => {
    const range = ranges.get(path);
    if (!range) return null;
    const handle = await open(staged, { read: true });
    try {
      await handle.seek(range.offset, SeekMode.Start);
      const bytes = new Uint8Array(range.size);
      let n = 0;
      while (n < bytes.length) {
        const chunk = await handle.read(bytes.subarray(n, Math.min(n + 256 * 1024, bytes.length)));
        if (!chunk) throw new Error('import.archiveInvalid');
        n += chunk;
      }
      return bytes;
    } finally { await handle.close(); }
  } };
}

/**
 * Ceilings for a folder import. The ZIP path gets its limits from the native
 * extractor; a folder has none of its own, and the text of every note goes
 * through renderer memory — the same exhaustion the native extractor was built
 * to avoid (see the module header). Generous enough for a real vault, low
 * enough that picking a home directory by accident reports instead of hangs.
 */
const FOLDER_MAX_ENTRIES = 20_000;
const FOLDER_MAX_TEXT_BYTES = 256 * 1024 * 1024;

/** Folders that are never part of an import, whichever app wrote them. */
const FOLDER_SKIP = /^(\.git|node_modules|\.obsidian|\.trash|\.plainva|\.smart-env|\.stfolder)$/i;

/**
 * Reads a picked FOLDER into the same shape `extractArchive` produces (#61).
 *
 * The wizard has offered a folder picker since the import work shipped, and
 * every markdown-family source lists `folder` in its `pickModes` — but nothing
 * ever read one. A picked directory arrived as a single selected "file", so
 * `readTextFile` was called on a directory path, threw, and the catch that
 * exists for an unreadable file swallowed it. The payload stayed empty and
 * `analyze` reported "No notes found in the selection." — which is exactly what
 * the reporter saw, for every Joplin export variant he tried, because he was
 * picking the folder every time.
 *
 * Text entries are decoded (same `isTextPath` list as the archive path) and
 * everything else is passed on as a byte reference, so attachments survive:
 * `sourcePath` is simply where the file already lies.
 */
export interface FolderReadFs {
  readDir: (path: string) => Promise<Array<{ name: string; isDirectory: boolean; isFile: boolean }>>;
  readTextFile: (path: string) => Promise<string>;
  stat: (path: string) => Promise<{ size?: number; mtime?: Date | null }>;
}

export async function readFolderAsFiles(
  folderPath: string,
  // Injected rather than module-mocked: the shell's fs arrives through a
  // dynamic import, and `vi.mock` on a dynamically imported module is not
  // reliable once another test file has already pulled this module in — the
  // walk then either saw the real fs or hung. Passing the three functions makes
  // the test state the input instead of patching the module graph.
  fs?: FolderReadFs,
): Promise<ExtractedArchive> {
  const { readDir, readTextFile, stat } = fs ?? (await import('@tauri-apps/plugin-fs'));

  const files: UnpackedFile[] = [];
  const skipped: Array<{ relativePath: string; reason: string }> = [];
  let textBytes = 0;

  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>;
    try {
      entries = await readDir(absDir);
    } catch {
      skipped.push({ relativePath: relDir || '.', reason: 'unreadable' });
      return;
    }
    for (const entry of entries) {
      if (!entry.name) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = `${absDir}/${entry.name}`;
      if (entry.isDirectory) {
        if (FOLDER_SKIP.test(entry.name)) continue;
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile) continue; // symlinks and specials, as in the extractor
      if (files.length >= FOLDER_MAX_ENTRIES) {
        skipped.push({ relativePath: rel, reason: 'tooLarge' });
        continue;
      }

      let byteSize: number | undefined;
      let mtimeMs: number | undefined;
      try {
        const info = await stat(abs);
        byteSize = info.size ?? undefined;
        mtimeMs = info.mtime ? info.mtime.getTime() : undefined;
      } catch {
        // Dates and sizes are a bonus, never a reason to skip the file.
      }
      const base = { relativePath: rel, byteSize, sourcePath: abs, mtimeMs };

      if (!isTextPath(rel)) {
        files.push({ ...base, content: '', isText: false });
        continue;
      }
      if (textBytes + (byteSize ?? 0) > FOLDER_MAX_TEXT_BYTES) {
        skipped.push({ relativePath: rel, reason: 'tooLarge' });
        continue;
      }
      try {
        const content = await readTextFile(abs);
        textBytes += byteSize ?? content.length;
        files.push({ ...base, content, isText: true });
      } catch {
        files.push({ ...base, content: '', isText: false });
      }
    }
  };

  await walk(trimEndChars(folderPath, '/\\'), '');
  // `root` is the picked folder itself and is NOT a temp directory — the
  // caller must never hand it to `discardExtractedArchive`, which is why the
  // wizard only tracks archives in `extractedRef`.
  return { root: folderPath, files, skipped };
}

/** Removes an extraction folder. Best effort: temp cleanup must never fail a run. */
export async function discardExtractedArchive(root: string): Promise<void> {
  try {
    await invoke('discard_extracted_archive', { root });
  } catch {
    // The OS clears its temp folder eventually.
  }
}
