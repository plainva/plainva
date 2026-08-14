import { invoke } from "@tauri-apps/api/core";
import { join, normalize } from "@tauri-apps/api/path";
import { stat } from "@tauri-apps/plugin-fs";
import type { SyncContentRef, SyncUploader } from "@plainva/core";
import type { ContentRefResolver } from "@plainva/core";

/**
 * Large files leave the vault without passing through the renderer (issue #48).
 *
 * `plugin-http` turns a request body into `Array.from(new Uint8Array(buffer))`
 * and then JSON — a 90 MB attachment became ~94 million boxed numbers, past a
 * gigabyte of peak memory, with the main thread blocked for minutes. That is one
 * cause for every symptom the reporter saw at once: freeze, crash, blank window.
 *
 * The native side takes an opaque root handle plus a vault-relative path and
 * streams the file straight to the server, so memory stays flat at any size.
 */

/** Root registrations are idempotent per canonical path; cache per vault. */
const rootIds = new Map<string, Promise<string>>();

function rootIdFor(rootPath: string): Promise<string> {
  let pending = rootIds.get(rootPath);
  if (!pending) {
    pending = invoke<string>("register_write_root", { path: rootPath }).catch((e) => {
      rootIds.delete(rootPath); // retry later (e.g. the root appears afterwards)
      throw e;
    });
    rootIds.set(rootPath, pending);
  }
  return pending;
}

/**
 * Answers "can this file be streamed?" for the sync engine: null for anything
 * below the threshold, unreachable, or outside the vault.
 *
 * The size check runs first and is cheap; only a file worth streaming pays for
 * the native hash — and that hash then replaces the one the engine would
 * otherwise compute by reading the whole file into memory.
 */
export function createContentRefResolver(rootPath: string): ContentRefResolver {
  return async (filePath: string, minBytes: number): Promise<SyncContentRef | null> => {
    try {
      const absolute = await normalize(await join(rootPath, filePath));
      const info = await stat(absolute);
      if (!info.isFile || info.size < minBytes) return null;

      const rootId = await rootIdFor(rootPath);
      const digest = await invoke<{ sha256: string; size: number }>("sync_file_sha256", {
        rootId,
        relPath: filePath,
      });
      return { rootId, relPath: filePath, size: digest.size, sha256: digest.sha256 };
    } catch (err) {
      // Never let this decide whether a file syncs at all: falling back to the
      // buffer path is slower, not broken.
      console.warn(`[syncUpload] cannot stream ${filePath}, falling back to the buffer:`, err);
      return null;
    }
  };
}

/** Streams a byte range of a vault file to `url` through the native client. */
export const tauriSyncUploader: SyncUploader = async (req) => {
  return invoke<{ status: number; headers: Record<string, string>; body: string }>(
    "sync_upload_file",
    {
      request: {
        rootId: req.ref.rootId,
        relPath: req.ref.relPath,
        offset: req.offset,
        length: req.length,
        url: req.url,
        method: req.method,
        headers: req.headers ?? {},
      },
    },
  );
};
