import { trimChars, trimEndChars } from "../textScan.js";
import { folderIdentity, folderSegments } from "./folderIdentity.js";

/**
 * The folders the sync targets work in and their canonical identities (fourth review of plan "Verbinden", finding 1),
 * apart from the targets themselves (package B1b, 2026-11-27): the vault's open compares the folder a vault is bound
 * to with its settings at the start of both shells, and reading these few functions from the target modules carried
 * every target, its listing parser and fast-xml-parser into the start. Each target imports its root's resolution
 * from here and hands these names on, so `import { driveRootName } from "./DriveSyncTarget.js"` keeps working.
 */

/** The default folder of Drive and OneDrive. */
export const DEFAULT_CLOUD_ROOT = "Plainva";
/** The default folder of Dropbox. */
export const DEFAULT_DROPBOX_ROOT = "/Plainva";

/** The folder path a Drive target looks up, resolved exactly as the target does (default "Plainva"). */
export function driveRootName(rootFolderName?: string): string {
  return rootFolderName || DEFAULT_CLOUD_ROOT;
}

/**
 * Canonical identity of that folder (fourth review of plan "Verbinden",
 * finding 1): its path as the target walks it - Drive names are case
 * sensitive - and, where known, the folder id, which is the folder.
 */
export function driveFolderIdentity(rootFolderName?: string, rootFolderId?: string): { root: string; rootId?: string } {
  const root = folderIdentity(driveRootName(rootFolderName), { caseInsensitive: false }) || DEFAULT_CLOUD_ROOT;
  return rootFolderId ? { root, rootId: rootFolderId } : { root };
}

/** The folder a Dropbox target works in, resolved exactly as the target does (default "/Plainva"). */
export function dropboxRootPath(rootPath?: string): string {
  let root = (rootPath || DEFAULT_DROPBOX_ROOT).replace(/\\/g, "/").trim();
  if (!root.startsWith("/")) root = `/${root}`;
  return trimEndChars(root, "/") || DEFAULT_DROPBOX_ROOT;
}

/** Canonical identity of that folder; Dropbox paths ignore case (fourth review of plan "Verbinden", finding 1). */
export function dropboxFolderIdentity(rootPath?: string): string {
  return folderIdentity(dropboxRootPath(rootPath), { caseInsensitive: true });
}

/** The folder a OneDrive target works in, resolved exactly as the target does (default "Plainva"). */
export function oneDriveRootName(rootFolderName?: string): string {
  return rootFolderName || DEFAULT_CLOUD_ROOT;
}

/** Canonical identity of that folder; OneDrive paths ignore case (fourth review of plan "Verbinden", finding 1). */
export function oneDriveFolderIdentity(rootFolderName?: string): string {
  return folderIdentity(oneDriveRootName(rootFolderName), { caseInsensitive: true }) || folderIdentity(DEFAULT_CLOUD_ROOT, { caseInsensitive: true });
}

/**
 * Canonical identity of the place an S3 target works in (fourth review of
 * plan "Verbinden", finding 1): the endpoint's origin (scheme and host in
 * lower case, a default port dropped), the bucket, and the prefix as the
 * target trims it. Undefined when the endpoint cannot be read - then nothing
 * can be compared, and the caller keeps what it has.
 */
export function s3LocationIdentity(creds: { endpoint: string; bucket: string; prefix?: string }): string | undefined {
  let origin: string;
  try {
    origin = new URL(creds.endpoint.trim()).origin.toLowerCase();
  } catch {
    return undefined;
  }
  const prefix = folderIdentity(trimChars((creds.prefix ?? "").replace(/\\/g, "/"), "/"), { caseInsensitive: false });
  return `${origin}/${creds.bucket.trim()}/${prefix}`;
}

/**
 * Canonical identity of a WebDAV files root (fourth review of plan
 * "Verbinden", finding 1): scheme and host in lower case, a default port
 * dropped, no trailing slash, segments decoded and NFC. Nextcloud and
 * ownCloud serve the same files under `/remote.php/webdav/` and
 * `/remote.php/dav/files/<user>/`; both become one form, and the owner goes
 * into `account` (lower case: those servers sign in without regard to case,
 * and two spellings of one user are never two targets). Undefined when the
 * address cannot be read - then nothing can be compared.
 */
export function webDavFolderIdentity(url: string, user?: string): { root: string; account?: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  const segments = folderSegments(parsed.pathname).map((segment) => {
    try {
      return decodeURIComponent(segment).normalize("NFC");
    } catch {
      return segment.normalize("NFC");
    }
  });
  let owner: string | undefined;
  const at = segments.findIndex((segment) => segment.toLowerCase() === "remote.php");
  if (at >= 0) {
    const next = segments[at + 1]?.toLowerCase();
    if (next === "webdav") {
      segments.splice(at, 2, "remote.php", "files");
    } else if (next === "dav" && segments[at + 2]?.toLowerCase() === "files" && segments[at + 3]) {
      owner = segments[at + 3].toLowerCase();
      segments.splice(at, 4, "remote.php", "files");
    }
  }
  const login = user?.trim().toLowerCase();
  const account = login || owner;
  const root = `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}/${segments.join("/")}`;
  return account ? { root, account } : { root };
}
