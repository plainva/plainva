/**
 * Asking the device for files (S40, issue #56).
 *
 * A plain `<input type="file">` rather than a native plugin: on Android and iOS
 * that opens the system document picker, it needs no new dependency on either
 * platform, and it is the one path that also works in the browser build the
 * screenshots and tests run against.
 *
 * Its own module since #56 gave it a second caller. It used to live in
 * importService, which pulls in the whole import registry and the archive
 * unpacker — the editor asking for one attachment has no business loading any
 * of that.
 */

export type PickMode = "files" | "folder";

/**
 * Opens the system picker and resolves with what the user chose.
 *
 * Resolves with an empty array when the sheet is dismissed. There is no
 * cancel EVENT for a file input on either platform, so a caller must treat
 * "nothing picked" as a cancellation rather than waiting for one.
 */
export function pickDeviceFiles(mode: PickMode = "files"): Promise<File[]> {
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
