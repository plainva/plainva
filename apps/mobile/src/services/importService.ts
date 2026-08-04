import { defaultImportRegistry, type ImportSource } from "@plainva/core";
import { unpackSelection, type ExtractedArchive } from "./importArchive";

/**
 * Bringing the shared import core onto the phone (S40).
 *
 * Everything that decides anything — the adapters, the registry, detection
 * order, the writer — is already shared and unchanged here. What a platform
 * has to supply is three things: how the user names files, how an archive is
 * unpacked, and how the result reaches the importers. The first is this
 * module, the second is importArchive, the third is the plain array the
 * registry has always taken.
 *
 * File picking uses a WebView `<input type="file">` rather than a native
 * plugin: on Android and iOS that opens the system document picker, it needs
 * no new dependency on either platform, and it is the one path that also works
 * in the browser build the screenshots and tests run against.
 */

export type PickMode = "files" | "folder";

/**
 * Opens the system picker and resolves with what the user chose.
 *
 * Resolves with an empty array when the sheet is dismissed. There is no
 * cancel EVENT for a file input on either platform, so a caller must treat
 * "nothing picked" as a cancellation rather than waiting for one.
 */
export function pickImportFiles(mode: PickMode = "files"): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (mode === "folder") {
      // Non-standard but supported by the Android WebView and iOS 16+; it is
      // the only way to keep a folder's structure, which the importers need to
      // tell `journals/2024-01-01.md` from a note that happens to be named so.
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    }
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        input.remove();
        resolve(files);
      },
      { once: true },
    );
    input.click();
  });
}

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
