/**
 * Extensions whose content is UTF-8 text and therefore eligible for the 3-way text merge.
 * Everything else is treated as binary and synced byte-wise (no decode, no merge).
 */
const TEXT_EXTENSIONS = new Set([
  "md", "markdown", "mdx", "txt", "text", "org", "rst", "log",
  "json", "jsonc", "yaml", "yml", "toml", "ini", "csv", "tsv",
  "canvas", "base",
  "html", "htm", "xml", "svg",
  "css", "scss", "less", "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "sh", "bash", "zsh", "bat", "ps1",
]);

/**
 * Whether a vault file should be treated as UTF-8 text (mergeable) rather than binary.
 *
 * Unknown or missing extensions are treated as **binary** on purpose: decoding an
 * arbitrary byte stream through `TextDecoder` and writing it back as text corrupts it,
 * so the safe default is byte-wise handling. Binary files are never 3-way merged; on
 * divergence the local copy is preserved as a `.CONFLICT` sibling and the remote is
 * adopted.
 */
export function isTextFile(path: string): boolean {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? TEXT_EXTENSIONS.has(match[1]) : false;
}

const MIME_TYPES: Record<string, string> = {
  md: "text/markdown", markdown: "text/markdown", mdx: "text/markdown",
  txt: "text/plain", text: "text/plain", csv: "text/csv", tsv: "text/tab-separated-values",
  json: "application/json", yaml: "application/yaml", yml: "application/yaml",
  html: "text/html", htm: "text/html", xml: "application/xml", css: "text/css",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  avif: "image/avif", heic: "image/heic", tiff: "image/tiff", tif: "image/tiff",
  pdf: "application/pdf", zip: "application/zip",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
};

/**
 * Best-effort MIME type from a file's extension, for providers that store an explicit
 * content type (Google Drive uses the upload Content-Type as the file's mimeType — a
 * wrong type makes an image show up as a text file). Unknown extensions fall back to
 * `application/octet-stream`.
 */
export function mimeTypeForPath(path: string): string {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return (match && MIME_TYPES[match[1]]) || "application/octet-stream";
}
