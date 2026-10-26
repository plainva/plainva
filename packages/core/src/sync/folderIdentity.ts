/**
 * The canonical form of a remote folder, for deciding whether two settings
 * name the SAME folder (fourth review of plan "Verbinden", finding 1).
 *
 * Every target resolves its own root (defaults, slashes); each one exports a
 * small identity function next to it that goes through that resolution and
 * then this helper, so the comparison never re-implements a default. One form
 * per provider, used when the binding is stored and when it is compared.
 */

/** The folder's path segments, as a provider walks them: backslashes are slashes, empty segments do not exist. */
export function folderSegments(path: string): string[] {
  return path.split("\\").join("/").split("/").map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

/** One spelling for one folder: segments joined by "/", NFC, lower case where the provider ignores case. */
export function folderIdentity(path: string, options: { caseInsensitive: boolean }): string {
  const joined = folderSegments(path).join("/").normalize("NFC");
  return options.caseInsensitive ? joined.toLowerCase() : joined;
}
