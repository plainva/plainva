import JSZip from 'jszip';

export interface UnpackedFile {
  relativePath: string;
  content: string;
}

/**
 * Reads a ZIP file buffer or ArrayBuffer and extracts all text files (.json, .md, .enex, .html, .csv, .txt)
 * into an array of { relativePath, content }.
 */
export async function unpackZipArchive(data: ArrayBuffer | Uint8Array | Buffer): Promise<UnpackedFile[]> {
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(data);
  const files: UnpackedFile[] = [];

  const textExtensions = ['.json', '.md', '.markdown', '.enex', '.html', '.csv', '.txt', '.org'];

  for (const [relativePath, entry] of Object.entries(loadedZip.files)) {
    if (entry.dir) continue;
    const lower = relativePath.toLowerCase();
    const isText = textExtensions.some(ext => lower.endsWith(ext));

    if (isText) {
      try {
        const text = await entry.async('string');
        files.push({ relativePath, content: text });
      } catch {
        // Skip binary or corrupt files
      }
    }
  }

  return files;
}
