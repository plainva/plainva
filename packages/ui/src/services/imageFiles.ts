import { checkedContentPath } from "@plainva/core";
import { mimeTypeForPath } from "@plainva/core";

/**
 * Image dispatch + IO helpers of the in-app image viewer/editor (plan
 * UI-UX-Paket P10). Images open in a Plainva tab; all other attachments keep
 * opening in the OS default app.
 */

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
/** Formats canvas.toBlob can re-encode in the WebView — the rest is view-only
 * (SVG/GIF would lose vector data/animation, BMP/AVIF have no encoder). */
const EDITABLE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

function extensionOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

export function isEditableImage(path: string): boolean {
  return EDITABLE_EXTENSIONS.has(extensionOf(path));
}

/** Encoder mime for saving (viewing uses the blob as-is). */
export function imageMimeType(path: string): string {
  return mimeTypeForPath(path);
}

/** What reads a file a note names: the bytes, and — for a name of an unusual shape — the listing of its folder. */
export interface ContentReader {
  readBinaryFile(path: string): Promise<Uint8Array>;
  listDir?(path?: string, recursive?: boolean): Promise<readonly { name: string }[]>;
}

/**
 * The bytes of a file a note names (an embed, a cover, a card image). Never
 * from the app's own folders; a name of an unusual shape (a Windows device
 * name, a colon, an 8.3 alias) only where the vault's listing holds exactly
 * that name, so on Windows `aux.png` never reaches the AUX device and
 * `PLAINV~1/…` never reaches `.plainva` (F2 review, 2026-11-10).
 */
export async function readContentBinary(adapter: ContentReader, path: string): Promise<Uint8Array> {
  const list = adapter.listDir ? (folder: string) => adapter.listDir!(folder, false) : null;
  return adapter.readBinaryFile(await checkedContentPath(path, list));
}

/**
 * Loads the image as a Blob via the vault adapter. Deliberately NOT
 * convertFileSrc/asset:// — a blob URL never taints the canvas and cannot show
 * a stale cache after saving.
 */
export async function loadImageBlob(
  adapter: ContentReader,
  path: string
): Promise<Blob> {
  const bytes = await readContentBinary(adapter, path);
  // Copy — the Uint8Array may be a view into a larger shared buffer.
  return new Blob([new Uint8Array(bytes)], { type: mimeTypeForPath(path) });
}

/** Encodes the canvas and writes it byte-wise into the vault. */
export async function saveCanvasToVault(
  adapter: { writeBinaryFile(path: string, content: Uint8Array): Promise<void> },
  path: string,
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number
): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) throw new Error(`encoding as ${mime} failed`);
  await adapter.writeBinaryFile(path, new Uint8Array(await blob.arrayBuffer()));
}
