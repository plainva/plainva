/**
 * Files the operating system writes next to the user's own (issue #110, E10).
 *
 * Finder leaves a `.DS_Store` in every folder it opens, Windows Explorer a
 * `Thumbs.db` and a `desktop.ini`, a custom folder icon becomes a file named
 * `Icon` followed by a carriage return, and the root of a removable volume
 * carries `.Spotlight-V100`, `.Trashes` and `.fseventsd`. None of it is the
 * user's content. It used to appear in the tree as an attachment, travel
 * through sync, and wake the watcher, the index and the sync worker on every
 * Finder write.
 *
 * ONE list, used by the index (`isInternalPath`), the sync filters and the
 * vault templates' emptiness check. Rule for what happens to such a file:
 * never indexed, never uploaded, never downloaded — and a copy that an older
 * version already uploaded stays in the cloud untouched. Excluding a name is
 * never a reason to delete anything anywhere.
 */

/** Lower-cased: Windows and a case-insensitive macOS volume do not care about case. */
export const SYSTEM_JUNK_NAMES: ReadonlySet<string> = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  ".spotlight-v100",
  ".trashes",
  ".fseventsd",
]);

/** The custom-folder-icon file: the name really ends in a carriage return. */
export const ICON_CR = "Icon\r";

/** True for a single path SEGMENT that is operating-system bookkeeping. */
export function isSystemJunkName(name: string): boolean {
  if (name === ICON_CR) return true;
  return SYSTEM_JUNK_NAMES.has(name.toLowerCase());
}

/** True when any segment of a vault-relative path is operating-system bookkeeping. */
export function isSystemJunkPath(path: string): boolean {
  return path.replace(/\\/g, "/").split("/").some(isSystemJunkName);
}

/**
 * AppleDouble: on a volume without extended attributes (SMB, exFAT, FAT) macOS
 * stores a file's resource fork and metadata in a sibling named `._<name>`.
 * For `Note.md` that is `._Note.md` — which ends in `.md` and would otherwise
 * be indexed as a note. The NAME alone does not decide it: a user may call a
 * note `._notes.md`. What decides is the file's first four bytes.
 */
export const APPLE_DOUBLE_MAGIC: readonly number[] = [0x00, 0x05, 0x16, 0x07];

/** The shape of an AppleDouble name — necessary, never sufficient. */
export function isAppleDoubleName(name: string): boolean {
  return name.length > 2 && name.startsWith("._");
}

/** True when `bytes` starts with the AppleDouble magic number `00 05 16 07`. */
export function hasAppleDoubleHeader(bytes: Uint8Array): boolean {
  if (bytes.length < APPLE_DOUBLE_MAGIC.length) return false;
  return APPLE_DOUBLE_MAGIC.every((b, i) => bytes[i] === b);
}

const baseName = (path: string): string => {
  const p = path.replace(/\\/g, "/");
  return p.slice(p.lastIndexOf("/") + 1);
};

/**
 * The full decision for a file that exists on THIS disk: a fixed junk name
 * anywhere in the path, or an AppleDouble name whose bytes carry the header.
 * `readBytes` is only called for AppleDouble-shaped names, so the cost is one
 * read of a small file for the rare `._*` entry and nothing for everything else.
 * A read that fails is not evidence: the file then counts as the user's.
 */
export async function isSystemJunkFile(
  path: string,
  readBytes: (path: string) => Promise<Uint8Array>,
): Promise<boolean> {
  if (isSystemJunkPath(path)) return true;
  if (!isAppleDoubleName(baseName(path))) return false;
  try {
    return hasAppleDoubleHeader(await readBytes(path));
  } catch {
    return false;
  }
}

/**
 * The path-only fallback for AppleDouble, for the ONE place that cannot read
 * the header: the remote listing, where reading would mean downloading the
 * very file we want to leave alone. `._x` counts as junk there only when `x`
 * exists in the same folder (in the listing or already known locally) — that
 * is exactly when macOS writes it. A user's `._notes.md` without a `notes.md`
 * beside it syncs like any other file. Everywhere the bytes are at hand
 * (index, upload) the header decides instead (`isSystemJunkFile`).
 */
export function isAppleDoubleCompanion(path: string, exists: (path: string) => boolean): boolean {
  const p = path.replace(/\\/g, "/");
  const slash = p.lastIndexOf("/");
  const name = p.slice(slash + 1);
  if (!isAppleDoubleName(name)) return false;
  return exists(`${p.slice(0, slash + 1)}${name.slice(2)}`);
}
