import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * A folder the USER picked on the device, held through an opaque handle
 * (external vault folder plan, P3). Android answers with a Storage Access
 * Framework tree (a persisted content URI), iOS with a security-scoped
 * bookmark of the folder the document picker returned. The WebView never sees
 * a tree URI or an absolute path: `handle` is a string only the native side
 * can interpret — the same line the atomic writer draws with `(rootId,
 * relPath)`.
 *
 * Two states the native side reports instead of failing on them: a handle
 * whose permission is GONE (folder moved or deleted, bookmark stale, grant
 * revoked) and a location the platform refuses to hand out (Android 11's
 * block list: Downloads root, the storage root). Both arrive as plain results
 * so the UI can name them; only real I/O errors reject.
 */
export interface VaultFolderEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  /** Last modification, ms since the epoch; 0 where the platform has none. */
  mtime: number;
  /** Creation time where the platform has it (iOS); absent otherwise. */
  ctime?: number;
}

export type VaultFolderAccess =
  /** Readable and writable right now. */
  | { state: "ok"; label: string }
  /** The grant is gone — folder moved/deleted, bookmark stale, permission revoked. */
  | { state: "expired"; label: string }
  /** The handle is unreadable garbage (never happens for a handle we issued). */
  | { state: "invalid" };

export type PickFolderResult =
  | { picked: true; handle: string; label: string }
  | { picked: false; reason: "cancelled" | "notPickable" };

export interface VaultFolderNative {
  pickFolder(): Promise<PickFolderResult>;
  resolve(opts: { handle: string }): Promise<VaultFolderAccess>;
  release(opts: { handle: string }): Promise<void>;
  /** ONE listing query per folder (SAF: DocumentsContract with a projection). */
  list(opts: { handle: string; path: string }): Promise<{ entries: VaultFolderEntry[] }>;
  stat(opts: { handle: string; path: string }): Promise<{ entry: VaultFolderEntry | null }>;
  read(opts: { handle: string; path: string }): Promise<{ dataBase64: string }>;
  write(opts: { handle: string; path: string; dataBase64: string }): Promise<void>;
  delete(opts: { handle: string; path: string; recursive: boolean }): Promise<void>;
  rename(opts: { handle: string; from: string; to: string }): Promise<void>;
  mkdir(opts: { handle: string; path: string }): Promise<void>;
}

const VaultFolder = registerPlugin<VaultFolderNative>("VaultFolder");

/** The picker and the folder access exist only on the native shells. */
export function isVaultFolderSupported(): boolean {
  return Capacitor.isNativePlatform();
}

export function getVaultFolderPlugin(): VaultFolderNative {
  return VaultFolder;
}

/** Which platform issued a handle — a bookmark cannot be resolved on Android and vice versa. */
export type VaultFolderPlatform = "android" | "ios";

export function currentVaultFolderPlatform(): VaultFolderPlatform | null {
  const p = Capacitor.getPlatform();
  return p === "android" || p === "ios" ? p : null;
}
