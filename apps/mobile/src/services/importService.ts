import { defaultImportRegistry, type ImportSource } from "@plainva/core";
import { unpackSelection, type ExtractedArchive } from "./importArchive";
import { pickDeviceFiles, type PickMode } from "./pickFiles";

/**
 * Bringing the shared import core onto the phone (S40).
 *
 * Everything that decides anything — the adapters, the registry, detection
 * order, the writer — is already shared and unchanged here. What a platform
 * has to supply is three things: how the user names files, how an archive is
 * unpacked, and how the result reaches the importers. The first is
 * `pickFiles`, the second is importArchive, the third is the plain array the
 * registry has always taken.
 */

export type { PickMode };

/**
 * Opens the system picker and resolves with what the user chose.
 *
 * Kept as a named re-export: this is the import wizard's word for it, and the
 * picker moved to its own module when the editor gained a second use for it
 * (issue #56) — loading the registry and the archive unpacker to ask for one
 * attachment would be absurd.
 */
export const pickImportFiles = pickDeviceFiles;

export interface ImportSelection {
  archive: ExtractedArchive;
  /** What the registry recognised, or null when nothing claimed the input. */
  detected: ImportSource | null;
}

/**
 * Unpacks a selection and asks the registry what it is.
 *
 * Detection is a convenience: a failure or a null leaves the choice to the
 * user rather than guessing, exactly as on the desktop.
 */
export async function analyzeSelection(picked: File[]): Promise<ImportSelection> {
  const archive = await unpackSelection(picked);
  if (archive.files.length === 0) return { archive, detected: null };
  let detected: ImportSource | null = null;
  try {
    detected = await defaultImportRegistry.detect(archive.files);
  } catch {
    // Leave the user's own choice alone.
  }
  return { archive, detected };
}
