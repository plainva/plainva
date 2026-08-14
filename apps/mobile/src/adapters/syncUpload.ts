import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import type { ContentRefResolver, SyncContentRef, SyncUploader } from "@plainva/core";
import { nativeFileDigest } from "../platform/atomicFile";
import { webdavRequest } from "./webdavHttp";

/**
 * Large files leave the vault without passing through the WebView (issue #48).
 *
 * The bridge carries a request body as base64, so a 90 MB attachment first
 * became a ~120 MB string and then a byte array on the native side — enough to
 * freeze or kill the app before a single packet left. Here the content stays on
 * disk: the native layer opens the file itself and streams the requested byte
 * range straight into the socket.
 *
 * `rootId` is the vault's sandbox folder (the CapacitorVaultAdapter's root) and
 * `relPath` the file inside it; together they form the path the native side
 * resolves relative to Directory.Data, with the same containment check the
 * atomic writer uses.
 */

function sandboxPath(ref: SyncContentRef): string {
  return ref.rootId ? `${ref.rootId}/${ref.relPath}` : ref.relPath;
}

/**
 * Answers "can this file be streamed?" for the sync engine: null below the
 * threshold, on the web dev server, or when the file cannot be measured.
 */
export function createContentRefResolver(vaultRoot: string): ContentRefResolver {
  return async (filePath: string, minBytes: number): Promise<SyncContentRef | null> => {
    if (!Capacitor.isNativePlatform()) return null;
    try {
      const full = vaultRoot ? `${vaultRoot}/${filePath}` : filePath;
      // The cheap check first; only a file worth streaming pays for the hash.
      const info = await Filesystem.stat({ path: full, directory: Directory.Data });
      if (info.type !== "file" || (info.size ?? 0) < minBytes) return null;

      const digest = await nativeFileDigest(full);
      if (!digest) return null;
      return { rootId: vaultRoot, relPath: filePath, size: digest.size, sha256: digest.sha256 };
    } catch (err) {
      // Falling back to the buffer path is slower, not broken — this must never
      // decide whether a file syncs at all.
      console.warn(`[syncUpload] cannot stream ${filePath}, falling back to the buffer:`, err);
      return null;
    }
  };
}

/** Streams a byte range of a vault file through the native HTTP bridge. */
export const mobileSyncUploader: SyncUploader = async (req) => {
  const res = await webdavRequest({
    url: req.url,
    method: req.method,
    headers: req.headers ?? {},
    bodyFilePath: sandboxPath(req.ref),
    bodyOffset: req.offset ?? 0,
    bodyLength: req.length ?? req.ref.size,
  });
  return { status: res.status, headers: res.headers, body: res.body };
};
