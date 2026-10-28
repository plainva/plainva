/**
 * The sync moved a file on this phone (third review 2026-10-27): the content of
 * a file the provider refused for good went to a copy that goes up. The note
 * open on `from` switches to `to` at once - carrying what it has not saved
 * yet - instead of finding the file gone at its next save.
 */
export const FILE_MOVED_EVENT = "m-file-moved";

export interface FileMovedDetail {
  from: string;
  to: string;
  vaultId: string;
}
