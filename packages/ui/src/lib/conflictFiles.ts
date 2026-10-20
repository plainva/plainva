/**
 * Helpers around sync conflict copies (P3.11). The worker names them
 * `<base>.CONFLICT-<iso-stamp><ext>` (SyncWorker.preserveLocalAsConflict);
 * resolving needs the reverse mapping back to the original path.
 */
import { isNotTextFileError, updateVaultText, type IVaultAdapter, type TextUpdateFiles } from "@plainva/core";

export function isConflictCopyPath(path: string): boolean {
  return conflictOriginalPath(path) !== null;
}

/** `Notes/a.CONFLICT-2026-07-05T12-30-00-000Z.md` -> `Notes/a.md`; null if not a conflict copy. */
export function conflictOriginalPath(conflictPath: string): string | null {
  const marker = conflictPath.lastIndexOf(".CONFLICT-");
  if (marker < 0 || marker < Math.max(conflictPath.lastIndexOf("/"), conflictPath.lastIndexOf("\\"))) return null;
  const suffix = conflictPath.slice(marker + ".CONFLICT-".length);
  const dot = suffix.lastIndexOf(".");
  return conflictPath.slice(0, marker) + (dot >= 0 && dot < suffix.length - 1 ? suffix.slice(dot) : "");
}

/**
 * Builds a conflict-copy sibling path for `path` — the same grammar the sync
 * worker uses (`<base>.CONFLICT-<iso-stamp><ext>`), so conflictOriginalPath
 * and the conflict banners resolve editor-preserved drafts identically.
 */
export function conflictCopyPath(path: string, now: Date = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const extMatch = path.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1] : "";
  const base = extMatch ? path.substring(0, path.length - ext.length) : path;
  return `${base}.CONFLICT-${timestamp}${ext}`;
}

/** A text kept beside its file by `keepTextBeside`: where it lies, and what was written there. */
export interface KeptText {
  copy: string;
  text: string;
}

/**
 * Keeps a text an editor could not save as a conflict copy beside its file,
 * and says where (finding 2026-10-11, both shells).
 *
 * For the one save no merge and no conflict session can take: the file turned
 * into no text while the editor held changes — another program saved it in
 * another encoding, or a pull brought such a version. No text is written over
 * such a file, and the person's text must not stay in a journal nobody shows.
 * Beside the file it is a conflict like any other: the comparison offers to
 * take the copy in the file's place, keep both or let the copy go — byte for
 * byte, since the file is no text. Like every conflict copy it stays on this
 * device (the sync leaves `.CONFLICT` files alone).
 *
 * `earlier` is what the same editor kept before, since it last loaded the
 * file and since the file last took its text: typing that went on while a
 * keep ran is kept into that same copy — one copy for one buffer, the one the
 * banner and the card point to — as long as the copy still holds what was
 * kept there. A copy somebody changed or removed meanwhile is left alone, and
 * a new one is made; so is a copy of another file.
 */
export async function keepTextBeside(
  files: TextUpdateFiles & Pick<IVaultAdapter, "exists" | "writeTextFile">,
  path: string,
  text: string,
  earlier: KeptText | null = null,
  now: Date = new Date(),
): Promise<KeptText> {
  if (earlier && conflictOriginalPath(earlier.copy) === path && await files.exists(earlier.copy)) {
    // Asked and written in one step of the vault: the copy takes the newer
    // text only as long as it still holds what was kept there.
    const unchanged = Symbol("changed");
    try {
      await updateVaultText(files, earlier.copy, (held) => {
        if (held !== earlier.text) throw unchanged;
        return text;
      });
      return { copy: earlier.copy, text };
    } catch (error) {
      if (error !== unchanged && !isNotTextFileError(error)) throw error;
    }
  }
  // The time names the copy, a random part keeps two editors that keep in the
  // same millisecond (a split pane, a second window) off each other's copy.
  const stamped = conflictCopyPath(path, now);
  const ext = path.match(/(\.[^.]+)$/)?.[1] ?? "";
  const named = () => {
    const id = globalThis.crypto.randomUUID().slice(0, 8);
    return ext ? `${stamped.slice(0, -ext.length)}-${id}${ext}` : `${stamped}-${id}`;
  };
  let copy = named();
  while (await files.exists(copy)) copy = named();
  await files.writeTextFile(copy, text);
  return { copy, text };
}

/**
 * The newest conflict copy beside `path` — kept by an editor or left by the
 * sync —, or null. For a file that is no text, where no conflict session
 * leads to it: both shells show the way to it from there (finding
 * 2026-10-11). The stamp in the name orders the copies.
 */
export async function newestConflictCopy(files: Pick<IVaultAdapter, "listDir">, path: string): Promise<string | null> {
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const copies = (await files.listDir(folder, false))
    .filter((entry) => !entry.isDirectory && conflictOriginalPath(entry.path) === path)
    .map((entry) => entry.path)
    .sort();
  return copies[copies.length - 1] ?? null;
}
