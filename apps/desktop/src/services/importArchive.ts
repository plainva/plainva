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

/** Removes an extraction folder. Best effort: temp cleanup must never fail a run. */
export async function discardExtractedArchive(root: string): Promise<void> {
  try {
    await invoke('discard_extracted_archive', { root });
  } catch {
    // The OS clears its temp folder eventually.
  }
}
