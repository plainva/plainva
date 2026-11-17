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
  sha256(opts: { path: string; directory?: "DATA" | "DOCUMENTS" | "LIBRARY" | "CACHE" }): Promise<{ sha256: string; size: number }>;
  /** A write in parts: the temp file in the target's folder. */
  begin(opts: { path: string; directory?: "DATA" | "LIBRARY" }): Promise<{ id: string }>;
  /** One part, base64. */
  append(opts: { id: string; data: string }): Promise<void>;
  /** Syncs the temp file and renames it over the target. */
  commit(opts: { id: string }): Promise<void>;
  /** Drops the temp file. */
  abort(opts: { id: string }): Promise<void>;
  /** Opens a file for a read in parts: every part comes from this one open file, so from one version of it. */
  openRead(opts: { path: string; directory?: "DATA" | "LIBRARY" }): Promise<{ id: string; size: number }>;
  /** At most `length` bytes (and never more than one part) from `offset` of an open read, base64. */
  readPart(opts: { id: string; offset: number; length: number }): Promise<{ data: string; size?: number }>;
  closeRead(opts: { id: string }): Promise<void>;
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
/** One lane per target: writes to one file run in the order they began, so the last begun is the one that stays. */
const writeLanes = new Map<string, Promise<void>>();

async function nativeWriteBytes(path: string, bytes: Uint8Array, directory?: NativeDirectory): Promise<void> {
  const key = `${directory ?? "DATA"}:${path}`;
  const before = writeLanes.get(key) ?? Promise.resolve();
  const mine = before.catch(() => {
    // silent: the write before this one has its own caller, who hears of its failure.
  }).then(() => writeInParts(path, bytes, directory));
  const settled = mine.catch(() => {
    // silent: this write's failure goes to its caller through `mine`; the lane only waits for it.
  });
  writeLanes.set(key, settled);
  void settled.then(() => { if (writeLanes.get(key) === settled) writeLanes.delete(key); });
  return mine;
}

async function writeInParts(path: string, bytes: Uint8Array, directory?: NativeDirectory): Promise<void> {
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

/** The most whole-file reads at once on a phone, in each of the two lanes (see `nativeReadBytes`). */
export const MAX_OPEN_READS = 2;

/** Whose read it is: what the person is opening, or a body the network brought in the background. */
export type ReadLane = "foreground" | "background";

const lanes: Record<ReadLane, { open: number; waiting: Array<() => void> }> = {
  foreground: { open: 0, waiting: [] },
  background: { open: 0, waiting: [] },
};

/** A turn for one whole-file read in its lane; the returned call hands it on to the next waiting read, or frees it. */
async function readSlot(lane: ReadLane): Promise<() => void> {
  const slots = lanes[lane];
  if (slots.open < MAX_OPEN_READS) slots.open += 1;
  else await new Promise<void>((resume) => slots.waiting.push(resume));
  return () => {
    const next = slots.waiting.shift();
    if (next) next();
    else slots.open -= 1;
  };
}

/**
 * A file's bytes through the native plugin, one part per call. A file that
 * changes size while it is read is read again, so the answer is one version
 * of it, never the front of one and the end of another.
 *
 * At most `MAX_OPEN_READS` files are read at once in each lane: a note with
 * twenty embedded 3 MB pictures, the pinboard, the covers of a database and the
 * index would otherwise hold all of them in the page at the same moment
 * (17.11.). The bodies of downloads (`webdavHttp.ts`) read in a lane of their
 * own, so what the person opens never waits behind two large downloads.
 *
 * The file is opened once and every part read through that open file: one
 * replaced by a rename meanwhile (a sync pull, a save, the Files app) is read
 * as the version that was opened, never the front of one and the end of
 * another.
 */
export async function nativeReadBytes(path: string, directory?: NativeDirectory, lane: ReadLane = "foreground"): Promise<Uint8Array> {
  const release = await readSlot(lane);
  try {
    return await readWholeFile(path, directory);
  } finally {
    release();
  }
}

/** How often a read starts again on a file written in place while it is read, before it gives up. */
const READ_ATTEMPTS = 3;

async function readWholeFile(path: string, directory?: NativeDirectory): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt += 1) {
    const result = await readOnce(path, directory);
    if (result) return result;
    // Written in place while it was read (not renamed: that leaves this read on the old version).
    if (attempt >= READ_ATTEMPTS) throw new Error(`${path} kept changing while it was read`);
  }
}

/** One read through one open file; null when the file's length changed under it - never part of a file. */
async function readOnce(path: string, directory?: NativeDirectory): Promise<Uint8Array | null> {
  const { id, size } = await AtomicFile.openRead({ path, ...(directory ? { directory } : {}) });
  try {
    const bytes = new Uint8Array(size);
    let filled = 0;
    let now = size;
    while (filled < size) {
      const answer = await AtomicFile.readPart({ id, offset: filled, length: BRIDGE_PART_BYTES });
      if (typeof answer.size === "number") now = answer.size;
      if (now !== size) return null;
      const part = base64ToPart(answer.data);
      if (part.length === 0 || filled + part.length > size) return null;
      bytes.set(part, filled);
      filled += part.length;
    }
    // The last part's answer carried the length at that moment. An empty file has no part: asked once.
    if (size === 0) {
      const last = await AtomicFile.readPart({ id, offset: 0, length: 1 });
      if (typeof last.size === "number" && last.size !== 0) return null;
    }
    return bytes;
  } finally {
    await AtomicFile.closeRead({ id }).catch(() => {
      // silent: an open read nobody closes is closed by the plugin after two minutes.
    });
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
export async function nativeFileDigest(path: string, directory?: "DATA" | "DOCUMENTS" | "CACHE"): Promise<{ sha256: string; size: number } | null> {
  if (!Capacitor.isNativePlatform()) return null;
  return AtomicFile.sha256({ path, ...(directory ? { directory } : {}) });
}
