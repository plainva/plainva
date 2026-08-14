import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

/**
 * Atomic write bridge (hardening P2 mobile): native platforms go through the
 * local AtomicFile plugin (temp + fsync + rename inside Directory.Data); the
 * web dev server keeps Filesystem.writeFile — its IndexedDB backend commits
 * puts transactionally, so a direct write is already atomic there.
 */

interface AtomicFilePluginApi {
  write(opts: { path: string; data: string; encoding: "utf8" | "base64" }): Promise<void>;
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

export async function atomicWriteBase64(path: string, dataB64: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await AtomicFile.write({ path, data: dataB64, encoding: "base64" });
    return;
  }
  await Filesystem.writeFile({ path, directory: Directory.Data, data: dataB64, recursive: true });
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
