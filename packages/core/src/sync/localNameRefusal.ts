import { classifySyncError, syncErrorMessage } from "./errorKind.js";

/**
 * A file this device's file system will not store under its name (Sammelplan
 * § 3.158 Nr. 7).
 *
 * The provider refusing a file was already a skip (`UnsyncableFileError`): the
 * file is named, asked for again later, and the vault's first cycle completes
 * without it. A name the DEVICE refuses - `a:b.md` or `CON.md` on Windows and
 * on an Android shared folder, a name longer than 255 bytes anywhere - failed
 * the write instead, counted as an ordinary pull failure, and an ordinary
 * failure holds the first cycle: the local-only files never went up, the
 * folder was never recorded as synced, and the connect wizard's first pass
 * waited for a file no retry could bring.
 *
 * Two ways to know, because the platforms say it differently:
 * - the error says so (Windows "os error 123/161/206", POSIX ENAMETOOLONG or
 *   EILSEQ, as the desktop's Rust side and the phone's file plugins pass them on);
 * - or the name breaks the rule some file system holds (`nameRuleBroken`), the
 *   write failed for a reason waiting does not cure, and no file of that name
 *   exists here - a name this device does store would have one.
 * Asked only after a write failed: a name that works here is never skipped.
 */

const NAME_ERROR =
  /os error (?:123|161|206|36|63)\b|\bENAMETOOLONG\b|\bEILSEQ\b|file ?name too long|illegal byte sequence|syntax is incorrect|invalid (?:file ?)?name|name is not valid/i;

const RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;
// Characters Windows, FAT/exFAT and Android's shared storage refuse in a name.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>:"\\|?*\u0000-\u001f]/;
const MAX_NAME_BYTES = 255;

/** The rule a segment of `path` breaks on some file system, or null when every segment is portable. */
export function nameRuleBroken(path: string): string | null {
  for (const segment of path.split("/")) {
    if (!segment) continue;
    if (FORBIDDEN.test(segment)) return `"${segment}" holds a character some file systems refuse`;
    if (/[. ]$/.test(segment)) return `"${segment}" ends in a dot or a space`;
    if (RESERVED.test(segment)) return `"${segment}" is a reserved device name`;
    if (new TextEncoder().encode(segment).length > MAX_NAME_BYTES) return `"${segment.slice(0, 40)}..." is longer than ${MAX_NAME_BYTES} bytes`;
  }
  return null;
}

/**
 * Why this device cannot store a file at `path`, when the failed write
 * `error` says so or the name explains it; null for any other failure.
 * `existsHere` answers whether a file of that name exists on this device.
 */
export async function localNameRefusal(path: string, error: unknown, existsHere: (path: string) => Promise<boolean>): Promise<string | null> {
  const message = syncErrorMessage(error);
  if (NAME_ERROR.test(message)) return `this device's file system refused the name: ${message}`;
  const broken = nameRuleBroken(path);
  if (!broken || classifySyncError(error) === "transient") return null;
  const exists = await existsHere(path).catch(() => false);
  return exists ? null : `this device's file system refused the name (${broken}): ${message}`;
}
