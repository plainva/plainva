import { invoke } from '@tauri-apps/api/core';
import { isTextPath, type UnpackedFile } from '@plainva/core';

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
}

export async function extractArchive(archivePath: string): Promise<ExtractedArchive> {
  const result = await invoke<NativeResult>('extract_archive', { archivePath });
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

  await walk(folderPath.replace(/[/\\]+$/, ''), '');
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
