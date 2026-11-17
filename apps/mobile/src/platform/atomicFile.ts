import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { internalPlace } from "./internalFiles";

/**
 * Atomic write bridge (hardening P2 mobile): native platforms go through the
 * local AtomicFile plugin (temp + fsync + rename inside Directory.Data); the
 * web dev server keeps Filesystem.writeFile — its IndexedDB backend commits
 * puts transactionally, so a direct write is already atomic there.
 */

interface AtomicFilePluginApi {
  /** `directory` "LIBRARY" (iOS only) writes below Library instead of Documents. */
  write(opts: { path: string; data: string; encoding: "utf8" | "base64"; directory?: "DATA" | "LIBRARY" }): Promise<void>;
  /** Content hash computed natively while streaming the file (issue #48). */
  sha256(opts: { path: string }): Promise<{ sha256: string; size: number }>;
  /** A write in parts: the temp file in the target's folder. */
  begin(opts: { path: string; directory?: "DATA" | "LIBRARY" }): Promise<{ id: string }>;
  /** One part, base64. */
  append(opts: { id: string; data: string }): Promise<void>;
  /** Syncs the temp file and renames it over the target. */
  commit(opts: { id: string }): Promise<void>;
  /** Drops the temp file. */
  abort(opts: { id: string }): Promise<void>;
  /** At most `length` bytes (and never more than one part) from `offset`, base64, with the file's size. */
  read(opts: { path: string; offset: number; length: number; directory?: "DATA" | "LIBRARY" }): Promise<{ data: string; size: number }>;
  /** Removes the temp files a killed process left below `path`. */
  sweep(opts: { path: string; directory?: "DATA" | "LIBRARY" }): Promise<{ removed: number }>;
}

const AtomicFile = registerPlugin<AtomicFilePluginApi>("AtomicFile");

/**
 * The most bytes one call carries across the bridge (before base64).
 *
 * Every call's text is parsed on Android's UI thread before the plugin runs
 * (`MessageHandler.onPostMessage`), and a plugin's answer goes back the same
 * way: a whole 3 MB picture was a 4 MB string there, four at once during a
 * sync pull, and the app stopped answering a few seconds after start
 * (17.11.). So no file crosses in one message: it is written and read in
 * parts of this size - a call stays below 512 KB of text (base64 makes 4 of
 * 3 bytes) - and its hash is taken where it lies (`nativeFileDigest`).
 */
export const BRIDGE_PART_BYTES = 256 * 1024;

type NativeDirectory = "DATA" | "LIBRARY";

function partToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

function base64ToPart(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Writes the bytes atomically through the native plugin: in one call when
 * they fit one part, otherwise in parts into one temp file that is renamed
 * into place only when every part is in (see `BRIDGE_PART_BYTES`). A write
 * that fails part way drops its temp file; the target keeps its old bytes.
 */
async function nativeWriteBytes(path: string, bytes: Uint8Array, directory?: NativeDirectory): Promise<void> {
  const where = directory ? { directory } : {};
  if (bytes.length <= BRIDGE_PART_BYTES) {
    await AtomicFile.write({ path, data: partToBase64(bytes), encoding: "base64", ...where });
    return;
  }
  const { id } = await AtomicFile.begin({ path, ...where });
  try {
    for (let offset = 0; offset < bytes.length; offset += BRIDGE_PART_BYTES) {
      await AtomicFile.append({ id, data: partToBase64(bytes.subarray(offset, offset + BRIDGE_PART_BYTES)) });
    }
    await AtomicFile.commit({ id });
  } catch (error) {
    // silent: the write's own failure is rethrown; the temp file goes, here or at the next sweep.
    await AtomicFile.abort({ id }).catch(() => {});
    throw error;
  }
}

/** The most whole-file reads at once on a phone (see `nativeReadBytes`). */
export const MAX_OPEN_READS = 2;
let openReads = 0;
const waitingReads: Array<() => void> = [];

/** A turn for one whole-file read; the returned call hands it on to the next waiting read, or frees it. */
async function readSlot(): Promise<() => void> {
  if (openReads < MAX_OPEN_READS) openReads += 1;
  else await new Promise<void>((resume) => waitingReads.push(resume));
  return () => {
    const next = waitingReads.shift();
    if (next) next();
    else openReads -= 1;
  };
}

/**
 * A file's bytes through the native plugin, one part per call. A file that
 * changes size while it is read is read again, so the answer is one version
 * of it, never the front of one and the end of another.
 *
 * At most `MAX_OPEN_READS` files are read at once, whoever asks: a note with
 * twenty embedded 3 MB pictures, the pinboard, the covers of a database and the
 * index would otherwise hold all of them in the page at the same moment
 * (17.11.: the phone froze also without a network). The others wait their turn.
 */
export async function nativeReadBytes(path: string, directory?: NativeDirectory): Promise<Uint8Array> {
  const release = await readSlot();
  try {
    return await readWholeFile(path, directory);
  } finally {
    release();
  }
}

async function readWholeFile(path: string, directory?: NativeDirectory): Promise<Uint8Array> {
  const where = directory ? { directory } : {};
  for (let attempt = 0; ; attempt += 1) {
    const first = await AtomicFile.read({ path, offset: 0, length: BRIDGE_PART_BYTES, ...where });
    const size = first.size;
    const bytes = new Uint8Array(size);
    let filled = 0;
    let part = base64ToPart(first.data);
    let steady = true;
    while (true) {
      if (filled + part.length > size) { steady = false; break; }
      bytes.set(part, filled);
      filled += part.length;
      if (filled >= size) break;
      const next = await AtomicFile.read({ path, offset: filled, length: BRIDGE_PART_BYTES, ...where });
      if (next.size !== size) { steady = false; break; }
      part = base64ToPart(next.data);
      if (part.length === 0) { steady = false; break; }
    }
    if (steady) return bytes;
    if (attempt >= 2) throw new Error(`${path} kept changing while it was read`);
  }
}

/**
 * A text file's UTF-8 at a place of the app's own files (`internalPlace`),
 * read in parts on a phone (`BRIDGE_PART_BYTES`), whole in the browser
 * build. Missing throws what the platform says (`isMissingFile`).
 */
export async function readTextAt(place: { path: string; directory: Directory }): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const bytes = await nativeReadBytes(place.path, place.directory === Directory.Library ? "LIBRARY" : "DATA");
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  }
  const res = await Filesystem.readFile({ path: place.path, directory: place.directory, encoding: Encoding.UTF8 });
  if (typeof res.data !== "string") throw new Error(`${place.path} could not be read as text`);
  return res.data;
}

/** Removes the temp files a killed process left below `path` (native only; best effort). */
export async function sweepAtomicTemps(path: string, directory?: NativeDirectory): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await AtomicFile.sweep({ path, ...(directory ? { directory } : {}) });
}

export async function atomicWriteText(path: string, text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await nativeWriteBytes(path, new TextEncoder().encode(text));
    return;
  }
  await Filesystem.writeFile({
    path,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: text,
    recursive: true,
  });
}

/**
 * An app-owned file (`internalFiles.ts`): drafts, journals, AI conversations.
 * `rel` starts with one of `INTERNAL_FOLDERS`; on iOS it lands below Library.
 */
export async function atomicWriteInternalText(rel: string, text: string): Promise<void> {
  const place = await internalPlace(rel);
  if (Capacitor.isNativePlatform()) {
    await nativeWriteBytes(place.path, new TextEncoder().encode(text), place.directory === Directory.Library ? "LIBRARY" : "DATA");
    return;
  }
  await Filesystem.writeFile({ path: place.path, directory: place.directory, encoding: Encoding.UTF8, data: text, recursive: true });
}

/** Writes bytes atomically: on a phone in parts (`BRIDGE_PART_BYTES`), in the browser build as a Blob. */
export async function atomicWriteBytes(path: string, bytes: Uint8Array): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await nativeWriteBytes(path, bytes);
    return;
  }
  // The web shell keeps what it is handed and hands it back whatever a read
  // asks for. Bytes kept as their base64 string came back from a TEXT read as
  // that string — valid UTF-8, a "text" no file ever held (finding 2026-10-11).
  // Kept as a Blob they stay bytes, and the vault's text read decodes them the
  // way Android's reader does.
  await Filesystem.writeFile({ path, directory: Directory.Data, data: new Blob([new Uint8Array(bytes)]), recursive: true });
}

/** `atomicWriteBytes` for bytes given as base64. */
export async function atomicWriteBase64(path: string, dataB64: string): Promise<void> {
  await atomicWriteBytes(path, base64ToPart(dataB64));
}

/**
 * Content hash of a sandbox file WITHOUT reading it into the WebView.
 *
 * The sync needs the hash of every pushed file; pulling a 90 MB attachment
 * through the bridge just to hash it is exactly the memory peak the streamed
 * upload avoids (issue #48). Native only — the web dev server has no such
 * plugin, and no streaming upload either.
 */
export async function nativeFileDigest(path: string): Promise<{ sha256: string; size: number } | null> {
  if (!Capacitor.isNativePlatform()) return null;
  return AtomicFile.sha256({ path });
}
