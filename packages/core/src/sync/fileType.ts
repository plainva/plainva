import { utf8TextOf } from "../textFileShape.js";

/**
 * Extensions whose content is meant to be UTF-8 text and is therefore eligible for the
 * 3-way text merge — where its bytes agree (`mergeableText`). Everything else is treated
 * as binary and synced byte-wise (no decode, no merge).
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
 * Whether a vault file's NAME says it is UTF-8 text (mergeable) rather than binary.
 *
 * Unknown or missing extensions are treated as **binary** on purpose: decoding an
 * arbitrary byte stream through `TextDecoder` and writing it back as text corrupts it,
 * so the safe default is byte-wise handling. Binary files are never 3-way merged; on
 * divergence the local copy is preserved as a `.CONFLICT` sibling and the remote is
 * adopted.
 *
 * The name is half of the answer. The sync, before it treats a file's CONTENT
 * as text — merges it, keeps it as a merge base, writes it back — asks
 * `mergeableText`.
 */
export function isTextFile(path: string): boolean {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? TEXT_EXTENSIONS.has(match[1]) : false;
}

/**
 * The one answer to "is this file text?": its name says so AND its bytes are
 * UTF-8. Returns the file's text — with its byte order mark, where it has one —
 * or null for a file that is handled byte for byte, like an image.
 *
 * The name alone used to decide (finding 2026-10-09). A `.csv` in Windows-1252
 * — what Excel saves with German settings — went up byte for byte and came
 * down on the second device as its decoded TEXT: every byte that is not UTF-8
 * replaced, `Grün` no longer `47 72 FC 6E` but `47 72 EF BF BD 6E`. The server
 * and the first device stayed whole until the file was changed on the second
 * one — or on both, which merged the two decoded texts —; then the damaged
 * version went to everyone. UTF-16 the same way.
 *
 * So the sync asks here: the worker for both sides of a pull, the engine for
 * what it pushed. A file that is no text by its bytes has no merge base text,
 * is never merged, and where both sides changed it the local version is kept
 * as a `.CONFLICT` copy — the rule for every other kind of bytes. The indexer,
 * and the marker the conflict-aware adapter records when a file is opened,
 * read a file of this device through `readLocalText`, which answers the same
 * question and gives the hash all of them compare by.
 *
 * What the app itself does with such a file does not ask yet: an editor that
 * opens it, a restored version, a duplicate take the text a reader hands out.
 */
export function mergeableText(path: string, bytes: Uint8Array): string | null {
  return isTextFile(path) ? utf8TextOf(bytes) : null;
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
  // A voice memo is one of these (plan Journal-Erweiterungen, X3/X4): iOS
  // records into an MP4 container, Chromium into WebM. `oga` and `opus` are
  // sound in an Ogg container — without them a recording from a Firefox-based
  // browser would upload as application/octet-stream and refuse to play back.
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
  oga: "audio/ogg", opus: "audio/ogg", aac: "audio/aac",
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
