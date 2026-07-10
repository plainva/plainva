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
