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
}

const AtomicFile = registerPlugin<AtomicFilePluginApi>("AtomicFile");

export async function atomicWriteText(path: string, text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await AtomicFile.write({ path, data: text, encoding: "utf8" });
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
  await atomicWriteTextAt(await internalPlace(rel), text);
}

/** Writes text atomically at a place of the app's own files (`internalPlace`, or the move's new place). */
export async function atomicWriteTextAt(place: { path: string; directory: Directory }, text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await AtomicFile.write({ path: place.path, data: text, encoding: "utf8", directory: place.directory === Directory.Library ? "LIBRARY" : "DATA" });
    return;
  }
  await Filesystem.writeFile({ path: place.path, directory: place.directory, encoding: Encoding.UTF8, data: text, recursive: true });
}

export async function atomicWriteBase64(path: string, dataB64: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await AtomicFile.write({ path, data: dataB64, encoding: "base64" });
    return;
  }
  // The web shell keeps what it is handed and hands it back whatever a read
  // asks for. Bytes kept as their base64 string came back from a TEXT read as
  // that string — valid UTF-8, a "text" no file ever held (finding 2026-10-11).
  // Kept as a Blob they stay bytes, and the vault's text read decodes them the
  // way Android's reader does.
  const bytes = Uint8Array.from(atob(dataB64), (character) => character.charCodeAt(0));
  await Filesystem.writeFile({ path, directory: Directory.Data, data: new Blob([bytes]), recursive: true });
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
