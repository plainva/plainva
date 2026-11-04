/**
 * The sync moved a file on this device (third review 2026-10-27): the content
 * of a file the provider refused for good went to a copy that goes up. The
 * editor open on `from` switches to `to` at once - carrying what it has not
 * saved yet - instead of finding the file gone at its next save.
 */
export const FILE_MOVED_EVENT = "plainva-file-moved";

export interface FileMovedDetail {
  from: string;
  to: string;
  vaultPath: string;
}

/**
 * Plainva moved a note in a place that has no tabs of its own to retarget —
 * the overview manager's adoption (Sammelplan § 3.135 Nr. 1). The window's
 * tabs follow the note, as after a rename in the file tree.
 */
export const PATH_RENAMED_EVENT = "plainva-path-renamed";

/** Says that `from` is now `to`, for the tabs of this window. */
export function announcePathRenamed(detail: FileMovedDetail): void {
  window.dispatchEvent(new CustomEvent(PATH_RENAMED_EVENT, { detail }));
}
